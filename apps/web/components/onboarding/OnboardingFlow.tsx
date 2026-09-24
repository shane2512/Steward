'use client';
// S3 onboarding wizard (docs/DESIGN.md §11 S3). RESUMABLE: which step the owner may reach comes from
// GET /api/onboarding (server rows), never from the browser. Steps 1-3 are built here; steps 4 and 5
// are the signing steps of task 7.6 and render `SignStepSlot`.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconBack } from '@/components/icons';
import { ErrorPanel, LoadBar, Skeleton } from '@/components/ui/primitives';
import { zOnboarding } from '@/lib/contracts';
import { clampView, initialView, type WizardStep } from '@/lib/onboarding';
import { useApi } from '@/lib/useApi';
import { SignStepSlot } from './SignStepSlot';
import { MandateStep, MeetStep, StepHeading, WalletStep } from './steps';

const TOTAL_STEPS = 5;

/** Dot-and-bar progress (multistep-form pattern, dependency-free): a dot per step, ringed when
 * current, a thin bar filling to the current step underneath. Past dots jump back via `onStepClick`
 * — the same "only completed steps are reachable" rule the onboarding wizard already enforces. */
export function StepProgress({
  current,
  onStepClick,
}: {
  current: number;
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="px-4 pt-3">
      <div
        className="flex items-center justify-between"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={current}
      >
        {Array.from({ length: TOTAL_STEPS }, (_, idx) => idx + 1).map((i) => {
          const reached = i <= current;
          const clickable = reached && i !== current && onStepClick;
          const dot = (
            <span
              className={`block size-2.5 rounded-full transition-all duration-200 ${
                reached ? 'bg-ink' : 'bg-surface-3'
              } ${i === current ? 'ring-2 ring-ink/20 ring-offset-2 ring-offset-ground' : ''} ${
                clickable ? 'hover:scale-125' : ''
              }`}
              aria-hidden="true"
            />
          );
          return clickable ? (
            <button
              key={i}
              type="button"
              onClick={() => onStepClick(i)}
              aria-label={`Go back to step ${i}`}
              className="flex size-6 items-center justify-center"
            >
              {dot}
            </button>
          ) : (
            <span key={i} className="flex size-6 items-center justify-center">
              {dot}
            </span>
          );
        })}
      </div>
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-300 ease-out"
          style={{ width: `${((current - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const ob = useApi('/api/onboarding', zOnboarding);
  const [view, setView] = useState<WizardStep | null>(null);
  const data = ob.data;

  // A finished owner has nothing to onboard: go to the dashboard.
  useEffect(() => {
    if (data?.step === 'done') router.replace('/app');
  }, [data?.step, router]);

  if (ob.error && !data)
    return (
      <div className="pt-16">
        <ErrorPanel
          title="Steward could not load your setup"
          body="Nothing moved. Check your connection and try again."
          onRetry={ob.refetch}
        />
      </div>
    );
  if (!data || data.step === 'done')
    return (
      <div className="space-y-4 px-4 pt-16" aria-busy="true">
        <LoadBar active />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    );

  const furthest = data.step;
  const current: WizardStep =
    view === null
      ? initialView(furthest, data.agentWalletAddress !== null)
      : clampView(view, furthest);
  const go = (n: number) => setView(clampView(n, furthest));
  /** After the server accepts an action, refetch and let SERVER state pick the step. */
  const resume = () => {
    setView(null);
    ob.refetch();
  };

  return (
    <div data-step={current}>
      <StepProgress current={current} onStepClick={go} />
      <div className="flex h-14 items-center gap-3 px-2">
        {current > 1 ? (
          <button
            type="button"
            onClick={() => go(current - 1)}
            aria-label="Back"
            className="flex size-11 items-center justify-center text-ink"
          >
            <IconBack className="size-6" />
          </button>
        ) : (
          <span className="size-11" />
        )}
        <span className="flex-1" />
        <span className="pr-2 font-mono text-mono text-faint">Step {current} of 5</span>
      </div>

      <div className="px-4 pt-2 pb-10">
        {current === 1 ? <MeetStep onNext={() => go(2)} /> : null}
        {current === 2 ? (
          <WalletStep
            address={data.agentWalletAddress}
            onCreated={() => ob.refetch()}
            onNext={() => go(3)}
          />
        ) : null}
        {current === 3 ? (
          <MandateStep saved={data.mandate} onCompiled={() => ob.refetch()} onNext={() => go(4)} />
        ) : null}
        {current === 4 ? (
          <>
            <StepHeading sub="Steward can only ever pull what you sign for, per day, until the end date you choose.">
              Set the spending limit
            </StepHeading>
            <div className="pt-6">
              <SignStepSlot
                step="spend-limit"
                mandate={data.mandate}
                agentWalletAddress={data.agentWalletAddress}
                spendPermissionStatus={data.spendPermissionStatus}
                onSigned={resume}
              />
            </div>
          </>
        ) : null}
        {current === 5 ? (
          <>
            <StepHeading sub="Read the rules once more. Signing makes them the only rules Steward can act under.">
              Sign your policy
            </StepHeading>
            {/* The sentences come from `SignStepSlot`, rendered from the body that will be stored
                (7.6) rather than from the compile response, so they cannot disagree with it. */}
            <div className="pt-6">
              <SignStepSlot
                step="policy"
                mandate={data.mandate}
                agentWalletAddress={data.agentWalletAddress}
                spendPermissionStatus={data.spendPermissionStatus}
                onSigned={resume}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
