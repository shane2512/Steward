// GET /api/audit/export?format=csv|json — S10 (task 7.7): a plain export of the owner's own
// append-only audit chain. Read-only; cursor-paginated by row id rather than streamed (see
// packages/db's listAuditPage ponytail note — fine at hackathon scale, upgrade if it ever isn't).
//
// Every row exported here was already checked for secret-looking keys when it was WRITTEN
// (appendAudit refuses those, SECURITY §6), so there is nothing to redact on the way out.
import { z } from 'zod';
import { listAuditPage } from '@steward/db';
import { canonicalJson } from '@steward/shared';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const zQuery = z.object({
  format: z.enum(['csv', 'json']),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  cursor: z.coerce.number().int().positive().optional(),
});

const csvField = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));
  const { format, limit, cursor } = parsed.data;

  // One extra row to know whether there is a next page, without a second round trip.
  const page = await listAuditPage(owner.db, wallet.id, { limit: limit + 1, afterId: cursor });
  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

  if (format === 'json') {
    return Response.json({
      rows: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actor: r.actor,
        event: r.event,
        entityType: r.entityType,
        entityId: r.entityId,
        payload: JSON.parse(canonicalJson(r.payload)) as unknown,
        prevHash: r.prevHash,
        rowHash: r.rowHash,
      })),
      nextCursor,
    });
  }

  const header = 'id,createdAt,actor,event,entityType,entityId,payload,prevHash,rowHash';
  const lines = rows.map((r) =>
    [
      r.id,
      r.createdAt.toISOString(),
      r.actor,
      r.event,
      r.entityType ?? '',
      r.entityId ?? '',
      canonicalJson(r.payload),
      r.prevHash,
      r.rowHash,
    ]
      .map(csvField)
      .join(','),
  );
  return new Response([header, ...lines].join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="steward-audit-${wallet.id}.csv"`,
      ...(nextCursor !== null ? { 'x-next-cursor': String(nextCursor) } : {}),
    },
  });
}
