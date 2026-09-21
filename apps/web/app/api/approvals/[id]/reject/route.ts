// POST /api/approvals/:id/reject — the owner says no.
//
// No signature required: rejecting only ever prevents an action. The same single-transition UPDATE
// guards it, so a reject racing an approve produces exactly one outcome.
import { appendAudit, decideApproval, getApproval } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const { id } = await ctx.params;
  const approval = await getApproval(owner.db, id);
  if (!approval || approval.walletId !== wallet.id)
    return apiError(404, 'not_found', 'approval not found');

  const now = new Date();
  const decided = await decideApproval(owner.db, id, 'rejected', now);
  if (!decided) return apiError(409, 'not_pending', `approval is ${approval.status}`);

  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'APPROVAL_REJECTED',
    entityType: 'approval',
    entityId: id,
    payload: { decisionId: approval.decisionId, proposalHash: approval.proposalHash },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  return Response.json({ approval: { id, status: 'rejected' } });
}
