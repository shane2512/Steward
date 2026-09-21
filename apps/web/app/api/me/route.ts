import { getUserById, getWalletByUserId } from '@steward/db';
import { fixtureFor } from '@/lib/fixture';
import { fixtureMe } from '@/lib/fixtures';
import { getSession } from '@/lib/session';
import { apiError, getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Dev-only fixture switch (lib/fixtureGate.ts): canned payload, no session, no real data.
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureMe(fx));

  const { userId } = await getSession();
  if (!userId) return apiError(401, 'unauthorized', 'sign in required');
  const db = getDb();
  const user = await getUserById(db, userId);
  if (!user) return apiError(401, 'unauthorized', 'unknown user');
  const w = await getWalletByUserId(db, userId);
  return Response.json({
    user: { id: user.id, address: user.ownerAddress, displayName: user.displayName },
    wallet: w
      ? { id: w.id, chainId: w.chainId, agentWalletAddress: w.agentWalletAddress, frozen: w.frozen }
      : null,
  });
}
