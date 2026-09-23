// GET /api/reports/weekly/export?format=csv|json — task 8.6.
//
// The report job (apps/worker/src/jobs/weeklyReport.ts) writes one `notifications` row per wallet
// per week (type 'report'); its `payload` IS the computed numbers. Rather than a second table that
// could drift from what the notification says, this route just serves the newest one back out —
// same "one source of truth" reasoning as `/api/audit/export` reusing `auditRowJson`.
import { z } from 'zod';
import { latestNotificationOfType } from '@steward/db';
import { csvField } from '@/lib/auditRows';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const zQuery = z.object({ format: z.enum(['csv', 'json']).default('json') });

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiError(400, 'bad_request', 'format must be csv or json');

  const row = await latestNotificationOfType(owner.db, owner.userId, 'report');
  if (!row || row.walletId !== wallet.id)
    return apiError(404, 'no_report', 'no weekly report has run for this wallet yet');
  const payload = row.payload as {
    windowStart: string;
    windowEnd: string;
    yieldMicroUsd: string;
    paymentsMicroUsd: string;
    paymentsCount: number;
    blockedCount: number;
  };

  if (parsed.data.format === 'json') return Response.json(payload);

  const header = 'windowStart,windowEnd,yieldMicroUsd,paymentsMicroUsd,paymentsCount,blockedCount';
  const line = [
    payload.windowStart,
    payload.windowEnd,
    payload.yieldMicroUsd,
    payload.paymentsMicroUsd,
    payload.paymentsCount,
    payload.blockedCount,
  ]
    .map(csvField)
    .join(',');
  return new Response(`${header}\n${line}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="steward-weekly-report-${wallet.id}.csv"`,
    },
  });
}
