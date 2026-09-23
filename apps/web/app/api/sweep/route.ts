// GET  /api/sweep — the current state of the sweep step (for progress and for resuming).
// POST /api/sweep — **sensitive**: bring everything home (SECURITY §4 step 4, Phase 5.8). Since 8.2
// it needs a fresh owner signature over a server-issued message, exactly like freeze/unfreeze.
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
import { z } from 'zod';
import { insertAgentDecision } from '@steward/db';
import { getEnv, hashCanonical, zHex } from '@steward/shared';
import { sweepHome } from '@steward/wallet';
import { getAddress } from 'viem';
import { ownerPathStatus, verifyFreezeSignature } from '@/lib/ownerPath';
import { rateLimit } from '@/lib/rateLimit';
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

const body = z.object({ signature: zHex }).strict();

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  // 8.2 — a real on-chain transaction, so it is rate limited (freeze itself is not: I7).
  const limited = rateLimit('sweep', owner.userId);
  if (limited) return limited;

  // 8.2 — a fresh owner signature, like freeze and unfreeze. The nonce and the ACTION come from the
  // session (`/api/freeze/prepare` with `action: 'sweep'`), so a captured freeze signature cannot be
  // spent here and a captured sweep signature cannot be replayed at all.
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'signature is required');
  const refusal = await verifyFreezeSignature({
    owner,
    walletId: wallet.id,
    action: 'sweep',
    signature: parsed.data.signature,
  });
  if (refusal) return refusal;

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
