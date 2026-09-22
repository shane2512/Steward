// POST /api/policy/activate — **sensitive**: the owner's signature over `Steward policy v{n} {hash}`
// (API.md). This is the ONLY way a policy ever becomes active.
//
//   DOES  re-derive the body and the message from server rows (never from the request), so a
//         signature is only accepted for a policy this server would have asked for;
//   DOES  verify EIP-191 against the session owner through viem's `verifyMessage` (ERC-1271/6492),
//         the same path SIWE and approvals use — a session cookie alone can never activate (T7);
//   DOES  cancel every pending approval, because an owner approval is bound to `Policy: v{n}` and a
//         version bump makes it unredeemable (6.4);
//   DOES NOT touch funds, the spend permission or the chain. Activating a policy only ever narrows
//         or re-states what Steward may do; the on-chain cap is a separate, already-signed object.
import { z } from 'zod';
import { activatePolicyVersion, appendAudit, cancelApprovalsForPolicyChange } from '@steward/db';
import { zHex } from '@steward/shared';
import { nextPolicyBody } from '@/lib/policyDraft';
import { apiError, getPublicClient } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const body = z.object({ signature: zHex }).strict();

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'bad_request', 'signature is required');

  const next = await nextPolicyBody(owner.db, {
    walletId: wallet.id,
    chainId: wallet.chainId,
    treasuryAddress: wallet.treasuryAddress,
    owner: owner.address,
  });
  if (!next.ok) return apiError(409, next.error, 'there is no compiled policy to activate');

  let valid: boolean;
  try {
    valid = await getPublicClient().verifyMessage({
      address: owner.address,
      message: next.value.message,
      signature: parsed.data.signature,
    });
  } catch (e) {
    // A verification we could not complete is NOT an activation (I5).
    return apiError(502, 'verify_failed', `signature verification failed: ${String(e)}`);
  }
  // A signature that does not match usually means the draft moved under the owner's feet: the
  // message pins the body hash, so re-reading and re-signing is the fix.
  if (!valid)
    return apiError(
      401,
      'bad_signature',
      'the signature does not match this policy version; review it again and sign the current one',
    );

  const now = new Date();
  // I6: audit BEFORE the policy can govern anything. The signature itself never enters the payload.
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'POLICY_ACTIVATED',
    entityType: 'policy',
    entityId: `${wallet.id}:${next.value.version}`,
    payload: {
      version: next.value.version,
      bodyHash: next.value.bodyHash,
      signer: owner.address,
      mandateId: next.value.mandateId,
    },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  try {
    await activatePolicyVersion(owner.db, {
      walletId: wallet.id,
      version: next.value.version,
      mandateId: next.value.mandateId,
      body: { ...next.value.unsigned, signature: parsed.data.signature },
      bodyHash: next.value.bodyHash,
      signature: parsed.data.signature,
      now,
    });
  } catch {
    // The primary key on (wallet_id, version) is the replay guard: a second activation of the same
    // version loses here rather than creating a duplicate.
    return apiError(409, 'already_activated', `policy v${next.value.version} already exists`);
  }

  const cancelled = await cancelApprovalsForPolicyChange(
    owner.db,
    wallet.id,
    next.value.version,
    now,
  );
  return Response.json({ version: next.value.version, cancelledApprovals: cancelled.length });
}
