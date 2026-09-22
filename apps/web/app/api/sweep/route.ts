// GET  /api/sweep — the current state of the sweep step (for progress and for resuming).
// POST /api/sweep — **sensitive**: bring everything home (SECURITY §4 step 4, Phase 5.8).
//
// This route calls `sweepHome` from `@steward/wallet` directly rather than enqueueing a job: I7
// says the owner path works when the WORKER is down too, and a sweep that waited for a dead queue
// would not. It is not a bypass — `sweepHome` builds an `source: 'owner'` proposal, simulates it,
// runs the real `evaluate()` (R03 requires owner-sourced sweeps, R11 requires simulation parity)
// and still needs a signed AllowReceipt before the executor will send anything.
//
// Frozen is required, not merely tolerated: the sweep is the ONLY action allowed while frozen
// (SECURITY §4), and asking for it on a running wallet would race the decision loop.
//
// Idempotency is the executor's (I10): the proposal hash keys the `executions` row, so a repeated
// POST for an unchanged position finds the same slot instead of sending twice. A retry after a
// FAILED sweep re-reads balances first, so it is a fresh decision, never a blind resend.
import { insertAgentDecision } from '@steward/db';
import { getEnv, hashCanonical } from '@steward/shared';
import { sweepHome } from '@steward/wallet';
import { getAddress } from 'viem';
import { ownerPathStatus } from '@/lib/ownerPath';
import { apiError, getDb, getPublicClient } from '@/lib/server';
import { getAgentSender, isResponse, receiptKey, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;
  const status = await ownerPathStatus(owner.db, wallet);
  return Response.json(status.sweep);
}

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  if (!wallet.frozen)
    return apiError(
      409,
      'not_frozen',
      'freeze Steward first; a sweep only runs on a stopped wallet',
    );

  const now = new Date();
  // The snapshot is what the owner asked for and when — there is no context builder on this path
  // (and there must not be: that is reasoning's side of the house).
  const contextSnapshot = { source: 'owner', action: 'sweep_home', requestedAt: now.toISOString() };
  const decision = await insertAgentDecision(getDb(), {
    walletId: wallet.id,
    trigger: 'owner',
    contextSnapshot,
    contextHash: hashCanonical(contextSnapshot),
    proposalSource: 'owner',
    status: 'pending',
  });

  let sender;
  try {
    sender = await getAgentSender(owner.userId);
  } catch (e) {
    return apiError(502, 'wallet_unavailable', `the agent wallet is unreachable: ${String(e)}`);
  }

  const swept = await sweepHome(
    {
      db: owner.db,
      publicClient: getPublicClient(),
      sender,
      receiptKey: receiptKey(),
      now: () => new Date(),
      spendPermissionManagerAddress: getAddress(getEnv().SPEND_PERMISSION_MANAGER_ADDRESS),
      decisionId: decision.id,
    },
    wallet.id,
  );

  if (!swept.ok) {
    const status = swept.error.code === 'NOTHING_TO_SWEEP' ? 200 : 409;
    if (status === 200) return Response.json({ state: 'none', nothingToSweep: true });
    return Response.json(
      {
        error: {
          code: swept.error.code.toLowerCase(),
          message: swept.error.message,
          ...(swept.error.verdict ? { verdict: swept.error.verdict.decision } : {}),
        },
      },
      { status },
    );
  }

  // `outcome.status` is what the EXECUTOR did (submitted / duplicate / cancelled); the row's own
  // status is what the CHAIN is doing, which is what the progress UI polls.
  const row = swept.value.execution?.execution;
  return Response.json({
    state: row?.status ?? 'none',
    txHash: row?.txHash ?? null,
    verdict: swept.value.verdict.decision,
  });
}
