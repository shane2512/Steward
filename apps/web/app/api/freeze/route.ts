// GET  /api/freeze — the server's view of all three S9 steps, so the modal can RESUME.
// POST /api/freeze — **sensitive**: stop Steward now, on the owner's signature (SECURITY §4).
//
// SECURITY §4 lists the freeze path in order:
//   1. set `wallets.frozen = true` (the executor re-checks it before every send, and again at
//      receipt verification, so an in-flight decision cannot slip past);
//   2. cancel all pending approvals for the wallet — an owner approval is a standing permission to
//      act, and freezing means "act on nothing", so leaving them redeemable would contradict it;
//   3. hand back the unsigned revoke transaction for the owner's OWN wallet to send (GET/POST both
//      return it as part of the status; Steward never broadcasts it);
//   4. offer the sweep.
//
// I7: no reasoning, no worker, no queue. Freezing is a session, a signature, one UPDATE and audit
// rows — it works with SERV down, the LLM down and the worker dead.
// I5/I6: the audit row is written BEFORE the flag flips; a failed audit write refuses the freeze
// loudly rather than freezing silently.
//
// Idempotent: freezing an already-frozen wallet is a successful no-op (it still requires a valid
// signature, but it does not error, does not re-audit and does not re-cancel).
import { z } from 'zod';
import { appendAudit, cancelPendingApprovals, setWalletFrozen } from '@steward/db';
import { zHex } from '@steward/shared';
import { fixtureFor } from '@/lib/fixture';
import { fixtureOwnerPath } from '@/lib/fixtures';
import { ownerPathStatus, verifyFreezeSignature } from '@/lib/ownerPath';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ signature: zHex }).strict();

export async function GET(req: Request) {
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureOwnerPath(fx));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;
  return Response.json(await ownerPathStatus(owner.db, wallet));
}

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'signature is required');

  const refusal = await verifyFreezeSignature({
    owner,
    walletId: wallet.id,
    action: 'freeze',
    signature: parsed.data.signature,
  });
  if (refusal) return refusal;

  if (wallet.frozen) {
    // Already stopped. Nothing to do and nothing to record — report the state and move on to the
    // steps that are still outstanding.
    return Response.json({
      ...(await ownerPathStatus(owner.db, { ...wallet })),
      alreadyFrozen: true,
      cancelledApprovals: 0,
    });
  }

  const now = new Date();
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'FROZEN',
    entityType: 'wallet',
    entityId: wallet.id,
    payload: { reason: 'owner freeze', signer: owner.address },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  await setWalletFrozen(owner.db, wallet.id, true, 'owner freeze', now);
  const cancelled = await cancelPendingApprovals(owner.db, wallet.id, now);
  for (const row of cancelled) {
    await appendAudit(owner.db, {
      walletId: wallet.id,
      actor: 'owner',
      event: 'APPROVAL_CANCELLED',
      entityType: 'approval',
      entityId: row.id,
      payload: { reason: 'wallet frozen', proposalHash: row.proposalHash },
      createdAt: now,
    });
  }

  return Response.json({
    ...(await ownerPathStatus(owner.db, {
      ...wallet,
      frozen: true,
      frozenAt: now,
      frozenReason: 'owner freeze',
    })),
    alreadyFrozen: false,
    cancelledApprovals: cancelled.length,
  });
}
