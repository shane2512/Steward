// POST /api/spend-permission/prepare — build the EIP-712 payload for the owner's wallet to sign.
//
// The server chooses `account` (the session owner) and `spender` (that user's own agent wallet), so
// the client cannot point a permission at someone else's treasury or at a third-party spender. The
// result is validated here too: a payload that would fail on POST is never handed out.
import { randomBytes } from 'node:crypto';
import { getEnv } from '@steward/shared';
import {
  buildSpendPermission,
  prepareTypedData,
  serializeSpendPermission,
  spendPermissionHash,
  validateSpendPermission,
} from '@steward/wallet';
import { getAddress } from 'viem';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireProvisioned, requireWallet } from '@/lib/wallet';
import { zPrepareBody } from '@/lib/walletSchemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;
  const agentWalletAddress = requireProvisioned(wallet);
  if (isResponse(agentWalletAddress)) return agentWalletAddress;

  const parsed = zPrepareBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));

  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const permission = buildSpendPermission({
    account: owner.address, // never client-supplied
    spender: agentWalletAddress, // never client-supplied
    token: getAddress(env.USDC_ADDRESS),
    allowance: parsed.data.allowance,
    periodSeconds: parsed.data.periodSeconds,
    start: parsed.data.start ?? now,
    end: parsed.data.end,
    // 128 bits of entropy: two permissions with identical terms still hash differently, so replacing
    // one does not silently re-use a revoked permission's hash.
    salt: BigInt(`0x${randomBytes(16).toString('hex')}`),
  });

  const valid = validateSpendPermission(permission, {
    ownerAddress: owner.address,
    agentWalletAddress,
    usdcAddress: getAddress(env.USDC_ADDRESS),
    now,
  });
  if (!valid.ok)
    return Response.json(
      { error: { code: 'invalid_terms', issues: valid.error } },
      { status: 400 },
    );

  const manager = getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS);
  const typedData = prepareTypedData(permission, wallet.chainId, manager);
  return Response.json({
    // `message` is serialized with decimal strings so the client can hand it to eth_signTypedData_v4
    // and POST it back byte-identically.
    typedData: { ...typedData, message: serializeSpendPermission(permission) },
    permissionHash: spendPermissionHash(permission, wallet.chainId, manager),
  });
}
