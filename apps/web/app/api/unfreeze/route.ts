// POST /api/unfreeze — **sensitive**: let Steward run again (SECURITY §5, S10).
//
// `setWalletFrozen(db, id, false, …)` also clears `breaker_open` and the consecutive-failure count,
// which is exactly what SECURITY §5 asks for ("unfreeze requires owner signature and resets the
// circuit breaker") — one owner signature both un-stops the wallet and clears the state that
// stopped it, so a breaker-frozen wallet cannot be half-restarted.
//
// Unfreezing does NOT restore the spend permission: if the owner revoked it during the freeze, they
// must grant a new one. That asymmetry is deliberate — stopping is one signature, re-arming the
// on-chain cap is another.
//
// I7: same owner path as freeze. No reasoning, no worker, no queue.
import { z } from 'zod';
import { appendAudit, setWalletFrozen } from '@steward/db';
import { zHex } from '@steward/shared';
import { ownerPathStatus, verifyFreezeSignature } from '@/lib/ownerPath';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ signature: zHex }).strict();

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
    action: 'unfreeze',
    signature: parsed.data.signature,
  });
  if (refusal) return refusal;

  if (!wallet.frozen)
    return Response.json({
      ...(await ownerPathStatus(owner.db, wallet)),
      alreadyRunning: true,
    });

  const now = new Date();
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'UNFROZEN',
    entityType: 'wallet',
    entityId: wallet.id,
    payload: { signer: owner.address, breakerReset: wallet.breakerOpen },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  await setWalletFrozen(owner.db, wallet.id, false, null, now);
  return Response.json({
    ...(await ownerPathStatus(owner.db, {
      ...wallet,
      frozen: false,
      frozenAt: null,
      frozenReason: null,
      breakerOpen: false,
    })),
    alreadyRunning: false,
  });
}
