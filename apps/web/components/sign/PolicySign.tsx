'use client';
// (b) Policy signing and activation — S3 step 5 and the re-sign on S7 (task 7.7 embeds this same
// component, so onboarding and settings can never show different things for the same act).
//
// The sentences shown here are rendered by the server FROM THE BODY THAT WILL BE STORED, not from
// the draft the owner compiled earlier, so "what I read" and "what the engine will run" are the same
// object. The message is `Steward policy v{n} {hash}` (API.md), fetched, never composed.
import { useSignMessage } from 'wagmi';
import { Button, TextButton } from '@/components/ui/primitives';
import { apiPost } from '@/lib/api';
import { zPolicyActivated, zPolicyPrepare, type PolicyPrepare } from '@/lib/contracts';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { BlockerPanel, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

export function PolicySign({
  onActivated,
  cta = 'Sign and activate',
}: {
  onActivated: () => void;
  cta?: string;
}) {
  const { blocker, switchNetwork, switching } = useSigner();
  const { signMessageAsync } = useSignMessage();

  const flow = useSignFlow<PolicyPrepare>({
    prepare: () => apiPost('/api/policy/prepare', zPolicyPrepare),
    // EIP-191 over the exact string the server returned.
    sign: (p) => signMessageAsync({ message: p.message }),
    submit: (_p, signature) =>
      apiPost('/api/policy/activate', zPolicyActivated, { signature }).then(() => undefined),
    onDone: onActivated,
  });

  if (blocker !== null && blocker.kind !== 'disconnected')
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;

  const p = flow.prepared;

  return (
    <div data-testid="policy-sign">
      {p === null ? (
        <p className="max-w-[52ch] text-small text-muted">
          Steward will show you the exact rules and the exact words your wallet will sign. Signing
          moves no money; it decides what Steward is allowed to do.
        </p>
      ) : (
        <>
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
            Policy v{p.version}
          </p>
          <ol className="mt-2 space-y-2 rounded-md bg-surface-2 p-4" data-testid="policy-sentences">
            {p.sentences.map((s, i) => (
              <li key={s} className="flex gap-3 text-small text-ink">
                <span className="shrink-0 font-mono text-mono text-faint">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          {p.diff.previousVersion !== null ? (
            <div className="pt-4" data-testid="policy-diff">
              <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
                What changes from v{p.diff.previousVersion}
              </p>
              {p.diff.added.length === 0 && p.diff.removed.length === 0 ? (
                <p className="pt-2 text-small text-muted">
                  Nothing changes. Signing re-states the rules Steward already follows.
                </p>
              ) : (
                <ul className="pt-2 space-y-1.5">
                  {p.diff.removed.map((s) => (
                    <li key={`-${s}`} className="flex gap-2 text-small text-deny">
                      <span aria-hidden="true" className="font-mono">
                        −
                      </span>
                      <span>
                        <span className="sr-only">Removed: </span>
                        {s}
                      </span>
                    </li>
                  ))}
                  {p.diff.added.map((s) => (
                    <li key={`+${s}`} className="flex gap-2 text-small text-allow">
                      <span aria-hidden="true" className="font-mono">
                        +
                      </span>
                      <span>
                        <span className="sr-only">Added: </span>
                        {s}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <LiteralPayload value={p.message} />
        </>
      )}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <div className="pt-6">
        {p === null ? (
          <Button loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Review your policy
          </Button>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              {cta}
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Not yet</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
