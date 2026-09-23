// GET /api/export?format=csv|json — the owner's LEDGER and DECISIONS (API.md "Audit & export",
// task 8.4). The audit chain has its own export at `/api/audit/export`; this is the accounting view:
// what moved, and what Steward decided.
//
// Read-only, owner-scoped, no reasoning and no chain reads — two selects and a serialiser.
//
// I12: `amount` and `usdMicro` are `bigint` base units in the database and are emitted as DECIMAL
// STRINGS, never JS numbers, so a 7-figure micro-USD total survives the round trip intact.
//
// CSV carries both datasets in one file as two labelled sections separated by a blank line, because
// a ledger row and a decision row do not share columns and the owner asked for one download. Anyone
// who wants exactly one table asks for it with `dataset`.
import { z } from 'zod';
import { listAgentDecisions, listLedgerPage } from '@steward/db';
import { csvRows } from '@/lib/auditRows';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const zQuery = z.object({
  format: z.enum(['csv', 'json']),
  dataset: z.enum(['all', 'ledger', 'decisions']).default('all'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const LEDGER_HEADER = [
  'id',
  'createdAt',
  'executionId',
  'token',
  'amount',
  'direction',
  'counterpartyLabel',
  'usdMicro',
] as const;

const DECISION_HEADER = [
  'id',
  'createdAt',
  'trigger',
  'status',
  'proposalSource',
  'proposalHash',
  'contextHash',
] as const;

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));
  const { format, dataset, limit } = parsed.data;

  const wantLedger = dataset !== 'decisions';
  const wantDecisions = dataset !== 'ledger';

  const ledger = wantLedger ? await listLedgerPage(owner.db, wallet.id, { limit }) : [];
  // `listAgentDecisions` caps its own limit at 100; that is its contract, not ours to widen here.
  const decisions = wantDecisions ? await listAgentDecisions(owner.db, wallet.id, { limit }) : [];

  const ledgerRows = ledger.map((r) => [
    r.id,
    r.createdAt.toISOString(),
    r.executionId ?? '',
    r.token,
    r.amount.toString(),
    r.direction,
    r.counterpartyLabel ?? '',
    r.usdMicro.toString(),
  ]);
  const decisionRows = decisions.map((r) => [
    r.id,
    r.createdAt.toISOString(),
    r.trigger,
    r.status,
    r.proposalSource,
    r.proposalHash ?? '',
    r.contextHash,
  ]);

  if (format === 'json') {
    const toObject = (header: readonly string[], rows: unknown[][]) =>
      rows.map((row) => Object.fromEntries(header.map((k, i) => [k, row[i] ?? null])));
    return Response.json({
      ...(wantLedger ? { ledger: toObject(LEDGER_HEADER, ledgerRows) } : {}),
      ...(wantDecisions ? { decisions: toObject(DECISION_HEADER, decisionRows) } : {}),
    });
  }

  const sections: string[] = [];
  if (wantLedger) sections.push(`# ledger\n${csvRows(LEDGER_HEADER, ledgerRows)}`);
  if (wantDecisions) sections.push(`# decisions\n${csvRows(DECISION_HEADER, decisionRows)}`);
  return new Response(sections.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="steward-${dataset}-${wallet.id}.csv"`,
    },
  });
}
