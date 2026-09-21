// 5.5 / 5.7 — the confirmer, and the circuit breaker it drives.
//
// LESSON FROM PHASE 2 (PROGRESS, Known issues): a receipt is NOT success. The load-balanced Base
// Sepolia endpoint served stale state right after a write three separate times, and once a
// transaction gas-estimated against that stale state **reverted out of gas while still producing a
// receipt**. So this module treats an execution as confirmed only when BOTH hold:
//   (a) the receipt says `status === 'success'`, and
//   (b) the effect is verified — the token movements in the receipt's own logs match what the
//       proposal claimed, and a state read at the receipt's block succeeds after retrying with
//       backoff (one read is not state).
//
// Status transitions: pending → submitted → confirmed | failed | cancelled, plus `timeout`, which
// is the honest UNCERTAIN state: we do not know, so we alert and we NEVER resend. Resending needs
// a new simulation and a new verdict (PHASES "Do not"); `reconcile.ts` closes the loop instead.
import { decodeEventLog, type Hex, type PublicClient, type TransactionReceipt } from 'viem';
import {
  appendAudit,
  bumpBreakerFailures,
  getExecutionById,
  getUserIdForWallet,
  insertLedgerEntry,
  insertNotification,
  openBreaker,
  resetBreakerFailures,
  setObligationStatus,
  updateExecution,
  type Db,
  type ExecutionRow,
} from '@steward/db';
import { err, ok, type Address, type Delta, type Result } from '@steward/shared';

const TRANSFER_EVENT = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** 3 consecutive FAILED executions open the breaker (5.7). */
export const BREAKER_FAILURE_THRESHOLD = 3;
/** PHASES 5.5: poll the receipt for at most 3 minutes. */
export const CONFIRM_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;
/** Backoff for the post-confirmation state reads (lesson 1). */
const STATE_READ_BACKOFF_MS = [500, 1_000, 2_000, 4_000] as const;
/** R11's tolerance for share-price maths; transfers must match exactly (SECURITY §3 L4). */
const VAULT_TOLERANCE_BPS = 50n;
const VAULT_KINDS = new Set(['vault_deposit', 'vault_withdraw', 'risk_exit', 'sweep_home']);

