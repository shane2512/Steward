// POST /api/spend-permission/revoked — the owner reports the revoke transaction they sent (API.md).
//
// Steward does NOT broadcast this one. `SpendPermissionManager.revoke(permission)` must be called
// by the permission's `account` — the owner's own smart wallet — so the freeze flow builds the
// calldata (`encodeRevoke`, Phase 2) and the owner's wallet sends it. This route only records what
// the CHAIN says afterwards.
//
// 8.1: the recording itself lives in `recordRevocationIfRevoked` (@steward/wallet), shared with the
// worker's `permission.scan`, so an owner-reported revoke and one the scan discovers out-of-band
// leave exactly the same rows behind. This route is the HTTP shell: session, body, status mapping.
//
// The reported `txHash` is never trusted as proof: the shared function reads `isRevoked` from the
// manager and only marks the row revoked when the chain agrees (I5 — an unreadable chain is not a
// revocation). Idempotent: reporting an already-recorded revoke is a successful no-op.
import { z } from 'zod';
import { getEnv, zHex } from '@steward/shared';
import { recordRevocationIfRevoked } from '@steward/wallet';
import { getAddress } from 'viem';
import { apiError, getPublicClient } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ txHash: zHex }).strict();

const STATUS: Record<'bad_permission' | 'chain_unreadable' | 'audit_failed', number> = {
  bad_permission: 500,
  chain_unreadable: 502,
  audit_failed: 503,
};

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'txHash is required');

  const recorded = await recordRevocationIfRevoked({
    db: owner.db,
    publicClient: getPublicClient(),
    manager: getAddress(getEnv().SPEND_PERMISSION_MANAGER_ADDRESS),
    walletId: wallet.id,
    actor: 'owner',
    txHash: parsed.data.txHash,
    now: new Date(),
  });
  if (!recorded.ok)
    return apiError(STATUS[recorded.error.code], recorded.error.code, recorded.error.message);

  switch (recorded.value.state) {
    case 'none':
      return apiError(404, 'no_permission', 'this wallet has no spend permission to revoke');
    case 'not-revoked':
      return apiError(
        409,
        'not_revoked_onchain',
        'the chain still shows this permission as live; wait for the transaction to confirm and try again',
      );
    case 'already-recorded':
      return Response.json({ revoked: true, alreadyRevoked: true });
    case 'recorded':
      return Response.json({ revoked: true, alreadyRevoked: false });
  }
}
