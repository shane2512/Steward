import { generateSiweNonce } from 'viem/siwe';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  session.nonce = generateSiweNonce();
  session.nonceIssuedAt = Date.now();
  await session.save();
  return Response.json({ nonce: session.nonce });
}
