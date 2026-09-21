// GET /api/onboarding: the onboarding wizard's state, derived from SERVER rows only (S3 is
// resumable). It picks which screen to show; every action behind a step is re-checked by its own route.
import { getActiveSpendPermission, getLatestMandate, getWalletByUserId } from '@steward/db';
import { renderPolicyAsSentences, validatePolicyDraft } from '@steward/policy';
import type { OnboardingState } from '@/lib/contracts';
import { fixtureFor } from '@/lib/fixture';
import { fixtureOnboarding } from '@/lib/fixtures';
import { deriveOnboardingStep } from '@/lib/onboarding';
import { isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export async function GET(req: Request) {
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureOnboarding(fx));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const wallet = await getWalletByUserId(owner.db, owner.userId);
  const mandateRow = wallet ? await getLatestMandate(owner.db, wallet.id) : undefined;
  const permission = wallet ? await getActiveSpendPermission(owner.db, wallet.id) : undefined;

  // Re-validate the stored draft rather than trusting the jsonb: a draft that no longer passes the
  // ceilings counts as "not compiled" and the wizard sends the owner back to write the mandate.
  const validated =
    mandateRow?.compiledDraft != null ? validatePolicyDraft(mandateRow.compiledDraft) : null;
  const compiled = validated?.ok === true;

  const body: OnboardingState = {
    step: deriveOnboardingStep({
      hasWallet: wallet !== undefined,
      agentWalletAddress: wallet?.agentWalletAddress ?? null,
      mandateCompiled: compiled,
      spendPermissionStatus: permission?.status ?? null,
      activePolicyVersion: wallet?.activePolicyVersion ?? null,
    }),
    agentWalletAddress: wallet?.agentWalletAddress ?? null,
    mandate: mandateRow
      ? {
          id: mandateRow.id,
          text: mandateRow.text,
          template: mandateRow.template,
          sentences: validated?.ok ? renderPolicyAsSentences(validated.value) : [],
          assumptions: strings(mandateRow.assumptions),
          questions: strings(mandateRow.questions),
          compiled,
        }
      : null,
    spendPermissionStatus: permission?.status ?? null,
    activePolicyVersion: wallet?.activePolicyVersion ?? null,
  };
  return Response.json(body);
}
