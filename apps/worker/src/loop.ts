// 6.1 — THE DECISION LOOP. ARCHITECTURE §5, in that order:
//
//   trigger(walletId, reason)
//    -> lock(walletId)                       per-wallet advisory lock, one loop per wallet
//    -> if frozen / breaker open -> audit(SKIPPED)
//    -> if an execution is unresolved -> audit(SKIPPED)          (6.6: never re-propose blind)
//    -> ctx = ContextBuilder.build(walletId) -> audit(CONTEXT, ctx.hash)
//    -> pre = PreChecks(ctx, policy)         deterministic NOOP / deterministic proposal
//    -> screen = InjectionScreen(untrusted)  (SERV)
//    -> proposal = Proposer(ctx, policy)     (SERV) -> audit(PROPOSAL)
//    -> verdict_v = ShadowVerifier(...)      (SERV) -> audit(VERIFICATION)
//    -> simulate -> evaluate -> audit(VERDICT) -> ALLOW / ESCALATE / DENY      (pipeline.ts)
//    -> unlock
//
// Properties this module is responsible for:
//   * one iteration per wallet at a time (`tryWalletLock`; a tick that cannot take the lock does
//     nothing at all rather than queueing behind the running one);
//   * an audit row at EVERY step, and an `Err` from the audit writer aborts the iteration BEFORE
//     anything can be sent (I5/I6). With the database unreachable, `gather` fails first and we
//     never reach a send at all;
//   * the clock is injected — no `Date.now()` decides anything;
//   * SERV output never reaches the executor except through `runPipeline`, which is the only place
//     `signReceipt` is called (PHASES 6 "Do not").
import { buildContext, factIds, type Context } from '@steward/context';
import {
  appendAudit,
  insertAgentDecision,
  listUnresolvedExecutions,
  updateAgentDecision,
  type Db,
} from '@steward/db';
import { hashProposal, renderPolicyAsSentences } from '@steward/policy';
import {
  propose,
  screenItems,
  screenUntrusted,
  verify,
  type CallMeta,
  type ServClient,
} from '@steward/reasoning';
import { addressEquals, type Proposal, type ProposalKind } from '@steward/shared';
import { gather, type GatherDeps, type Gathered } from './gather';
import { preChecks, type DecisionTrigger, type PreCheckObligation } from './prechecks';
import { runPipeline, type PipelineDeps, type PipelineOutcome } from './pipeline';

/**
 * Kinds SERV may choose from.
 *
 * `risk_exit` is deliberately absent: risk exits are a deterministic trigger (6.2a), and Phase 4's
 * live smoke showed the verifier prompt reads an exit as a liquidity breach and DISAGREEs, which
 * would turn a pre-authorised safety action into an R15 DENY. Keeping the kind off the model's menu
 * closes that hole without a prompt change and without re-recording the golden fixtures (D-52).
 * `sweep_home` is absent because R03 requires `source: 'owner'`.
 */
export const DISCRETIONARY_KINDS: ProposalKind[] = [
  'pull_allowance',
  'vault_deposit',
  'vault_withdraw',
  'pay_recipient',
  'noop',
];

export type DecisionLoopDeps = PipelineDeps &
  Omit<GatherDeps, 'db' | 'now' | 'spendPermissionManagerAddress' | 'allowMainnet'> & {
    serv?:
      | {
          client: ServClient;
          proposerModel: string;
          verifierModel: string;
        }
      | undefined;
    /** 6.7: SERV is considered down; only deterministic proposals run this iteration. */
    degraded?: boolean;
    /** Called when a SERV task fails, so the caller's circuit breaker can count it (6.7). */
    onServFailure?: (task: string, detail: string) => void;
    /** Called after any successful SERV round trip, to close the breaker again. */
    onServSuccess?: () => void;
  };

export type DecisionOutcome =
  /** Another iteration holds the lock. Nothing happened; this is not an error. */
  | { status: 'locked' }
  | { status: 'skipped'; reason: string }
  | { status: 'noop'; decisionId: string; reason: string }
  | { status: 'failed'; code: string; message: string; decisionId?: string }
  | ({ decisionId: string } & PipelineOutcome);

/**
 * Run exactly one iteration for one wallet. Never throws: every failure is a status the caller
 * (a pg-boss job) logs and retries on the next tick.
 *
 * The caller is responsible for the lock — see `runLocked` in `jobs.ts` — so tests can drive the
 * body directly and the lock has exactly one owner.
 */
