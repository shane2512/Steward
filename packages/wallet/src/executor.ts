// 5.4 — THE EXECUTOR. This is the only module in the repository that may broadcast a proposal's
// calls (I1). Everything else builds, simulates, decides or reads.
//
// The algorithm is AGENTKIT_INTEGRATION §4, in that order:
//   0. build the calls from the Policy (pure) and hash them
//   1. verify the AllowReceipt — MAC, validity window (injected clock), policyVersion, walletId,
//      proposalHash, and callsHash against the bytes we just built
//   2. calls-hash parity with what the RiskGate simulated  (Fatal on mismatch)
//   3. burn the receipt nonce and claim the `(wallet, proposal_hash)` execution row in ONE
//      transaction — the DB, not this code, is what makes both single-use (I10)
//   4. re-read `wallets.frozen` / `breaker_open` FRESH from the DB, right before sending (I7)
//   5. re-check calls-hash parity and re-run `assertAllowedTargets`
//   6. send, and store the userOp hash and tx hash immediately
//   7. hand off to the confirmer. On timeout we never resend (PHASES "Do not").
//
// The send capability arrives through the `TxSender` port declared below — inside this module's
// boundary, so "only the executor sends" stays true whether production injects the CDP smart
// account or a fork test injects a local account. `pnpm check:arch` keeps CDP/AgentKit imports out
// of every other module.
//
// Every state change writes an audit row through `appendAudit`; an `Err` from the audit writer
// aborts BEFORE anything is broadcast (I5/I6 — we never act without being able to record it).
import type { Hex } from 'viem';
import {
  appendAudit,
  claimExecutionSlot,
  getWalletById,
  updateExecution,
  type Db,
  type ExecutionRow,
} from '@steward/db';
import { hashProposal, verifyReceipt } from '@steward/policy';
import {
  err,
  ok,
  type Address,
  type AllowReceipt,
  type Policy,
  type Proposal,
  type Result,
} from '@steward/shared';
import { assertAllowedTargets, type BuildContext, buildCalls } from './actionRegistry';
import { callsHash, type Call } from './calls';
import {
  classifyError,
  execError,
  MAX_SEND_ATTEMPTS,
  RETRY_BACKOFF_MS,
  type ExecError,
} from './errors';

/** What a successful broadcast gives us. CDP returns the userOp hash first, the tx hash after. */
export type SendOutcome = { userOpHash?: Hex | undefined; txHash?: Hex | undefined };

/**
 * The only send-capable port in Steward. Implementations: a CDP smart account
 * (`sendUserOperation` + `waitForUserOperation`) in production, a local viem account in the fork
 * tests. `send` must submit the calls as ONE batch and resolve only once the operation has been
 * accepted — a throw therefore means nothing was accepted, which is what makes retrying safe.
 */
export interface TxSender {
  getAddress(): Address;
  send(calls: readonly Call[]): Promise<SendOutcome>;
}

export type ExecuteDeps = {
  db: Db;
  sender: TxSender;
  /** RECEIPT_HMAC_SECRET as bytes. Never logged, never stored. */
  receiptKey: Uint8Array;
  /** Injected clock (testable expiry). */
  now: () => Date;
  /** Injected so retry backoff is testable without waiting 15 minutes. */
  sleep?: (ms: number) => Promise<void>;
};

export type ExecuteInput = {
  walletId: string;
  decisionId: string;
  proposal: Proposal;
  policy: Policy;
  receipt: AllowReceipt;
  buildContext: BuildContext;
  /** `simulations.calls_hash` for this decision — what the RiskGate actually simulated. */
  simulatedCallsHash: Hex;
};

