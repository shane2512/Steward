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

// 8.7 red-team (RT-2): numeric ids only. Telegram also accepts `@publicchannel` as a `chat_id`,
// which would let a hijacked session redirect an owner's treasury notifications into a public
// channel. A real private/group chat id is always an integer (negative for groups), so restricting
// the shape costs the owner nothing and removes that target class entirely. Empty string unlinks.
const CHAT_ID = /^-?\d{1,32}$/;
const body = z.object({
  chatId: z
    .string()
    .trim()
    .max(64)
    .refine((v) => v === '' || CHAT_ID.test(v), 'a Telegram chat id is a number')
    .nullable(),
});

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'chatId (string or null) is required');

  const chatId = parsed.data.chatId === '' ? null : parsed.data.chatId;
  await setTelegramChatId(owner.db, owner.userId, chatId);
  return Response.json({ chatId });
}
