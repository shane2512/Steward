// 6.4 — the escalation path's second half: an owner signature turns an ESCALATE into a fresh
// evaluation, and only then into a receipt and an execution.
//
// RR-1: the Policy Engine cannot verify a signature. So the signature is verified TWICE — once by
// the web route that accepts it (so a bad one never reaches the database), and once here, reading
// the stored bytes back, before `ownerApproval` is built. The database row on its own is never the
// authority; the signature is.
//
// What an approval can and cannot do (SECURITY §5, POLICY_ENGINE §6): it lifts the rules marked
// "approval can lift" (R02, R08-payments, R09, R10, R15-UNSURE, R16-escalate, R19-low-confidence).
// It never lifts a DENY. The proposal is re-simulated and re-evaluated against CURRENT state, so an
// approval signed yesterday cannot execute against a world that has moved.
import { getAddress, type PublicClient } from 'viem';
import {
  appendAudit,
  cancelPendingApprovals,
  decideApproval,
  getActivePolicy,
  getAgentDecision,
  getApproval,
  getUserById,
  getWalletById,
  type ApprovalRow,
  type Db,
} from '@steward/db';
import { hashProposal } from '@steward/policy';
import {
  addressEquals,
  approvalMessage,
  err,
  ok,
  zPolicy,
  zProposal,
  type Address,
  type Hex,
  type Result,
} from '@steward/shared';
import { gather } from './gather';
import { runPipeline, type PipelineDeps, type PipelineOutcome } from './pipeline';

export type ApprovalError = { code: string; message: string };
const fail = (code: string, message: string): Result<never, ApprovalError> => err({ code, message });

/**
 * Verify an EIP-191 personal-sign signature over the approval message.
 *
 * `publicClient.verifyMessage` handles EOAs, deployed smart wallets (ERC-1271) and counterfactual
 * ones (ERC-6492), which is what the owner's Coinbase Smart Wallet produces (V-10).
 */
export async function verifyApprovalSignature(
  publicClient: PublicClient,
  input: { owner: Address; message: string; signature: Hex },
): Promise<Result<true, ApprovalError>> {
  try {
    const valid = await publicClient.verifyMessage({
      address: getAddress(input.owner),
      message: input.message,
      signature: input.signature,
    });
    return valid ? ok(true) : fail('BAD_SIGNATURE', 'signature does not match the wallet owner');
  } catch (e) {
    // A verification that cannot be completed is NOT an approval (I5).
    return fail('VERIFY_FAILED', `signature verification failed: ${String(e)}`);
  }
}

/**
 * Re-check a stored approval end to end and, if everything still holds, execute it.
 *
 * Every refusal below is a reason an approval must not run:
 *   - not pending            replay, or already rejected / expired / cancelled
 *   - expired                the signed `Expires:` line has passed
 *   - wrong policy version   the owner signed `Policy: v{n}`; the active policy is now v{n+1}
 *   - signer != owner        someone else's signature
 *   - proposal hash mismatch the decision row was not the one that was signed
 */
