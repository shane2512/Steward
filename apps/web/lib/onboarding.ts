// Which onboarding step the SERVER state allows (S3 is resumable; the browser is never the source).
// This only picks a screen. Every action behind a step is checked again by its own route.
export type OnboardingFacts = {
  hasWallet: boolean;
  agentWalletAddress: string | null;
  mandateCompiled: boolean;
  spendPermissionStatus: string | null;
  activePolicyVersion: number | null;
};

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 'done';

/** A spend permission counts once it is stored and not revoked/expired. */
const LIVE_PERMISSION = new Set(['pending', 'approved_onchain']);

export function deriveOnboardingStep(f: OnboardingFacts): OnboardingStep {
  if (f.activePolicyVersion !== null) return 'done';
  if (!f.hasWallet || !f.agentWalletAddress) return 2; // step 1 is a read-only "meet Steward" screen the owner may still open first
  if (!f.mandateCompiled) return 3;
  if (f.spendPermissionStatus === null || !LIVE_PERMISSION.has(f.spendPermissionStatus)) return 4;
  return 5;
}

export const STEP_TITLES = [
  'Meet Steward',
  'Create the agent wallet',
  'Write your mandate',
  'Set the spending limit',
  'Sign your policy',
] as const;

/** The steps the owner may look at: everything up to and including the furthest one. */
export function reachableSteps(furthest: OnboardingStep): number {
  return furthest === 'done' ? 5 : furthest;
}
