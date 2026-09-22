'use client';
// S9 — the freeze flow (task 7.8). Three steps, in the order SECURITY §4 fixes them:
//
//   1. Freeze now            — one owner signature. Steward stops proposing and stops executing.
//   2. Revoke spending permission — a transaction the OWNER's own wallet sends. Steward only hands
//      over the calldata and then asks the chain whether it landed; it never broadcasts this.
//   3. Bring funds home      — `sweepHome`, the only action allowed while frozen.
//
// Two properties this component must keep:
//
//   RESUMABLE. Every step's state comes from `GET /api/freeze`, which reads the wallet row, the
//   spend-permission row (checked against the chain) and the latest `sweep_home` execution. Closing
//   the modal, reloading, or freezing in another tab all resume correctly, because nothing here
//   trusts its own memory about what has already happened.
//
//   IDEMPOTENT. Every action re-reads that status FIRST and acts on the fresh copy, so a retry can
//   never be a blind repeat: an already-frozen wallet is a no-op success, an already-revoked
//   permission is skipped, and a sweep is keyed by its proposal hash in the executor (I10).
//
// I7 — nothing on this path touches reasoning, the queue or the worker (check:arch keeps
// `components/freeze/` out of `packages/reasoning`). Step 1 works with everything else dead.
import { useCallback, useEffect, useState } from 'react';
import { useSendTransaction } from 'wagmi';
import {
  BlockerPanel,
  LiteralPayload,
  SignErrorPanel,
  SignStatus,
} from '@/components/sign/SignSurface';
import { Button } from '@/components/ui/primitives';
import { VerdictGlyph } from '@/components/icons';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import {
  zFreezePrepare,
  zFreezeResult,
  zOwnerPath,
  zRevokeReported,
  zSweepResult,
  type OwnerPath,
} from '@/lib/contracts';
import { signErrorCopy, type SignError } from '@/lib/signCopy';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { useSignMessage } from 'wagmi';

export type FreezeFlowProps = {
  frozen: boolean;
  onDone: () => void;
  onClose: () => void;
  /** Test seam: how often the revoke and sweep steps ask the server what the chain says. */
  pollMs?: number;
};

/** How long to keep asking before telling the owner to come back later. */
const POLL_ATTEMPTS = 40;
const DEFAULT_POLL_MS = 3_000;

export type StepState = 'todo' | 'active' | 'busy' | 'done' | 'failed';

