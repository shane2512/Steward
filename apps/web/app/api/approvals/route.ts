// GET /api/approvals?status=pending — the approval cards (API.md, UX_FLOWS).
//
// The `message` is the exact EIP-191 text the owner's wallet will show and sign (SECURITY §5).
// It is returned verbatim so the UI can never compose a different one.
import { z } from 'zod';
import { getAgentDecision, listApprovals } from '@steward/db';
import { fixtureFor } from '@/lib/fixture';
import { fixtureApprovals } from '@/lib/fixtures';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const query = z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']).optional();

export async function GET(req: Request) {
  const fx = fixtureFor(req);
  // The fixture is filtered by the SAME `status` the real branch uses, or the queue would show a
  // decided approval under "Pending" (7.8 visual QA).
  if (fx)
    return Response.json(
      fixtureApprovals(fx, new URL(req.url).searchParams.get('status') ?? undefined),
    );

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = query.safeParse(new URL(req.url).searchParams.get('status') ?? undefined);
  if (!parsed.success) return apiError(400, 'bad_request', 'unknown status');

  const rows = await listApprovals(owner.db, wallet.id, parsed.data);
  const approvals = [];
  for (const row of rows) {
    const decision = await getAgentDecision(owner.db, row.decisionId);
    approvals.push({
      id: row.id,
      decisionId: row.decisionId,
      proposalHash: row.proposalHash,
      status: row.status,
      // The literal bytes to sign. The UI must not rebuild this string.
      message: row.message,
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      proposal: decision?.proposal ?? null,
      rationale: (decision?.proposal as { rationale?: string } | null)?.rationale ?? null,
    });
  }
  return Response.json({ approvals });
}