export type ConfirmDeps = {
  db: Db;
  publicClient: PublicClient;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /**
   * CDP smart accounts return a userOp hash first; this resolves it to a transaction hash
   * (`waitForUserOperation`). Return `null` while it is still unknown. Omit for senders that
   * hand back a transaction hash directly (the fork tests).
   */
  resolveTxHash?: (userOpHash: Hex) => Promise<Hex | null>;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type ConfirmInput = {
  executionId: string;
  /** What the proposal claimed. Verified against the receipt's logs, not trusted. */
  expectedDeltas: readonly Delta[];
  /** The token whose Transfer events carry the effect (USDC in the MVP). */
  token: Address;
  holders: { agent: Address; treasury: Address; recipient?: Address | undefined };
  /** Settle this obligation on confirmation / mark it failed (5.5). */
  obligationId?: string | undefined;
  counterpartyLabel?: string | undefined;
};

export type ConfirmOutcome =
  | { status: 'confirmed'; execution: ExecutionRow; deltas: Delta[] }
  | { status: 'failed'; execution: ExecutionRow; reason: string }
  /** UNCERTAIN / needs-reconcile. Alerted, never resent. */
  | { status: 'timeout'; execution: ExecutionRow }
  /** Nothing to do: the row is already in a terminal state. */
  | { status: 'settled'; execution: ExecutionRow };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll an execution to a terminal state. Never throws, never resends.
 */
export async function confirmExecution(
  deps: ConfirmDeps,
  input: ConfirmInput,
): Promise<Result<ConfirmOutcome, string>> {
  const { db, publicClient } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? CONFIRM_TIMEOUT_MS;
  const pollMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;

  const execution = await getExecutionById(db, input.executionId);
  if (!execution) return err(`execution ${input.executionId} not found`);
  if (execution.status !== 'pending' && execution.status !== 'submitted')
    return ok({ status: 'settled', execution });

  const deadline = deps.now().getTime() + timeoutMs;

  // --- resolve a transaction hash ---------------------------------------------------------------
  let txHash = execution.txHash as Hex | null;
  while (!txHash && execution.userOpHash && deps.resolveTxHash) {
    try {
      txHash = await deps.resolveTxHash(execution.userOpHash as Hex);
    } catch {
      txHash = null; // transport hiccup: keep polling until the deadline, never resend
    }
    if (txHash) {
      await updateExecution(db, execution.id, { txHash });
      break;
    }
    if (deps.now().getTime() >= deadline) break;
    await sleep(pollMs);
  }
  if (!txHash) return markTimeout(deps, execution, 'no transaction hash within the timeout');

  // --- poll the receipt --------------------------------------------------------------------------
  let receipt: TransactionReceipt | undefined;
  for (;;) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    } catch {
      receipt = undefined; // not mined yet, or the node is behind — both mean "keep waiting"
    }
    if (receipt) break;
    if (deps.now().getTime() >= deadline)
      return markTimeout(deps, execution, 'no receipt within the timeout');
    await sleep(pollMs);
  }

  if (receipt.status !== 'success')
    return markFailed(deps, execution, input, `transaction reverted (status ${receipt.status})`);

  // --- (b) verify the effect ---------------------------------------------------------------------
  const observed = observedDeltas(receipt, input.token, input.holders);

  // One read is not state: force the node to serve the receipt's block before believing it.
  const settled = await readAtBlock(deps, input.token, input.holders.agent, receipt.blockNumber);
  if (!settled.ok)
    return markTimeout(deps, execution, `state at block ${receipt.blockNumber}: ${settled.error}`);

  const mismatch = compareDeltas(
    input.expectedDeltas,
    observed,
    VAULT_KINDS.has(execution.kind) ? VAULT_TOLERANCE_BPS : 0n,
  );
  if (mismatch)
    return markFailed(deps, execution, input, `effect does not match the proposal: ${mismatch}`);

  // --- confirmed ---------------------------------------------------------------------------------
  const now = deps.now();
  const confirmed = await updateExecution(db, execution.id, {
    status: 'confirmed',
    confirmedAt: now,
    gasUsed: receipt.gasUsed.toString(),
    txHash,
  });

  for (const delta of observed) {
    if (delta.delta === 0n || delta.holder !== 'agent') continue;
    await insertLedgerEntry(db, {
      walletId: execution.walletId,
      executionId: execution.id,
      token: delta.token,
      amount: delta.delta,
      direction: delta.delta < 0n ? 'out' : 'in',
      counterpartyLabel: input.counterpartyLabel ?? null,
      // USDC is 6-decimal, so base units ARE micro-USD at $1.00. The decision-time quote is
      // recorded on the verdict; this column is the accounting view used for the 24h window.
      usdMicro: delta.delta < 0n ? -delta.delta : delta.delta,
    });
  }

  if (input.obligationId) await setObligationStatus(db, input.obligationId, 'paid', execution.id);
  await resetBreakerFailures(db, execution.walletId);

  const audited = await appendAudit(db, {
    walletId: execution.walletId,
    actor: 'agent',
    event: 'EXECUTION_CONFIRMED',
    entityType: 'execution',
    entityId: execution.id,
    payload: {
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      deltas: observed.map((d) => ({ ...d, delta: d.delta.toString() })),
    },
    createdAt: now,
  });
  if (!audited.ok) return err(`audit failed after confirmation: ${audited.error.message}`);

  await notify(
    db,
    execution,
    'execution',
    'Action confirmed',
    `${execution.kind} confirmed on-chain`,
  );
  return ok({ status: 'confirmed', execution: confirmed ?? execution, deltas: observed });
}

/** Deltas measured from the receipt's own Transfer logs — the chain's account, not the model's. */
export function observedDeltas(
  receipt: TransactionReceipt,
  token: Address,
  holders: { agent: Address; treasury: Address; recipient?: Address | undefined },
): Delta[] {
  const watched: [Delta['holder'], string][] = [
    ['agent', holders.agent.toLowerCase()],
    ['treasury', holders.treasury.toLowerCase()],
    ...(holders.recipient
      ? ([['recipient', holders.recipient.toLowerCase()]] as [Delta['holder'], string][])
      : []),
  ];
  const totals = new Map<Delta['holder'], bigint>(watched.map(([h]) => [h, 0n]));

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    let decoded: { args: { from: Address; to: Address; value: bigint } };
    try {
      decoded = decodeEventLog({
        abi: TRANSFER_EVENT,
        data: log.data,
        topics: log.topics,
      }) as typeof decoded;
    } catch {
      continue; // not a Transfer (Approval, or a different event on the same token)
    }
    for (const [holder, address] of watched) {
      if (decoded.args.from.toLowerCase() === address)
        totals.set(holder, (totals.get(holder) ?? 0n) - decoded.args.value);
      if (decoded.args.to.toLowerCase() === address)
        totals.set(holder, (totals.get(holder) ?? 0n) + decoded.args.value);
    }
  }

  return watched.map(([holder]) => ({ token, holder, delta: totals.get(holder) ?? 0n }));
}

/**
 * Compare claimed deltas against measured ones. Exact for transfers; `toleranceBps` of the claimed
 * magnitude for share-price maths. Returns a human message on mismatch, `null` when they agree.
 */
export function compareDeltas(
  expected: readonly Delta[],
  observed: readonly Delta[],
  toleranceBps: bigint,
): string | null {
  for (const want of expected) {
    const got = observed.find(
      (o) => o.holder === want.holder && o.token.toLowerCase() === want.token.toLowerCase(),
    );
    if (!got) return `no measured delta for ${want.holder}`;
    const diff = got.delta - want.delta;
    const magnitude = want.delta < 0n ? -want.delta : want.delta;
    const allowed = (magnitude * toleranceBps) / 10_000n;
    const absDiff = diff < 0n ? -diff : diff;
    if (absDiff > allowed) return `${want.holder} expected ${want.delta}, measured ${got.delta}`;
  }
  return null;
}

