// POST /api/approvals/:id/approve — **sensitive**: the owner's signature over the SECURITY §5
// message (API.md).
//
// What this route does, and deliberately does not do:
//
//   DOES  re-derive the exact message from the CURRENT policy version and the stored proposal hash,
//         so a signature is only accepted for a message this server would have asked for;
//   DOES  verify the EIP-191 signature against the wallet OWNER (EOA, ERC-1271 or ERC-6492 through
//         viem's `verifyMessage`) — a session cookie alone can never approve anything (T7);
//   DOES  move the approval from `pending` to `approved` in a single conditional UPDATE, which is
//         the replay guard: a second POST updates zero rows;
//   DOES NOT evaluate, sign a receipt or execute. It enqueues `approvals.execute`, and the worker
//         re-verifies the same signature, re-gathers state, re-simulates and re-runs the Policy
//         Engine with `ownerApproval` present. An approval lifts ESCALATE rules; it never lifts a
//         DENY (POLICY_ENGINE §6).
import { z } from 'zod';
import { appendAudit, decideApproval, getActivePolicy, getApproval } from '@steward/db';
import { approvalMessage, zHex, zPolicy } from '@steward/shared';
import { apiError, getPublicClient } from '@/lib/server';
import { enqueueApprovalExecution } from '@/lib/queue';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ signature: zHex });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'signature is required');

  const { id } = await ctx.params;
  const approval = await getApproval(owner.db, id);
  if (!approval || approval.walletId !== wallet.id)
    return apiError(404, 'not_found', 'approval not found');
  if (approval.status !== 'pending')
    return apiError(409, 'not_pending', `approval is ${approval.status}`);

  const now = new Date();
  if (approval.expiresAt.getTime() <= now.getTime())
    return apiError(410, 'expired', 'this approval has expired');

  const active = await getActivePolicy(owner.db, wallet.id);
  if (!active) return apiError(409, 'no_active_policy', 'wallet has no active policy');
  const policy = zPolicy.safeParse(active.body);
  if (!policy.success) return apiError(500, 'policy_invalid', 'stored policy does not parse');

  // The message pins `Policy: v{n}`. If the policy has been re-signed since the approval was
  // created, the message no longer matches and no signature can rescue it — the owner must approve
  // again under the new policy (6.4).
  const expected = approvalMessage({
    walletId: wallet.id,
    proposalHash: approval.proposalHash,
    policyVersion: active.version,
    expiresAt: approval.expiresAt,
  });
  if (expected !== approval.message)
    return apiError(
      409,
      'policy_version_changed',
      'the policy changed since this approval was created; a fresh approval is required',
    );

  // The approver must be the wallet owner AND the policy treasury (I4, exact checksummed equality).
  if (owner.address !== policy.data.treasuryAddress)
    return apiError(403, 'owner_mismatch', 'the session owner is not the policy treasury');

  let valid: boolean;
  try {
    valid = await getPublicClient().verifyMessage({
      address: owner.address,
      message: expected,
      signature: parsed.data.signature,
    });
  } catch (e) {
    // A verification we could not complete is NOT an approval (I5).
    return apiError(502, 'verify_failed', `signature verification failed: ${String(e)}`);
  }
  if (!valid) return apiError(401, 'bad_signature', 'signature does not match the wallet owner');

  // Single transition. A concurrent approve/reject/expire loses here and gets a 409.
  const decided = await decideApproval(owner.db, id, 'approved', now, parsed.data.signature);
  if (!decided) return apiError(409, 'not_pending', 'approval was decided by someone else');

  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'APPROVAL_APPROVED',
    entityType: 'approval',
    entityId: id,
    // No signature in the payload: `appendAudit` refuses secret-looking keys, and the signature is
    // already stored on the approval row where the worker re-verifies it.
    payload: {
      decisionId: approval.decisionId,
      proposalHash: approval.proposalHash,
      policyVersion: active.version,
      signer: owner.address,
    },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  try {
    await enqueueApprovalExecution(id);
  } catch (e) {
    return apiError(503, 'queue_unavailable', `approved, but not enqueued: ${String(e)}`);
  }
  return Response.json({ approval: { id, status: 'approved' }, enqueued: true });
}
