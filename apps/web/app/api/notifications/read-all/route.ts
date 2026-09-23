// POST /api/notifications/read-all — mark every unread notification of the owner's own read (task 8.5).
import { markAllNotificationsRead } from '@steward/db';
import { isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  await markAllNotificationsRead(owner.db, owner.userId, new Date());
  return Response.json({ ok: true });
}
