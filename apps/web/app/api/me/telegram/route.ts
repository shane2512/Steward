// POST /api/me/telegram — link or unlink the owner's Telegram chat id (S10 Settings, task 8.5).
//
// A chat id is not a secret: it only lets Steward SEND to that chat, and the owner must have
// messaged the bot first to get it (Telegram never hands a chat id to anyone else). Empty/absent
// body unlinks. No signature required — this is a notification preference, not a money-moving or
// security-relevant action.
import { z } from 'zod';
import { setTelegramChatId } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ chatId: z.string().trim().max(64).nullable() });

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'chatId (string or null) is required');

  const chatId = parsed.data.chatId === '' ? null : parsed.data.chatId;
  await setTelegramChatId(owner.db, owner.userId, chatId);
  return Response.json({ chatId });
}
