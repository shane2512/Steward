// POST /api/agent/run — "run an iteration now" (API.md).
//
// This ENQUEUES; it does not decide. The web process never imports the decision loop, reasoning or
// the executor (6.8): it drops a `loop.run` job and the worker does the work under the per-wallet
// advisory lock, so pressing the button twice cannot produce two concurrent iterations.
import { rateLimit } from '@/lib/rateLimit';
import { apiError } from '@/lib/server';
import { enqueueLoopRun } from '@/lib/queue';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  // 8.2 — one iteration is a SERV call plus chain reads plus a simulation. Per owner.
  const limited = rateLimit('agent.run', owner.userId);
  if (limited) return limited;

  if (wallet.frozen) return apiError(409, 'frozen', 'the wallet is frozen');
  if (wallet.breakerOpen) return apiError(409, 'breaker_open', 'the circuit breaker is open');

  try {
    const jobId = await enqueueLoopRun(wallet.id, 'owner');
    return Response.json({ enqueued: true, jobId });
  } catch (e) {
    return apiError(503, 'queue_unavailable', `could not enqueue the iteration: ${String(e)}`);
  }
}
