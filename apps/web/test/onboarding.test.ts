import { describe, expect, it } from 'vitest';
import { MANDATE_TEMPLATES } from '@steward/policy';
import { TEMPLATE_CHIPS } from '../lib/mandateExamples';
import { clampView, deriveOnboardingStep, initialView, reachableSteps } from '../lib/onboarding';

const facts = {
  hasWallet: true,
  agentWalletAddress: '0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14' as string | null,
  mandateCompiled: false,
  spendPermissionStatus: null as string | null,
  activePolicyVersion: null as number | null,
};

describe('deriveOnboardingStep: the step comes from server state (resumable)', () => {
  it('no wallet row or no agent wallet: step 2 (create the agent wallet)', () => {
    expect(deriveOnboardingStep({ ...facts, hasWallet: false, agentWalletAddress: null })).toBe(2);
    expect(deriveOnboardingStep({ ...facts, agentWalletAddress: null })).toBe(2);
  });
  it('agent wallet but no compiled mandate: step 3', () =>
    expect(deriveOnboardingStep(facts)).toBe(3));
  it('a mandate that compiled: step 4 (spend limit)', () =>
    expect(deriveOnboardingStep({ ...facts, mandateCompiled: true })).toBe(4));
  it('a stored live spend permission: step 5 (sign policy)', () => {
    for (const s of ['pending', 'approved_onchain'])
      expect(
        deriveOnboardingStep({ ...facts, mandateCompiled: true, spendPermissionStatus: s }),
      ).toBe(5);
  });
  it('a revoked or expired permission sends the owner back to step 4', () => {
    for (const s of ['revoked', 'expired', 'nonsense'])
      expect(
        deriveOnboardingStep({ ...facts, mandateCompiled: true, spendPermissionStatus: s }),
      ).toBe(4);
  });
  it('an active policy means onboarding is done, whatever else is true', () =>
    expect(deriveOnboardingStep({ ...facts, activePolicyVersion: 1 })).toBe('done'));
  it('a permission without a compiled mandate does not skip step 3', () =>
    expect(deriveOnboardingStep({ ...facts, spendPermissionStatus: 'pending' })).toBe(3));
});

describe('wizard view helpers', () => {
  it('a brand-new owner opens on "Meet Steward", a returning one resumes', () => {
    expect(initialView(2, false)).toBe(1);
    expect(initialView(2, true)).toBe(2);
    expect(initialView(4, true)).toBe(4);
    expect(initialView('done', true)).toBe(5);
  });
  it('the owner may go back but never past the server state', () => {
    expect(clampView(1, 4)).toBe(1);
    expect(clampView(4, 4)).toBe(4);
    expect(clampView(5, 4)).toBe(4);
    expect(clampView(0, 3)).toBe(1);
    expect(clampView(9, 'done')).toBe(5);
    expect(reachableSteps('done')).toBe(5);
  });
});

describe('template chips match the policy templates (UI copy vs. server fallback)', () => {
  const group = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const usdc = (micro: string) => group((BigInt(micro) / 1_000_000n).toString());
  for (const chip of TEMPLATE_CHIPS) {
    it(`${chip.value}: buffer and approval threshold in the example are the templates`, () => {
      const t = MANDATE_TEMPLATES[chip.value];
      expect(chip.text).toContain(`${usdc(t.runwayBufferMicroUsd)} USDC liquid`);
      expect(chip.text).toContain(`over ${usdc(t.approvalThresholdMicroUsd)} USDC`);
    });
  }
});
