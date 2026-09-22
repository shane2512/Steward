'use client';
// The two signing steps of the onboarding wizard (task 7.6).
//
//   step 'spend-limit' (wizard step 4): the Spend Permission — EIP-712, SECURITY §3 Layer 2.
//   step 'policy'      (wizard step 5): policy activation — EIP-191 `Steward policy v{n} {hash}`.
//
// Both delegate to the components in `components/sign`, which are the SAME ones the settings screens
// (task 7.7) embed: a policy signed from onboarding and a policy re-signed from settings go through
// one code path, so they can never diverge in what they show or what they sign.
import { PolicySign } from '@/components/sign/PolicySign';
import { SpendLimitSign } from '@/components/sign/SpendLimitSign';
import { zWalletState, type OnboardingState } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

export type SignStepSlotProps = {
  step: 'spend-limit' | 'policy';
  mandate: OnboardingState['mandate'];
  agentWalletAddress: string | null;
  spendPermissionStatus: string | null;
  /** Called once the SERVER accepted the signature; the wizard refetches and moves on. */
  onSigned: () => void;
};

export function SignStepSlot({ step, onSigned }: SignStepSlotProps) {
  const wallet = useApi('/api/wallet', zWalletState, { enabled: step === 'spend-limit' });
  if (step === 'policy') return <PolicySign onActivated={onSigned} />;
  return <SpendLimitSign wallet={wallet.data} onSigned={onSigned} />;
}
