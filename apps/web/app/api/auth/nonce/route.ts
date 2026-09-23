import { generateSiweNonce } from 'viem/siwe';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// 8.2 — unauthenticated, so the limit is per client IP.
export async function GET(req: Request) {
  const limited = rateLimit('auth.nonce', clientIp(req));
  if (limited) return limited;

  const session = await getSession();
  session.nonce = generateSiweNonce();
  session.nonceIssuedAt = Date.now();
  await session.save();
  return Response.json({ nonce: session.nonce });
}
