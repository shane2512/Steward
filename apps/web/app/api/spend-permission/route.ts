// POST /api/spend-permission — store an owner-signed permission.
// GET  /api/spend-permission — status of this wallet's permissions.
//
// Everything the client posts is re-derived or re-checked here: the permission must name the session
// owner as `account` and that user's own agent wallet as `spender`, USDC as the token, terms within
// the system ceilings, a window that is not in the past — and the signature must come from a smart
// contract wallet, never a plain EOA (D-5).
import {
  appendAudit,
  getActiveSpendPermission,
  insertSpendPermission,
  listSpendPermissions,
} from '@steward/db';
import { getEnv } from '@steward/shared';
import {
  assertSmartWalletAccount,
  isRevoked,
  parseSpendPermission,
  prepareTypedData,
  readAllowanceRemaining,
  serializeSpendPermission,
  spendPermissionHash,
  validateSpendPermission,
} from '@steward/wallet';
import { getAddress } from 'viem';
import { apiError, getPublicClient } from '@/lib/server';
import { isResponse, requireOwner, requireProvisioned, requireWallet } from '@/lib/wallet';
import { zStoreBody } from '@/lib/walletSchemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;
  const agentWalletAddress = requireProvisioned(wallet);
  if (isResponse(agentWalletAddress)) return agentWalletAddress;

  const parsed = zStoreBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'permission and signature are required');

  const permission = parseSpendPermission(parsed.data.permission);
  if (!permission.ok) return apiError(400, 'bad_permission', permission.error);

  const env = getEnv();
  const valid = validateSpendPermission(permission.value, {
    ownerAddress: owner.address,
    agentWalletAddress,
    usdcAddress: getAddress(env.USDC_ADDRESS),
    now: Math.floor(Date.now() / 1000),
  });
  if (!valid.ok)
    return Response.json(
      { error: { code: 'invalid_terms', issues: valid.error } },
      { status: 400 },
    );

  const manager = getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS);
  const typedData = prepareTypedData(permission.value, wallet.chainId, manager);
  const accountKind = await assertSmartWalletAccount(getPublicClient(), {
    typedData,
    signature: parsed.data.signature,
  });
  if (!accountKind.ok) return apiError(400, 'bad_signature', accountKind.error);

  const permissionHash = spendPermissionHash(permission.value, wallet.chainId, manager);

  // I6: audit the grant before it becomes usable. D-16 — the signature itself must never reach the
  // audit payload, so only its hash and the account kind are recorded.
  const audit = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'SPEND_PERMISSION_GRANTED',
    entityType: 'spend_permission',
    entityId: permissionHash,
    payload: {
      permission: serializeSpendPermission(permission.value),
      permissionHash,
      accountKind: accountKind.value,
    },
  });
  if (!audit.ok) return apiError(500, 'audit_failed', audit.error.code);

  const row = await insertSpendPermission(owner.db, {
    walletId: wallet.id,
    permission: serializeSpendPermission(permission.value),
    signature: parsed.data.signature,
    permissionHash,
  });

  return Response.json({
    id: row.id,
    permissionHash,
    status: row.status,
    accountKind: accountKind.value,
  });
}

export async function GET() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const env = getEnv();
  const manager = getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS);
  const client = getPublicClient();

  const active = await getActiveSpendPermission(owner.db, wallet.id);
  let onchain: { revoked: boolean; allowanceRemaining: string } | null = null;
  if (active) {
    const parsed = parseSpendPermission(active.permission);
    if (parsed.ok) {
      const [revoked, remaining] = await Promise.all([
        isRevoked(client, manager, parsed.value),
        readAllowanceRemaining(client, manager, parsed.value),
      ]);
      onchain = {
        revoked: revoked.ok ? revoked.value : true, // unknown ⇒ treat as revoked (fail closed)
        allowanceRemaining: (remaining.ok ? remaining.value : 0n).toString(),
      };
    }
  }

  const all = await listSpendPermissions(owner.db, wallet.id);
  return Response.json({
    // Signatures are never returned by the API (I9 / SECURITY §6).
    permissions: all.map((p) => ({
      id: p.id,
      permissionHash: p.permissionHash,
      status: p.status,
      permission: p.permission,
      approvedTxHash: p.approvedTxHash,
      createdAt: p.createdAt,
      revokedAt: p.revokedAt,
    })),
    active: active ? { id: active.id, permissionHash: active.permissionHash, onchain } : null,
  });
}