export async function executeApproval(
  deps: PipelineDeps & { publicClient: PublicClient; priceAdapter?: Parameters<typeof gather>[0]['priceAdapter'] },
  approvalId: string,
): Promise<Result<PipelineOutcome, ApprovalError>> {
  const { db } = deps;
  const now = deps.now();

  const approval = await getApproval(db, approvalId);
  if (!approval) return fail('UNKNOWN_APPROVAL', `approval ${approvalId} not found`);
  if (approval.status !== 'approved')
    return fail('NOT_APPROVED', `approval is ${approval.status}`);
  if (approval.expiresAt.getTime() <= now.getTime())
    return fail('EXPIRED', 'the approval window has closed');
  if (!approval.signature) return fail('NO_SIGNATURE', 'approval carries no signature');

  const decision = await getAgentDecision(db, approval.decisionId);
  if (!decision) return fail('UNKNOWN_DECISION', 'the approved decision row is gone');
  const parsedProposal = zProposal.safeParse(decision.proposal);
  if (!parsedProposal.success)
    return fail('PROPOSAL_INVALID', 'the stored proposal does not parse');
  const proposal = parsedProposal.data;
  const proposalHash = hashProposal(proposal);
  if (proposalHash !== approval.proposalHash)
    return fail('HASH_MISMATCH', 'the stored proposal does not hash to the approved hash');

  const wallet = await getWalletById(db, approval.walletId);
  if (!wallet) return fail('UNKNOWN_WALLET', 'wallet not found');
  const user = await getUserById(db, wallet.userId);
  if (!user) return fail('NO_OWNER', 'wallet has no owner');
  const owner = getAddress(user.ownerAddress);

  const active = await getActivePolicy(db, approval.walletId);
  if (!active) return fail('NO_ACTIVE_POLICY', 'wallet has no active policy');
  const policy = zPolicy.safeParse(active.body);
  if (!policy.success) return fail('POLICY_INVALID', 'stored policy does not parse');
  // I4: the approver must be the wallet's owner, and that owner must be the treasury the policy was
  // signed with. Exact checksummed equality, no similarity.
  if (!addressEquals(owner, policy.data.treasuryAddress))
    return fail('OWNER_MISMATCH', 'the wallet owner is not the policy treasury address');

  // The signed message pins the policy version. A new version must invalidate the signature even if
  // the `approvals.expire` / policy-change cancellation job has not run yet.
  const expected = approvalMessage({
    walletId: approval.walletId,
    proposalHash: approval.proposalHash,
    policyVersion: active.version,
    expiresAt: approval.expiresAt,
  });
  if (expected !== approval.message)
    return fail(
      'POLICY_VERSION_CHANGED',
      'the policy changed since this approval was signed; a fresh approval is required',
    );

  const verified = await verifyApprovalSignature(deps.publicClient, {
    owner,
    message: approval.message,
    signature: approval.signature as Hex,
  });
  if (!verified.ok) return err(verified.error);

  // Fresh state, fresh simulation, fresh verdict — the approval only lifts ESCALATE rules.
  const gathered = await gather(
    {
      db,
      publicClient: deps.publicClient,
      spendPermissionManagerAddress: deps.spendPermissionManagerAddress,
      allowMainnet: deps.allowMainnet,
      now: deps.now,
      priceAdapter: deps.priceAdapter,
    },
    approval.walletId,
  );
  if (!gathered.ok) return fail(gathered.error.code, gathered.error.message);

  const audited = await appendAudit(db, {
    walletId: approval.walletId,
    actor: 'owner',
    event: 'APPROVAL_VERIFIED',
    entityType: 'approval',
    entityId: approval.id,
    payload: {
      decisionId: approval.decisionId,
      proposalHash,
      policyVersion: active.version,
      signer: owner,
    },
    createdAt: now,
  });
  if (!audited.ok) return fail('AUDIT_FAILED', audited.error.message);

  const contextFactIds = Array.isArray((decision.contextSnapshot as { facts?: { id: string }[] })?.facts)
    ? ((decision.contextSnapshot as { facts: { id: string }[] }).facts ?? []).map((f) => f.id)
    : [];
  const screen = (decision.screen as { injectionSuspected: boolean; signals: string[] } | null) ?? {
    injectionSuspected: false,
    signals: [],
  };
  const verifier =
    (decision.verifier as { verdict: 'AGREE' | 'DISAGREE' | 'UNSURE'; reasons: string[] } | null) ??
    null;

  const outcome = await runPipeline(deps, {
    g: gathered.value,
    decisionId: approval.decisionId,
    proposal,
    screen,
    verifier,
    contextFactIds,
    ownerApproval: { signer: owner, proposalHash, expiresAt: approval.expiresAt },
  });
  return ok(outcome);
}

/** A new policy version invalidates every pending approval (6.4). */
export async function cancelApprovalsForPolicyChange(
  db: Db,
  walletId: string,
  newVersion: number,
  now: Date,
): Promise<ApprovalRow[]> {
  const cancelled = await cancelPendingApprovals(db, walletId, now);
  for (const row of cancelled) {
    await appendAudit(db, {
      walletId,
      actor: 'system',
      event: 'APPROVAL_CANCELLED',
      entityType: 'approval',
      entityId: row.id,
      payload: { reason: 'policy version changed', newVersion, proposalHash: row.proposalHash },
      createdAt: now,
    });
  }
  return cancelled;
}

/** Record an owner's rejection. Same single-transition guard as approve. */
export async function rejectApproval(
  db: Db,
  approvalId: string,
  now: Date,
): Promise<Result<ApprovalRow, ApprovalError>> {
  const row = await decideApproval(db, approvalId, 'rejected', now);
  if (!row) return fail('NOT_PENDING', 'approval is not pending');
  const audited = await appendAudit(db, {
    walletId: row.walletId,
    actor: 'owner',
    event: 'APPROVAL_REJECTED',
    entityType: 'approval',
    entityId: row.id,
    payload: { decisionId: row.decisionId, proposalHash: row.proposalHash },
    createdAt: now,
  });
  if (!audited.ok) return fail('AUDIT_FAILED', audited.error.message);
  return ok(row);
}
