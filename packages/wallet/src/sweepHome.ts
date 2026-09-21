// 5.8 — `sweepHome(walletId)`: the owner path home (I7, SECURITY §4).
//
// Redeems every vault share and sends all agent USDC to `policy.treasuryAddress` — the destination
// stored at onboarding, changeable only by an owner-signed policy version, never by the agent and
// never by an LLM.
//
// Three properties this function must keep:
//   1. It works while the wallet is FROZEN. R01 exempts an owner sweep; so does the executor's
//      pre-send freeze re-check.
//   2. It does not depend on reasoning, SERV, or the worker. This module imports db, policy, risk
//      and the executor — never `packages/reasoning` (enforced by `owner-path-no-reasoning` in
//      .dependency-cruiser.cjs, with a deliberate-violation fixture). It is a plain async function
//      an API route can call directly.
//   3. It is NOT a bypass. The proposal is `source: 'owner'` and still goes through the real
//      `evaluate()` — R03 (sweep must be owner-sourced), R11 (simulation parity), R21 (chain) and
//      every other hard rule — and still needs a signed AllowReceipt to reach the executor.
import { randomUUID } from 'node:crypto';
import { getAddress, type PublicClient } from 'viem';
import {
  appendAudit,
  countExecutionsSince,
  getActivePolicy,
  getWalletById,
  outflowsSince,
  recentProposalHashes,
  insertSimulation,
  type Db,
} from '@steward/db';
import { evaluate, hashProposal, signReceipt } from '@steward/policy';
import { simulateProposalCalls } from '@steward/risk';
import {
  err,
  ok,
  zPolicy,
  type Address,
  type Policy,
  type PriceQuote,
  type Proposal,
  type Result,
  type Verdict,
} from '@steward/shared';
import { buildCalls, type VaultPosition } from './actionRegistry';
import { callsHash } from './calls';
import { execute, type ExecuteOutcome, type TxSender } from './executor';
import { getBalances, getVaultPosition } from './reads';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type SweepDeps = {
  db: Db;
  publicClient: PublicClient;
  sender: TxSender;
  receiptKey: Uint8Array;
  now: () => Date;
  /** Mirrors env.STEWARD_ALLOW_MAINNET; the Phase 9 gate is still checked separately. */
  allowMainnet?: boolean;
  /**
   * Current USDC quote. When absent we fall back to the I11 demo parity ($1.00), which the engine
   * honours only on Base Sepolia — so on mainnet a missing oracle is a DENY, not an assumption.
   */
  usdcQuote?: PriceQuote | undefined;
  spendPermissionManagerAddress: Address;
  /** A decision row to attach the sweep to (the owner path creates one before calling). */
  decisionId: string;
};

export type SweepOutcome = { verdict: Verdict; execution?: ExecuteOutcome };
export type SweepError = { code: string; message: string; verdict?: Verdict };

const fail = (code: string, message: string, verdict?: Verdict): Result<never, SweepError> =>
  err(verdict === undefined ? { code, message } : { code, message, verdict });

/**
 * Sweep everything home. Never throws; every refusal is an `Err` with the verdict attached when
 * the Policy Engine is the one refusing.
 */