/** Which of the three steps each half of the server's status puts us in. */
export function stepStates(s: OwnerPath): [StepState, StepState, StepState] {
  const one: StepState = s.frozen ? 'done' : 'active';
  // `none` means there is nothing to revoke (no permission was ever granted, or the row is gone):
  // that is a finished step, not a skipped one.
  const two: StepState = s.revoke.state === 'todo' ? (s.frozen ? 'active' : 'todo') : 'done';
  let three: StepState = 'todo';
  if (s.sweep.state === 'confirmed') three = 'done';
  else if (s.sweep.state === 'pending' || s.sweep.state === 'submitted') three = 'busy';
  else if (s.sweep.state !== 'none') three = 'failed';
  else if (s.frozen && two === 'done') three = 'active';
  return [one, two, three];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function FreezeFlow({ frozen, onDone, onClose, pollMs = DEFAULT_POLL_MS }: FreezeFlowProps) {
  const { blocker, switchNetwork, switching } = useSigner();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();

  const [status, setStatus] = useState<OwnerPath | null>(null);
  const [loadError, setLoadError] = useState<SignError | null>(null);
  const [busy, setBusy] = useState<null | 'revoke' | 'sweep'>(null);
  const [stepError, setStepError] = useState<Record<'revoke' | 'sweep', SignError | null>>({
    revoke: null,
    sweep: null,
  });

  const read = useCallback(async () => {
    const fresh = await apiGet('/api/freeze', zOwnerPath);
    setStatus(fresh);
    return fresh;
  }, []);

  // On open (this component is unmounted while the modal is closed), ask the server what has
  // already happened. Nothing is assumed from the `frozen` prop beyond the first paint.
  useEffect(() => {
    void read().catch((e: unknown) => setLoadError(signErrorCopy(e)));
  }, [read]);

  const freeze = useSignFlow<string>({
    prepare: async () => {
      // Re-read first: freezing an already-frozen wallet should not even ask for a signature.
      const fresh = await read();
      if (fresh.frozen) throw new ApiError(409, 'already_frozen', 'Steward is already stopped.');
      const p = await apiPost('/api/freeze/prepare', zFreezePrepare, { action: 'freeze' });
      return p.message;
    },
    sign: (message) => signMessageAsync({ message }),
    submit: async (_m, signature) => {
      const result = await apiPost('/api/freeze', zFreezeResult, { signature });
      setStatus(result);
    },
  });

  const revoke = useCallback(async () => {
    setStepError((s) => ({ ...s, revoke: null }));
    setBusy('revoke');
    try {
      const fresh = await read();
      // Already done (in another tab, or straight from the owner's own wallet app): nothing to send.
      if (fresh.revoke.state !== 'todo') return;
      const txHash = await sendTransactionAsync({
        to: fresh.revoke.to as `0x${string}`,
        data: fresh.revoke.data as `0x${string}`,
      });
      // The server is the one that decides this landed: it reads `isRevoked` from the manager and
      // refuses until the chain agrees (a reported hash is never taken as proof).
      for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
        try {
          const r = await apiPost('/api/spend-permission/revoked', zRevokeReported, { txHash });
          if (r.revoked) {
            await read();
            return;
          }
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'not_revoked_onchain') throw e;
        }
        await sleep(pollMs);
      }
      throw new ApiError(
        504,
        'revoke_unconfirmed',
        'Steward did not see the revoke confirm in time.',
      );
    } catch (e) {
      setStepError((s) => ({ ...s, revoke: signErrorCopy(e) }));
    } finally {
      setBusy(null);
    }
  }, [pollMs, read, sendTransactionAsync]);

  const sweep = useCallback(async () => {
    setStepError((s) => ({ ...s, sweep: null }));
    setBusy('sweep');
    try {
      const fresh = await read();
      if (fresh.sweep.state === 'confirmed') return;
      const started = await apiPost('/api/sweep', zSweepResult);
      if (started.nothingToSweep) {
        await read();
        return;
      }
      for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
        const now = await read();
        if (now.sweep.state !== 'pending' && now.sweep.state !== 'submitted') return;
        await sleep(pollMs);
      }
    } catch (e) {
      setStepError((s) => ({ ...s, sweep: signErrorCopy(e) }));
    } finally {
      setBusy(null);
    }
  }, [pollMs, read]);

  if (loadError && status === null)
    return (
      <div data-slot="freeze-flow">
        <SignErrorPanel
          error={loadError}
          onRetry={() => {
            setLoadError(null);
            void read().catch((e: unknown) => setLoadError(signErrorCopy(e)));
          }}
        />
        <div className="pt-6">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );

  // Before the first read lands, show step 1 from the dashboard's own flag rather than an empty box.
  const view: OwnerPath = status ?? {
    frozen,
    frozenAt: null,
    frozenReason: null,
    revoke: { state: 'none' },
    sweep: { state: 'none' },
  };
  const [s1, s2raw, s3raw] = stepStates(view);
  const s2 = busy === 'revoke' ? 'busy' : s2raw;
  const s3 = busy === 'sweep' ? 'busy' : s3raw;
  const allDone = s1 === 'done' && s2 === 'done' && s3 === 'done';

  return (
    <div data-slot="freeze-flow" data-loading={status === null || undefined}>
      {blocker !== null && blocker.kind !== 'disconnected' ? (
        <div className="pb-4">
          <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />
        </div>
      ) : null}

      <ol className="space-y-3">
        <Step n={1} state={s1} title="Freeze now" testId="freeze-step-1">
          {s1 === 'done' ? (
            <p className="text-small text-muted" data-testid="freeze-stopped">
              Steward is stopped. No further actions will be taken.
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-small text-muted">
                Sign to stop Steward immediately. Any request waiting for your approval is
                cancelled.
              </p>
              {freeze.prepared !== null ? <LiteralPayload value={freeze.prepared} /> : null}
              <SignStatus phase={freeze.phase} />
              {freeze.error ? (
                <SignErrorPanel error={freeze.error} onRetry={freeze.prepare} />
              ) : null}
              <div className="pt-4">
                <Button
                  variant="danger"
                  data-testid="freeze-now"
                  loading={
                    freeze.phase === 'preparing' ||
                    freeze.phase === 'awaiting-signature' ||
                    freeze.phase === 'submitting'
                  }
                  onClick={freeze.prepared === null ? freeze.prepare : freeze.confirm}
                >
                  {freeze.prepared === null ? 'Freeze now' : 'Sign in wallet'}
                </Button>
              </div>
            </>
          )}
        </Step>

        <Step n={2} state={s2} title="Revoke spending permission" testId="freeze-step-2">
          {s2 === 'done' ? (
            <p className="text-small text-muted">
              {view.revoke.state === 'revoked'
                ? 'Revoked on-chain. Steward can no longer pull from your treasury.'
                : 'There is no spending permission to revoke.'}
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-small text-muted">
                This is a transaction from your own wallet. Steward hands you the call and watches
                the chain; it cannot send this one for you.
              </p>
              {stepError.revoke ? <SignErrorPanel error={stepError.revoke} /> : null}
              <div className="pt-4">
                <Button
                  data-testid="revoke-now"
                  disabled={s1 !== 'done'}
                  loading={busy === 'revoke'}
                  onClick={() => void revoke()}
                >
                  {stepError.revoke ? 'Try again' : 'Revoke spending permission'}
                </Button>
              </div>
            </>
          )}
        </Step>

        <Step n={3} state={s3} title="Bring funds home" testId="freeze-step-3">
          {s3 === 'done' ? (
            <p className="text-small text-muted">
              Everything is back in your treasury.
              {view.sweep.txHash ? ' The transaction is in your activity timeline.' : ''}
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-small text-muted">
                Steward redeems its vault shares and sends every dollar to your treasury address.
                This still goes through your policy checks.
              </p>
              {s3 === 'busy' || view.sweep.state === 'submitted' ? (
                <p
                  role="status"
                  className="pt-2 text-small text-muted"
                  data-testid="sweep-progress"
                >
                  {view.sweep.state === 'submitted'
                    ? 'Sent. Waiting for the network to confirm it.'
                    : 'Working. This takes a few seconds.'}
                </p>
              ) : null}
              {stepError.sweep ? <SignErrorPanel error={stepError.sweep} /> : null}
              <div className="pt-4">
                <Button
                  data-testid="sweep-now"
                  disabled={s1 !== 'done'}
                  loading={busy === 'sweep'}
                  onClick={() => void sweep()}
                >
                  {s3 === 'failed' || stepError.sweep ? 'Try again' : 'Bring funds home'}
                </Button>
              </div>
            </>
          )}
        </Step>
      </ol>

      <div className="space-y-2 pt-6">
        {allDone ? (
          <Button data-testid="freeze-done" onClick={onDone}>
            Done
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {s1 === 'done' ? 'Close' : 'Cancel'}
        </Button>
        {s1 === 'done' && !allDone ? (
          <p className="text-small text-muted">
            You can close this and come back. Steward stays stopped, and this flow picks up where
            you left off.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const TONE: Record<StepState, string> = {
  todo: 'text-faint',
  active: 'text-ink',
  busy: 'text-ink',
  done: 'text-allow',
  failed: 'text-deny',
};

function Step({
  n,
  state,
  title,
  testId,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <li data-testid={testId} data-state={state} className="rounded-md bg-surface-2 p-4">
      <p className={`flex items-center gap-2 text-h3 font-semibold ${TONE[state]}`}>
        {state === 'done' ? (
          <VerdictGlyph tone="allow" className="size-4 shrink-0" />
        ) : state === 'failed' ? (
          <VerdictGlyph tone="deny" className="size-4 shrink-0" />
        ) : (
          <span className="font-mono text-mono text-faint">{n}</span>
        )}
        {title}
      </p>
      <div className="pt-2">{children}</div>
    </li>
  );
}
