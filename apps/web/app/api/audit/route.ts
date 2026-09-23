// GET /api/audit?cursor= — the owner's own append-only audit chain, raw and paginated (API.md
// "Audit & export", task 8.4).
//
// This is the LISTING: JSON, oldest first, `nextCursor` for the next page, no attachment headers.
// `/api/audit/export` is the same rows as a downloadable file (CSV or JSON) and `/api/audit/verify`
// recomputes the chain. All three share `auditRowJson` so they cannot disagree about a row's shape.
//
// Read-only and owner-scoped: `listAuditPage` is filtered to this wallet, so one owner can never
// page into another's chain. Rows carry `prevHash`/`rowHash` so a caller can verify the chain
// themselves rather than taking `/api/audit/verify`'s word for it (SECURITY §7).
import { z } from 'zod';
import { listAuditPage } from '@steward/db';
import { auditRowJson } from '@/lib/auditRows';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const zQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));
  const { limit, cursor } = parsed.data;

  // One extra row tells us whether there is a next page without a second round trip.
  const page = await listAuditPage(owner.db, wallet.id, { limit: limit + 1, afterId: cursor });
  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  return Response.json({
    rows: rows.map(auditRowJson),
    nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
  });
}
