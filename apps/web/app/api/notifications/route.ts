// GET /api/notifications?limit=&before= — the owner's own in-app notification center (task 8.5).
//
// Newest-first (an owner opening the bell wants to know what JUST happened, not what is oldest and
// unread — unread state is a badge on each row instead, so nothing gets buried by being unread but
// old). Keyset-paginated by id, the same shape as `/api/audit`.
import { z } from 'zod';
import { listNotifications, unreadNotificationCount } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const zQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const parsed = zQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));
  const { limit, before } = parsed.data;

  const page = await listNotifications(owner.db, owner.userId, {
    limit: limit + 1,
    ...(before ? { beforeId: before } : {}),
  });
  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  const unread = await unreadNotificationCount(owner.db, owner.userId);

  return Response.json({
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
    unreadCount: unread,
  });
}