/** Retry a read pinned to the receipt's block until the node actually serves it (lesson 1). */
async function readAtBlock(
  deps: ConfirmDeps,
  token: Address,
  holder: Address,
  blockNumber: bigint,
): Promise<Result<bigint, string>> {
  const sleep = deps.sleep ?? defaultSleep;
  let last = 'no attempt';
  for (const backoff of STATE_READ_BACKOFF_MS) {
    try {
      return ok(
        await deps.publicClient.readContract({
          address: token,
          abi: [
            {
              type: 'function',
              name: 'balanceOf',
              stateMutability: 'view',
              inputs: [{ name: 'a', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ] as const,
          functionName: 'balanceOf',
          args: [holder],
          blockNumber,
        }),
      );
    } catch (e) {
      last = String(e);
      await sleep(backoff);
    }
  }
  return err(last);
}

async function markTimeout(
  deps: ConfirmDeps,
  execution: ExecutionRow,
  reason: string,
): Promise<Result<ConfirmOutcome, string>> {
  const now = deps.now();
  // UNCERTAIN: the transaction may or may not land later. We do not touch the breaker (only FAILED
  // counts, AGENTKIT §4 step 7) and we never resend.
  const row = await updateExecution(deps.db, execution.id, { status: 'timeout', error: reason });
  const audited = await appendAudit(deps.db, {
    walletId: execution.walletId,
    actor: 'agent',
    event: 'EXECUTION_TIMEOUT',
    entityType: 'execution',
    entityId: execution.id,
    payload: {
      reason,
      needsReconcile: true,
      userOpHash: execution.userOpHash,
      txHash: execution.txHash,
    },
    createdAt: now,
  });
  if (!audited.ok) return err(`audit failed on timeout: ${audited.error.message}`);
  await notify(
    deps.db,
    execution,
    'risk',
    'Execution outcome unknown',
    `${execution.kind} did not confirm within the timeout and needs reconciliation. It was NOT resent.`,
  );
  return ok({ status: 'timeout', execution: row ?? execution });
}

async function markFailed(
  deps: ConfirmDeps,
  execution: ExecutionRow,
  input: ConfirmInput,
  reason: string,
): Promise<Result<ConfirmOutcome, string>> {
  const now = deps.now();
  const row = await updateExecution(deps.db, execution.id, { status: 'failed', error: reason });
  if (input.obligationId) await setObligationStatus(deps.db, input.obligationId, 'failed');
  const audited = await appendAudit(deps.db, {
    walletId: execution.walletId,
    actor: 'agent',
    event: 'EXECUTION_FAILED',
    entityType: 'execution',
    entityId: execution.id,
    payload: { reason, txHash: execution.txHash },
    createdAt: now,
  });
  if (!audited.ok) return err(`audit failed on failure: ${audited.error.message}`);

  const failures = await bumpBreakerFailures(deps.db, execution.walletId);
  if (failures >= BREAKER_FAILURE_THRESHOLD)
    await tripBreaker(
      deps.db,
      execution.walletId,
      `${failures} consecutive failed executions`,
      now,
    );

  await notify(deps.db, execution, 'blocked', 'Action failed', reason);
  return ok({ status: 'failed', execution: row ?? execution, reason });
}

/**
 * 5.7 — open the breaker and freeze. Called on 3 consecutive failures and (by the decision loop)
 * on an R14 rate-limit breach. Idempotent; a frozen wallet executes nothing but the owner path.
 */
export async function tripBreaker(
  db: Db,
  walletId: string,
  reason: string,
  now: Date,
): Promise<Result<true, string>> {
  await openBreaker(db, walletId, reason, now);
  const audited = await appendAudit(db, {
    walletId,
    actor: 'system',
    event: 'BREAKER_OPEN',
    entityType: 'wallet',
    entityId: walletId,
    payload: { reason, frozen: true },
    createdAt: now,
  });
  if (!audited.ok) return err(audited.error.message);
  const userId = await getUserIdForWallet(db, walletId);
  if (userId)
    await insertNotification(db, {
      userId,
      walletId,
      type: 'freeze',
      title: 'Circuit breaker opened — wallet frozen',
      body: reason,
    });
  return ok(true);
}

async function notify(
  db: Db,
  execution: ExecutionRow,
  type: 'execution' | 'blocked' | 'risk',
  title: string,
  body: string,
): Promise<void> {
  const userId = await getUserIdForWallet(db, execution.walletId);
  if (!userId) return;
  await insertNotification(db, {
    userId,
    walletId: execution.walletId,
    type,
    title,
    body,
    payload: { executionId: execution.id, kind: execution.kind },
  });
}
