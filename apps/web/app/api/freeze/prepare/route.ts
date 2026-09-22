// POST /api/freeze/prepare — the literal message the owner signs to freeze OR unfreeze (task 7.8).
//
// One route for both actions because they are one code path with one nonce: the action is stored in
// the session next to the nonce, and the confirming route re-derives the message from THAT, so the
// browser cannot turn an unfreeze confirmation into a freeze (or the reverse).
//
// Owner path (I7): no reasoning import, no worker, no LLM. It reads a session and mints a nonce.
import { z } from 'zod';
import { issueFreezeMessage } from '@/lib/ownerPath';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ action: z.enum(['freeze', 'unfreeze']) }).strict();

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'action must be freeze or unfreeze');

  return Response.json(await issueFreezeMessage(parsed.data.action, wallet.id));
}
