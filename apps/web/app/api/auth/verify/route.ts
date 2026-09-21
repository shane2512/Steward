import { z } from 'zod';
import { ensureWalletForUser, upsertUserByAddress } from '@steward/db';
import { getEnv, zHex } from '@steward/shared';
import { verifySiwe } from '@/lib/siwe';
import { getSession } from '@/lib/session';
import { apiError, getDb, getPublicClient } from '@/lib/server';

export const dynamic = 'force-dynamic';

const body = z.object({ message: z.string().min(1).max(4096), signature: zHex });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'message and signature are required');
  const session = await getSession();
  const client = getPublicClient();
  const r = await verifySiwe({
    message: parsed.data.message,
    signature: parsed.data.signature,
    expectedNonce: session.nonce,
    nonceIssuedAt: session.nonceIssuedAt,
    domain: new URL(req.url).host,
    chainId: getEnv().CHAIN_ID,
    now: new Date(),
    verify: (a) => client.verifyMessage(a),
  });
  if (!r.ok) return apiError(401, 'unauthorized', r.error);
  const user = await upsertUserByAddress(getDb(), r.value, new Date());
  // First sign-in creates the wallet row (treasury = the owner's own smart wallet). Idempotent.
  await ensureWalletForUser(getDb(), user.id, getEnv().CHAIN_ID, user.ownerAddress);
  session.nonce = undefined; // single use
  session.nonceIssuedAt = undefined;
  session.userId = user.id;
  session.address = user.ownerAddress;
  await session.save();
  return Response.json({ user: { id: user.id, address: user.ownerAddress } });
}