export async function runIteration(
  deps: DecisionLoopDeps,
  walletId: string,
  trigger: DecisionTrigger,
): Promise<DecisionOutcome> {
  const { db } = deps;
  const now = deps.now();

  // 6.6 — never re-propose while an execution for this wallet is unresolved. Until the confirmer
  // (or reconciliation) has settled it we do not know the balances, so any new proposal would be
  // reasoning about a state that may already be stale.
  const unresolved = await listUnresolvedExecutions(db, walletId).catch(() => null);
  if (unresolved === null)
    return { status: 'failed', code: 'DB_UNAVAILABLE', message: 'cannot read executions' };
  if (unresolved.length > 0) {
    const reason = `execution ${unresolved[0]?.id} is still ${unresolved[0]?.status}`;
    await skipAudit(db, walletId, now, reason, trigger);
    return { status: 'skipped', reason };
  }

  // ── gather (db + chain + oracle) ───────────────────────────────────────────────────────────────
  const gathered = await gather(
    {
      db,
      publicClient: deps.publicClient,
      spendPermissionManagerAddress: deps.spendPermissionManagerAddress,
      allowMainnet: deps.allowMainnet,
      now: deps.now,
      priceAdapter: deps.priceAdapter,
      extraUntrusted: deps.extraUntrusted,
    },
    walletId,
  );
  if (!gathered.ok) {
    await skipAudit(db, walletId, now, `${gathered.error.code}: ${gathered.error.message}`, trigger);
    return { status: 'failed', code: gathered.error.code, message: gathered.error.message };
  }
  const g = gathered.value;

  if (g.wallet.frozen || g.wallet.breakerOpen) {
    const reason = g.wallet.frozen ? 'wallet is frozen' : 'circuit breaker is open';
    await skipAudit(db, walletId, now, reason, trigger);
    return { status: 'skipped', reason };
  }

  // ── pre-checks, BEFORE any SERV call (SERV §7 budget) ──────────────────────────────────────────
  const degraded = deps.degraded === true || deps.serv === undefined;
  const pre = preChecks({
    now,
    policy: g.policy,
    decimals: g.decimals,
    frozen: g.wallet.frozen,
    breakerOpen: g.wallet.breakerOpen,
    agentUsdc: g.balances.agentUsdc,
    treasuryUsdc: g.balances.treasuryUsdc,
    allowanceRemaining: g.allowanceRemaining,
    vaults: g.vaults.map((v) => ({
      id: v.id,
      positionAssets: v.positionAssets,
      redeemableAssets: v.position.redeemableAssets,
      shares: v.position.shares,
      maxAllocationBps: v.maxAllocationBps,
      flagged: v.flagged,
    })),
    obligations: resolveObligations(g),
    riskTriggers: g.riskTriggers,
    runwayBufferBaseUnits: microUsdToBase(g.policy.runwayBufferMicroUsd, g),
    perTxBaseUnits: microUsdToBase(g.policy.limits.perTxMicroUsd, g),
    degraded,
  });

  if (pre.kind === 'skip') {
    await skipAudit(db, walletId, now, pre.reason, trigger);
    return { status: 'skipped', reason: pre.reason };
  }

  // ── context (pure) + the decision row + audit(CONTEXT) ─────────────────────────────────────────
  const allowedKinds: ProposalKind[] =
    pre.kind === 'deterministic'
      ? [pre.proposal.kind]
      : DISCRETIONARY_KINDS.filter((k) => g.policy.autonomousKinds.includes(k) || k === 'noop');

  let ctx = buildContext({
    now,
    decimals: g.decimals,
    policySummary: renderPolicyAsSentences(g.policy),
    allowedKinds,
    balances: {
      treasuryUsdc: g.balances.treasuryUsdc,
      agentUsdc: g.balances.agentUsdc,
      allowanceRemaining: g.allowanceRemaining,
      ...(g.allowancePeriodEnds ? { allowancePeriodEnds: g.allowancePeriodEnds } : {}),
    },
    vaults: g.vaults.map((v) => ({
      id: v.id,
      name: v.name,
      positionBaseUnits: v.positionAssets,
      flagged: v.flagged,
    })),
    recipients: g.policy.recipients.map((r) => ({ id: r.id, label: r.label })),
    obligations: resolveObligations(g)
      .filter((o) => o.policyRecipientId !== null)
      .map((o) => ({
        id: o.id,
        recipientId: o.policyRecipientId as string,
        dueDate: o.dueDate,
        amountBaseUnits: o.amount,
      })),
    priceUsdc: g.quote ?? { microUsd: 1_000_000n, publishedAt: now },
    outflowsLast24hBaseUnits: g.ledger.outflowsLast24hMicroUsd,
    riskTriggers: g.riskTriggers,
    untrusted: g.untrusted,
  });

  const decision = await insertAgentDecision(db, {
    walletId,
    trigger,
    contextSnapshot: JSON.parse(JSON.stringify(ctx, bigintToString)) as unknown,
    contextHash: ctx.snapshotHash,
    proposalSource: pre.kind === 'deterministic' ? 'deterministic' : 'serv',
    status: 'noop',
  }).catch(() => null);
  if (decision === null)
    return { status: 'failed', code: 'DB_UNAVAILABLE', message: 'cannot record the decision' };
  const decisionId = decision.id;

  const contextAudited = await appendAudit(db, {
    walletId,
    actor: 'agent',
    event: 'CONTEXT',
    entityType: 'decision',
    entityId: decisionId,
    payload: {
      contextHash: ctx.snapshotHash,
      trigger,
      preCheck: pre.kind,
      reason: pre.reason,
      degraded,
      factIds: factIds(ctx),
      policyVersion: g.policyVersion,
    },
    createdAt: now,
  });
  if (!contextAudited.ok)
    return { status: 'failed', code: 'AUDIT_FAILED', message: contextAudited.error.message, decisionId };

  if (pre.kind === 'noop') {
    await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'PROPOSAL',
      entityType: 'decision',
      entityId: decisionId,
      payload: { kind: 'noop', source: 'deterministic', reason: pre.reason },
      createdAt: now,
    });
    return { status: 'noop', decisionId, reason: pre.reason };
  }

  // ── the proposal ───────────────────────────────────────────────────────────────────────────────
  let proposal: Proposal;
  let verifier: { verdict: 'AGREE' | 'DISAGREE' | 'UNSURE'; reasons: string[] } | null = null;
  let screen = { injectionSuspected: false, signals: [] as string[] };
  const servMeta: Record<string, unknown> = { degraded };

  if (pre.kind === 'deterministic') {
    proposal = pre.proposal;
    // The screen still runs on the untrusted text even for a deterministic action: R16 must see an
    // injection attempt regardless of who proposed. Heuristics are deterministic and need no SERV.
    const heuristicOnly = await screenLocal(deps, ctx, degraded, servMeta);
    screen = heuristicOnly;
    ctx = { ...ctx, screen };
  } else {
    if (!deps.serv)
      return { status: 'failed', code: 'NO_SERV', message: 'discretionary path without a SERV client', decisionId };

    screen = await screenLocal(deps, ctx, degraded, servMeta);
    ctx = { ...ctx, screen };

    const proposed = await propose({
      client: deps.serv.client,
      model: deps.serv.proposerModel,
      ctx,
      usdcAddress: g.usdc,
      decimals: g.decimals,
    });
    servMeta['propose'] = metaOf(proposed.meta, proposed.issues);
    if (proposed.issues.length > 0) deps.onServFailure?.('propose', proposed.issues.join('; '));
    else deps.onServSuccess?.();
    proposal = proposed.proposal;
  }

  const proposalAudited = await appendAudit(db, {
    walletId,
    actor: 'agent',
    event: 'PROPOSAL',
    entityType: 'decision',
    entityId: decisionId,
    payload: {
      kind: proposal.kind,
      source: proposal.source,
      params: JSON.parse(JSON.stringify(proposal.params, bigintToString)) as unknown,
      citedFactIds: proposal.citedFactIds,
      confidence: proposal.confidence,
      rationale: proposal.rationale,
      screen,
    },
    createdAt: now,
  });
  if (!proposalAudited.ok)
    return { status: 'failed', code: 'AUDIT_FAILED', message: proposalAudited.error.message, decisionId };

  if (proposal.kind === 'noop') {
    await updateDecision(db, decisionId, { proposal, screen, servMeta, status: 'noop' });
    return { status: 'noop', decisionId, reason: proposal.rationale };
  }

  // ── the shadow verifier (skipped for deterministic proposals: R15 exempts them) ────────────────
  if (pre.kind !== 'deterministic' && deps.serv) {
    const verified = await verify({
      client: deps.serv.client,
      model: deps.serv.verifierModel,
      ctx,
      proposal,
      decimals: g.decimals,
    });
    verifier = verified.verifier;
    servMeta['verify'] = metaOf(verified.meta, []);
    if (verified.verifier.verdict === 'UNSURE') deps.onServFailure?.('verify', 'UNSURE');
    else deps.onServSuccess?.();
    const verificationAudited = await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'VERIFICATION',
      entityType: 'decision',
      entityId: decisionId,
      payload: {
        verdict: verified.verifier.verdict,
        reasons: verified.verifier.reasons,
        checkedFactIds: verified.checkedFactIds,
      },
      createdAt: now,
    });
    if (!verificationAudited.ok)
      return { status: 'failed', code: 'AUDIT_FAILED', message: verificationAudited.error.message, decisionId };
  }

  await updateDecision(db, decisionId, { proposal, screen, verifier, servMeta, status: 'noop' });

  const outcome = await runPipeline(deps, {
    g,
    decisionId,
    proposal,
    screen,
    verifier,
    contextFactIds: factIds(ctx),
    ownerApproval: null,
  });
  return { decisionId, ...outcome };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

