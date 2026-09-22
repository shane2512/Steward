import { z } from 'zod';
import { ensureWalletForUser, getWalletByUserId, upsertUserByAddress } from '@steward/db';
import { getEnv, zHex, type Address } from '@steward/shared';
import { resolveTreasuryAddress } from '@/lib/treasury';
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

  // First sign-in creates the wallet row; the treasury it names is fixed forever after (it is the
  // sweep-home destination and the spend-permission account), so it is only ever chosen once.
  //
  // Which address? The treasury must be a Coinbase Smart Wallet — a plain EOA cannot grant a spend
  // permission (D-5). The SIWE signature we just verified says which we have: a contract wallet
  // either has code or wrapped its signature in ERC-6492. If it did neither it is an EOA, and the
  // treasury becomes the Coinbase Smart Wallet that EOA owns (derived, counterfactual), with the
  // EOA staying the sign-in identity in `users.owner_address`.
  //
  // Both halves fail closed (I5): an RPC we cannot complete refuses the sign-in rather than
  // guessing, because guessing "EOA" strands nothing but guessing "smart wallet" strands everything.
  const existing = await getWalletByUserId(getDb(), user.id);
  if (!existing) {
    const treasury = await resolveTreasuryAddress(client, {
      ownerAddress: user.ownerAddress as Address,
      siweSignature: parsed.data.signature,
    });
    if (!treasury.ok) return apiError(503, 'treasury_unavailable', treasury.error);
    await ensureWalletForUser(getDb(), user.id, getEnv().CHAIN_ID, treasury.value.address);
  }
  session.nonce = undefined; // single use
  session.nonceIssuedAt = undefined;
  session.userId = user.id;
  session.address = user.ownerAddress;
  await session.save();
  return Response.json({ user: { id: user.id, address: user.ownerAddress } });
}
