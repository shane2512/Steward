// POST /api/notifications/:id/read — mark one of the owner's own notifications read (task 8.5).
// Scoped to `owner.userId` inside the UPDATE itself, so one owner can never mark another's read.
import { markNotificationRead } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const { id } = await ctx.params;
  const row = await markNotificationRead(owner.db, owner.userId, id, new Date());
  if (!row) return apiError(404, 'not_found', 'notification not found');
  return Response.json({ id: row.id, read: true });
}