/** The screen. Heuristics always run; the SERV classifier only when SERV is up (it can only ADD). */
async function screenLocal(
  deps: DecisionLoopDeps,
  ctx: Context,
  degraded: boolean,
  servMeta: Record<string, unknown>,
): Promise<{ injectionSuspected: boolean; signals: string[] }> {
  if (ctx.untrusted.length === 0) return { injectionSuspected: false, signals: [] };
  if (degraded || !deps.serv) {
    // `screenItems` is what `screenUntrusted` runs first anyway; with SERV down we keep the
    // deterministic half rather than pretending nothing is suspicious (I5).
    const heur = screenItems(ctx.untrusted);
    return {
      injectionSuspected: heur.hit,
      signals: [...heur.signals.map((s) => `heuristic:${s}`), 'classifier:skipped:degraded'],
    };
  }
  const result = await screenUntrusted({
    client: deps.serv.client,
    model: deps.serv.proposerModel,
    items: ctx.untrusted,
  });
  servMeta['screen'] = metaOf(result.meta, []);
  return { injectionSuspected: result.injectionSuspected, signals: result.signals };
}

const bigintToString = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** The SERV evidence a decision keeps (V-12): request ids and prompt versions, never prompt bodies. */
function metaOf(meta: CallMeta | undefined, issues: string[]) {
  if (!meta) return { issues };
  return {
    requestIds: meta.requestIds,
    model: meta.model,
    promptVersion: meta.promptVersion,
    repaired: meta.repaired,
    issues,
  };
}

