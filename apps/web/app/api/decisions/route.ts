// GET /api/decisions?cursor= — the timeline (API.md).
//
// Read-only, owner-scoped. Money is serialized as decimal strings of base units; nothing here
// returns a secret, a receipt MAC, a signature or a prompt body (I9, SECURITY §6).
import { z } from 'zod';
import { getVerdictForDecision, listAgentDecisions } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const query = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const url = new URL(req.url);
  const parsed = query.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return apiError(400, 'bad_request', 'invalid cursor or limit');

  const rows = await listAgentDecisions(owner.db, wallet.id, {
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(parsed.data.cursor === undefined ? {} : { before: new Date(parsed.data.cursor) }),
  });

  const decisions = [];
  for (const row of rows) {
    const verdict = await getVerdictForDecision(owner.db, row.id);
    decisions.push({
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      proposal: row.proposal,
      proposalHash: row.proposalHash,
      proposalSource: row.proposalSource,
      contextHash: row.contextHash,
      screen: row.screen,
      createdAt: row.createdAt.toISOString(),
      verdict: verdict
        ? {
            decision: verdict.decision,
            policyVersion: verdict.policyVersion,
            evaluatedAt: verdict.evaluatedAt.toISOString(),
          }
        : null,
    });
  }

  const last = rows.at(-1);
  return Response.json({
    decisions,
    nextCursor: rows.length > 0 && last ? last.createdAt.toISOString() : null,
  });
}
