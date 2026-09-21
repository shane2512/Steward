'use client';
// ============================================================================================
// EXTENSION POINT for task 7.6 (Opus): the two signing steps of the onboarding wizard.
//
//   step 'spend-limit'  (wizard step 4): spend permission typed-data signing. Allowance/day control,
//                        end date, live "Maximum at risk", prepare -> sign in wallet -> store, via
//                        POST /api/spend-permission/prepare and POST /api/spend-permission.
//   step 'policy'       (wizard step 5): the final review + policy activation signature
//                        (`Steward policy v{n} {hash}`), via POST /api/policy/prepare and
//                        POST /api/policy/activate (sensitive: fresh signature in the body).
//
// 7.3 builds only the surrounding layout. This component renders a clearly marked placeholder and
// contains NO signing, typed-data building, signature verification, activation or spend-permission
// store code. The Opus agent replaces the placeholder body and keeps the props:
//
//   step                  which of the two signing steps to render
//   mandate               the compiled mandate from GET /api/onboarding (sentences the owner reviews)
//   agentWalletAddress    the spender the permission must name (server re-checks it)
//   spendPermissionStatus server-side status of the stored permission (null until one is stored)
//   onSigned              call once the SERVER has accepted the signature; the wizard refetches
//                         GET /api/onboarding and moves on (state comes from the server, not the browser)
// ============================================================================================
import type { OnboardingState } from '@/lib/contracts';

export type SignStepSlotProps = {
  step: 'spend-limit' | 'policy';
  mandate: OnboardingState['mandate'];
  agentWalletAddress: string | null;
  spendPermissionStatus: string | null;
  onSigned: () => void;
};

export function SignStepSlot({ step }: SignStepSlotProps) {
  return (
    <div
      data-slot={`sign-step-${step}`}
      role="note"
      className="rounded-md border border-dashed border-line-strong p-4"
    >
      <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
        Task 7.6
      </p>
      <p className="pt-2 text-small text-muted" data-testid="sign-step-placeholder">
        {step === 'spend-limit'
          ? 'Spend permission signing arrives in task 7.6.'
          : 'Policy signing and activation arrive in task 7.6.'}
      </p>
    </div>
  );
}