async function updateDecision(
  db: Db,
  decisionId: string,
  patch: {
    proposal: Proposal;
    screen: unknown;
    verifier?: unknown;
    servMeta: unknown;
    status: string;
  },
): Promise<void> {
  await updateAgentDecision(db, decisionId, {
    proposal: JSON.parse(JSON.stringify(patch.proposal, bigintToString)) as unknown,
    proposalHash: patch.proposal.kind === 'noop' ? null : hashProposal(patch.proposal),
    proposalSource: patch.proposal.source,
    screen: patch.screen,
    verifier: patch.verifier ?? null,
    servMeta: patch.servMeta,
    status: patch.status,
  });
}

async function skipAudit(
  db: Db,
  walletId: string,
  now: Date,
  reason: string,
  trigger: DecisionTrigger,
): Promise<void> {
  await appendAudit(db, {
    walletId,
    actor: 'agent',
    event: 'SKIPPED',
    entityType: 'wallet',
    entityId: walletId,
    payload: { reason, trigger },
    createdAt: now,
  });
}

/**
 * Map db obligations to POLICY recipient ids: by id first, then by exact checksummed address
 * equality against the owner-signed recipient row (I4 — no fuzzy matching, ever).
 */
function resolveObligations(g: Gathered): PreCheckObligation[] {
  const byId = new Map(g.policy.recipients.map((r) => [r.id, r.id]));
  const rows = new Map(g.recipients.map((r) => [r.id, r.address]));
  return g.obligations.map((o) => {
    let policyRecipientId = byId.get(o.recipientId) ?? null;
    if (policyRecipientId === null) {
      const address = rows.get(o.recipientId);
      const match =
        address === undefined
          ? undefined
          : g.policy.recipients.find((r) => addressEquals(r.address, address));
      policyRecipientId = match?.id ?? null;
    }
    return {
      id: o.id,
      policyRecipientId,
      amount: o.amount,
      dueDate: new Date(`${o.dueDate}T00:00:00.000Z`),
    };
  });
}

/**
 * micro-USD -> token base units for SIZING only. Uses the oracle quote when there is one, else the
 * $1 parity. The Policy Engine redoes this conversion properly and denies if the sizing was wrong,
 * so this can never permit anything — it only decides how big a proposal to write down.
 */
function microUsdToBase(microUsd: bigint, g: Gathered): bigint {
  const quote = g.quote?.microUsd ?? 1_000_000n;
  if (quote <= 0n) return 0n;
  return (microUsd * 10n ** BigInt(g.decimals)) / quote;
}
