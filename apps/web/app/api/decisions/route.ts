// GET /api/decisions?cursor=: the timeline (API.md). Read-only, owner-scoped.
//
// Each row is already in plain language (title, one-line explanation, amount, verdict) so the UI never
// re-derives anything. Nothing here returns a secret, a receipt MAC, a signature or a prompt body
// (I9, SECURITY 6).
import { getVerdictForDecision, listAgentDecisions } from '@steward/db';
import type { DecisionList } from '@/lib/contracts';
import { decisionsQuery } from '@/lib/decisionQuery';
import { toDecisionItem } from '@/lib/decisionView';
import { fixtureFor } from '@/lib/fixture';
import { fixtureDecisions } from '@/lib/fixtures';
import { loadLabels } from '@/lib/labels';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = decisionsQuery.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return apiError(400, 'bad_request', 'invalid cursor or limit');

  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureDecisions(fx, parsed.data.cursor));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const rows = await listAgentDecisions(owner.db, wallet.id, {
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(parsed.data.cursor === undefined ? {} : { before: new Date(parsed.data.cursor) }),
  });
  const labels = await loadLabels(owner.db, wallet.id);

  const decisions = [];
  for (const row of rows) {
    const v = await getVerdictForDecision(owner.db, row.id);
    decisions.push(
      toDecisionItem(
        {
          id: row.id,
          trigger: row.trigger,
          status: row.status,
          proposal: row.proposal,
          createdAt: row.createdAt,
          verdict: v
            ? {
                decision: v.decision,
                policyVersion: v.policyVersion,
                evaluatedAt: v.evaluatedAt,
                results: v.results,
              }
            : null,
        },
        labels,
      ),
    );
  }

  const last = rows.at(-1);
  const body: DecisionList = {
    decisions,
    nextCursor: rows.length > 0 && last ? last.createdAt.toISOString() : null,
  };
  return Response.json(body);
}
