// POST /api/policy/prepare — the literal message the owner signs to activate a policy (API.md).
//
// The body is built from SERVER rows only: the stored compiled mandate, the allowlist, the wallet's
// own chain and treasury. Nothing about the policy comes from the request, so there is no request
// body at all. The client renders `message` verbatim and signs exactly it (task 7.6).
import { apiError } from '@/lib/server';
import { diffSentences, nextPolicyBody } from '@/lib/policyDraft';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const next = await nextPolicyBody(owner.db, {
    walletId: wallet.id,
    chainId: wallet.chainId,
    treasuryAddress: wallet.treasuryAddress,
    owner: owner.address,
  });
  if (!next.ok) return apiError(409, next.error, 'compile your mandate before signing a policy');

  const { added, removed } = diffSentences(
    next.value.previous?.sentences ?? [],
    next.value.sentences,
  );
  return Response.json({
    version: next.value.version,
    bodyHash: next.value.bodyHash,
    message: next.value.message,
    sentences: next.value.sentences,
    diff: { added, removed, previousVersion: next.value.previous?.version ?? null },
  });
}