export type ExecuteOutcome =
  /** Broadcast; the confirmer takes it from here. */
  | { status: 'submitted'; execution: ExecutionRow; calls: readonly Call[] }
  /** An execution for this proposal hash already existed. Nothing was sent (I10). */
  | { status: 'duplicate'; execution: ExecutionRow }
  /** Frozen or breaker-open between verdict and send. Nothing was sent. */
  | { status: 'cancelled'; execution: ExecutionRow; reason: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Execute an ALLOW'd proposal exactly once. Never throws.
 *
 * Returns `Err` for every refusal; the `class` on the error says whether a *new* attempt (with a
 * new simulation and verdict) could make sense. It never resends after a send that produced a
 * hash, and it never sends at all without a receipt that authorises these exact bytes.
 */
export async function execute(
  deps: ExecuteDeps,
  input: ExecuteInput,
): Promise<Result<ExecuteOutcome, ExecError>> {
  const { db, sender, receiptKey } = deps;
  const { walletId, decisionId, proposal, policy, receipt, buildContext } = input;
  const now = deps.now();

  // --- 0. build the calls (pure, Policy-resolved addresses only) --------------------------------
  const built = buildCalls(proposal, policy, buildContext);
  if (!built.ok)
    return refuse(db, walletId, decisionId, execError('BUILD_FAILED', built.error.message));
  const calls = built.value;
  const hash = callsHash(calls);
  const proposalHash = hashProposal(proposal);

  // --- 1. receipt --------------------------------------------------------------------------------
  const verified = verifyReceipt(
    receipt,
    { proposalHash, policyVersion: policy.version, walletId, callsHash: hash },
    receiptKey,
    now,
  );
  if (!verified.ok)
    return refuse(
      db,
      walletId,
      decisionId,
      execError('RECEIPT_INVALID', `${verified.error.code}: ${verified.error.message}`),
    );

  // --- 2. simulation parity ----------------------------------------------------------------------
  if (hash !== input.simulatedCallsHash)
    return refuse(
      db,
      walletId,
      decisionId,
      execError(
        'CALLS_MISMATCH',
        `calls hash ${hash} does not match the simulated ${input.simulatedCallsHash}`,
      ),
    );

  // --- 3. burn the nonce + claim the execution row (atomic, I10) ---------------------------------
  const claim = await claimExecutionSlot(db, {
    nonce: receipt.nonce,
    issuedAt: new Date(receipt.issuedAt),
    usedAt: now,
    walletId,
    decisionId,
    proposalHash,
    kind: proposal.kind,
    callsHash: hash,
  });
  if (!claim.ok) {
    const code = claim.error.code === 'NONCE_REPLAYED' ? 'NONCE_REPLAYED' : 'DB_UNAVAILABLE';
    return refuse(db, walletId, decisionId, execError(code, claim.error.message));
  }
  const execution = claim.value.execution;
  if (!claim.value.created) {
    // Idempotent: somebody already claimed this proposal hash. Do not send again, ever.
    await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'EXECUTION_DUPLICATE',
      entityType: 'execution',
      entityId: execution.id,
      payload: { proposalHash, status: execution.status, callsHash: hash },
      createdAt: now,
    });
    return ok({ status: 'duplicate', execution });
  }

  // --- 4. FRESH frozen / breaker re-read, right before sending (I7) ------------------------------
  const wallet = await getWalletById(db, walletId).catch(() => undefined);
  if (!wallet)
    return refuse(db, walletId, decisionId, execError('DB_UNAVAILABLE', 'wallet row unreadable'));
  const ownerSweep = proposal.kind === 'sweep_home' && proposal.source === 'owner';
  const blocked = wallet.frozen
    ? 'wallet is frozen'
    : wallet.breakerOpen
      ? 'circuit breaker is open'
      : null;
  if (blocked !== null && !ownerSweep) {
    const cancelled = await updateExecution(db, execution.id, {
      status: 'cancelled',
      error: blocked,
    });
    const audited = await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'EXECUTION_CANCELLED',
      entityType: 'execution',
      entityId: execution.id,
      payload: { proposalHash, reason: blocked, kind: proposal.kind },
      createdAt: now,
    });
    if (!audited.ok) return err(execError('AUDIT_FAILED', audited.error.message, 'fatal'));
    return ok({ status: 'cancelled', execution: cancelled ?? execution, reason: blocked });
  }

  // --- 5. parity + allowlist, once more, on the bytes about to leave -----------------------------
  if (hash !== execution.callsHash || hash !== input.simulatedCallsHash)
    return abort(
      db,
      execution,
      now,
      execError('CALLS_MISMATCH', 'calls hash changed between claim and send'),
    );
  const targets = assertAllowedTargets(calls as Call[], policy, buildContext);
  if (!targets.ok)
    return abort(db, execution, now, execError('BUILD_FAILED', targets.error.message));

  // I6: record the intent BEFORE broadcasting. If this write fails we do not send at all — and the
  // `pending` row left behind by a crash after this point is what `reconcile.ts` closes.
  const intent = await appendAudit(db, {
    walletId,
    actor: 'agent',
    event: 'EXECUTION_PENDING',
    entityType: 'execution',
    entityId: execution.id,
    payload: {
      proposalHash,
      kind: proposal.kind,
      callsHash: hash,
      calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
      receiptNonce: receipt.nonce,
    },
    createdAt: now,
  });
  if (!intent.ok) return err(execError('AUDIT_FAILED', intent.error.message, 'fatal'));

  // --- 6. send -----------------------------------------------------------------------------------
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: ExecError | undefined;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let outcome: SendOutcome;
    try {
      outcome = await sender.send(calls);
    } catch (e) {
      const classified = classifyError(e);
      lastError = classified;
      await appendAudit(db, {
        walletId,
        actor: 'agent',
        event: 'EXECUTION_SEND_FAILED',
        entityType: 'execution',
        entityId: execution.id,
        payload: {
          attempt,
          code: classified.code,
          class: classified.class,
          message: classified.message,
        },
        createdAt: deps.now(),
      });
      if (classified.class === 'fatal' || attempt === MAX_SEND_ATTEMPTS) break;
      // Same row, same calls, same idempotency key — only the broadcast is retried, and only
      // because `send` threw without yielding a hash.
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 0);
      continue;
    }

    const submitted = await updateExecution(db, execution.id, {
      status: 'submitted',
      ...(outcome.userOpHash ? { userOpHash: outcome.userOpHash } : {}),
      ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
    });
    const audited = await appendAudit(db, {
      walletId,
      actor: 'agent',
      event: 'EXECUTION_SUBMITTED',
      entityType: 'execution',
      entityId: execution.id,
      payload: {
        proposalHash,
        kind: proposal.kind,
        userOpHash: outcome.userOpHash ?? null,
        txHash: outcome.txHash ?? null,
        attempt,
      },
      createdAt: deps.now(),
    });
    if (!audited.ok) {
      // The transaction is out there; losing the audit row does not un-send it. Surface loudly and
      // leave the row for the confirmer — never retry.
      return err(execError('AUDIT_FAILED', audited.error.message, 'fatal'));
    }
    return ok({ status: 'submitted', execution: submitted ?? execution, calls });
  }

  const failure = lastError ?? execError('SEND_FAILED', 'send failed with no error');
  return abort(db, execution, deps.now(), failure);
}

/** Mark FAILED and audit, then return the error. Used once the execution row exists. */
async function abort(
  db: Db,
  execution: ExecutionRow,
  now: Date,
  error: ExecError,
): Promise<Result<never, ExecError>> {
  await updateExecution(db, execution.id, { status: 'failed', error: error.message });
  await appendAudit(db, {
    walletId: execution.walletId,
    actor: 'agent',
    event: 'EXECUTION_FAILED',
    entityType: 'execution',
    entityId: execution.id,
    payload: { code: error.code, class: error.class, message: error.message },
    createdAt: now,
  });
  return err(error);
}

/** Refuse before any execution row exists. Nothing was sent; the refusal is still audited (I6). */
async function refuse(
  db: Db,
  walletId: string,
  decisionId: string,
  error: ExecError,
): Promise<Result<never, ExecError>> {
  await appendAudit(db, {
    walletId,
    actor: 'agent',
    event: 'EXECUTION_REFUSED',
    entityType: 'decision',
    entityId: decisionId,
    payload: { code: error.code, class: error.class, message: error.message },
  });
  return err(error);
}
