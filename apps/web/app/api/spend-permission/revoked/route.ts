// POST /api/spend-permission/revoked — the owner reports the revoke transaction they sent (API.md).
//
// Steward does NOT broadcast this one. `SpendPermissionManager.revoke(permission)` must be called
// by the permission's `account` — the owner's own smart wallet — so the freeze flow builds the
// calldata (`encodeRevoke`, Phase 2) and the owner's wallet sends it. This route only records what
// the CHAIN says afterwards.
//
// The reported `txHash` is never trusted as proof: the route reads `isRevoked(permission)` from the
// manager and only marks the row revoked when the chain agrees (I5 — an unreadable chain is not a
// revocation). Idempotent: reporting an already-recorded revoke is a successful no-op.
import { z } from 'zod';
import {
  appendAudit,
  getActiveSpendPermission,
  listSpendPermissions,
  markSpendPermissionRevoked,
} from '@steward/db';
import { getEnv, zHex } from '@steward/shared';
import { isRevoked, parseSpendPermission } from '@steward/wallet';
import { getAddress } from 'viem';
import { apiError, getPublicClient } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ txHash: zHex }).strict();

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'txHash is required');

  const active = await getActiveSpendPermission(owner.db, wallet.id);
  if (!active) {
    // Nothing active to revoke. If one was already revoked, that is the answer the owner wants.
    const all = await listSpendPermissions(owner.db, wallet.id);
    if (all.some((p) => p.status === 'revoked'))
      return Response.json({ revoked: true, alreadyRevoked: true });
    return apiError(404, 'no_permission', 'this wallet has no spend permission to revoke');
  }

  const permission = parseSpendPermission(active.permission);
  if (!permission.ok) return apiError(500, 'bad_permission', permission.error);

  const manager = getAddress(getEnv().SPEND_PERMISSION_MANAGER_ADDRESS);
  const onchain = await isRevoked(getPublicClient(), manager, permission.value);
  if (!onchain.ok) return apiError(502, 'chain_unreadable', onchain.error);
  if (!onchain.value)
    return apiError(
      409,
      'not_revoked_onchain',
      'the chain still shows this permission as live; wait for the transaction to confirm and try again',
    );

  const now = new Date();
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'SPEND_PERMISSION_REVOKED',
    entityType: 'spend_permission',
    entityId: active.permissionHash,
    payload: { permissionHash: active.permissionHash, txHash: parsed.data.txHash },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  await markSpendPermissionRevoked(owner.db, active.id, now);
  return Response.json({ revoked: true, alreadyRevoked: false });
}