export async function sweepHome(
  deps: SweepDeps,
  walletId: string,
): Promise<Result<SweepOutcome, SweepError>> {
  const { db, publicClient } = deps;
  const now = deps.now();

  const wallet = await getWalletById(db, walletId);
  if (!wallet) return fail('UNKNOWN_WALLET', `wallet ${walletId} not found`);
  if (!wallet.agentWalletAddress) return fail('NO_AGENT_WALLET', 'wallet has no agent wallet yet');
  const agent = getAddress(wallet.agentWalletAddress);

  const active = await getActivePolicy(db, walletId);
  if (!active) return fail('NO_ACTIVE_POLICY', 'wallet has no active policy');
  const parsedPolicy = zPolicy.safeParse(active.body);
  if (!parsedPolicy.success)
    return fail('POLICY_INVALID', `stored policy does not parse: ${parsedPolicy.error.message}`);
  const policy: Policy = parsedPolicy.data;

  if (wallet.chainId !== policy.chainId)
    return fail('CHAIN_MISMATCH', `wallet is on ${wallet.chainId}, policy on ${policy.chainId}`);

  const usdc = policy.tokens.find((t) => t.symbol === 'USDC');
  if (!usdc) return fail('NO_USDC', 'policy has no USDC token');
  const usdcAddress = getAddress(usdc.address);
  const treasury = getAddress(policy.treasuryAddress);

  // --- read the chain --------------------------------------------------------------------------
  const balances = await getBalances(publicClient, {
    usdc: usdcAddress,
    treasuryAddress: treasury,
    agentWalletAddress: agent,
  });
  if (!balances.ok) return fail('READ_FAILED', balances.error);

  const positions: Record<string, VaultPosition> = {};
  const positionAssets: Record<string, bigint> = {};
  let redeemable = 0n;
  for (const vault of policy.vaults) {
    const position = await getVaultPosition(publicClient, {
      vault: getAddress(vault.address),
      holder: agent,
    });
    if (!position.ok) return fail('READ_FAILED', position.error);
    positions[vault.id] = {
      shares: position.value.shares,
      redeemableAssets: position.value.redeemableAssets,
    };
    positionAssets[vault.id] = position.value.assets;
    redeemable += position.value.redeemableAssets;
  }

  const total = balances.value.agentUsdc + redeemable;
  if (total <= 0n) return fail('NOTHING_TO_SWEEP', 'no agent USDC and no vault shares');

  // --- the proposal (source: 'owner', set in code — never from a model, RR-3) --------------------
  const proposal: Proposal = {
    kind: 'sweep_home',
    params: {},
    expectedDeltas: [
      { token: usdcAddress, holder: 'agent', delta: -total },
      { token: usdcAddress, holder: 'treasury', delta: total },
    ],
    rationale: 'Owner-requested sweep: return all agent funds to the treasury.',
    citedFactIds: [],
    confidence: 1,
    source: 'owner',
  };

  const buildContext = {
    agentWalletAddress: agent,
    spendPermissionManagerAddress: deps.spendPermissionManagerAddress,
    agentUsdcBalance: balances.value.agentUsdc,
    vaultPositions: positions,
    allowMainnet: deps.allowMainnet ?? false,
  };
  const built = buildCalls(proposal, policy, buildContext);
  if (!built.ok) return fail(built.error.code, built.error.message);
  const hash = callsHash(built.value);

  // --- simulate the EXACT calls (R11 needs this, even on the owner path) -------------------------
  const simulated = await simulateProposalCalls({
    publicClient,
    calls: built.value,
    from: agent,
    token: usdcAddress,
    holders: { agent, treasury },
  });
  if (!simulated.ok) return fail(simulated.error.code, simulated.error.message);
  await insertSimulation(db, {
    decisionId: deps.decisionId,
    calls: built.value.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
    callsHash: hash,
    ok: simulated.value.ok,
    deltas: simulated.value.deltas.map((d) => ({ ...d, delta: d.delta.toString() })),
    error: simulated.value.error ?? null,
    blockNumber: simulated.value.blockNumber,
  });

  // --- evaluate with the REAL policy engine ------------------------------------------------------
  const verdict = evaluate({
    policy,
    proposal,
    now,
    chainId: policy.chainId,
    allowMainnet: deps.allowMainnet ?? false,
    demoStableParity: deps.usdcQuote === undefined,
    state: {
      frozen: wallet.frozen,
      breakerOpen: wallet.breakerOpen,
      agentUsdc: balances.value.agentUsdc,
      treasuryUsdc: balances.value.treasuryUsdc,
      allowanceRemaining: 0n,
      vaultPositions: positionAssets,
      prices: deps.usdcQuote === undefined ? {} : { [usdcAddress]: deps.usdcQuote },
      contractHasCode: Object.fromEntries(policy.vaults.map((v) => [getAddress(v.address), true])),
      riskTriggers: [],
    },
    ledger: {
      outflowsLast24hMicroUsd: await outflowsSince(db, walletId, new Date(now.getTime() - DAY_MS)),
      actionsLastHour: await countExecutionsSince(db, walletId, new Date(now.getTime() - HOUR_MS)),
      recentProposalHashes: (
        await recentProposalHashes(db, walletId, new Date(now.getTime() - DAY_MS))
      ).filter((h): h is `0x${string}` => h.startsWith('0x')),
    },
    simulation: {
      ok: simulated.value.ok,
      deltas: simulated.value.deltas,
      approvals: simulated.value.approvals,
      ...(simulated.value.error === undefined ? {} : { error: simulated.value.error }),
    },
    verifier: null,
    screen: { injectionSuspected: false, signals: [] },
    contextFactIds: [],
    ownerApproval: null,
  });

  await appendAudit(db, {
    walletId,
    actor: 'owner',
    event: 'VERDICT',
    entityType: 'decision',
    entityId: deps.decisionId,
    payload: {
      decision: verdict.decision,
      proposalHash: hashProposal(proposal),
      results: verdict.results,
      sweepTotal: total.toString(),
    },
    createdAt: now,
  });

  if (verdict.decision !== 'ALLOW')
    return fail('NOT_ALLOWED', `policy returned ${verdict.decision}`, verdict);

  // --- receipt + executor ------------------------------------------------------------------------
  const receipt = signReceipt(verdict, deps.receiptKey, now, randomUUID(), { callsHash: hash });
  if (!receipt.ok) return fail(receipt.error.code, receipt.error.message, verdict);

  const executed = await execute(
    {
      db,
      sender: deps.sender,
      receiptKey: deps.receiptKey,
      now: deps.now,
    },
    {
      walletId,
      decisionId: deps.decisionId,
      proposal,
      policy,
      receipt: receipt.value,
      buildContext,
      simulatedCallsHash: hash,
    },
  );
  if (!executed.ok) return fail(executed.error.code, executed.error.message, verdict);

  await appendAudit(db, {
    walletId,
    actor: 'owner',
    event: 'SWEEP',
    entityType: 'execution',
    entityId: 'execution' in executed.value ? executed.value.execution.id : null,
    payload: { status: executed.value.status, total: total.toString(), callsHash: hash },
    createdAt: deps.now(),
  });

  return ok({ verdict, execution: executed.value });
}
