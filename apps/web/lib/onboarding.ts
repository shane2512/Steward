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

export type WizardStep = 1 | 2 | 3 | 4 | 5;

/** Where the wizard opens: a brand-new owner sees "Meet Steward" first, a returning one resumes. */
export function initialView(furthest: OnboardingStep, hasAgentWallet: boolean): WizardStep {
  if (furthest === 'done') return 5;
  if (!hasAgentWallet && furthest === 2) return 1;
  return furthest;
}

/** The owner may go back freely, but never past what the server state allows. */
export function clampView(view: number, furthest: OnboardingStep): WizardStep {
  const max = reachableSteps(furthest);
  return Math.min(Math.max(Math.trunc(view), 1), max) as WizardStep;
}
