'use client';
// S2 connect screen (docs/DESIGN.md §11 S2). Presentational: the state comes from the connect state
// machine, so every state can be rendered and tested without a wallet.
import Link from 'next/link';
import { IconClose, IconLock, IconShield, VerdictGlyph } from '@/components/icons';
import { Button, Chip, Row } from '@/components/ui/primitives';
import { connectCopy, type ConnectState } from '@/lib/connectMachine';

type ConnectorLike = { id: string; name: string };

const BUSY = new Set<ConnectState['step']>([
  'connecting',
  'switching',
  'signing',
  'verifying',
  'wrong_network',
  'signed_in',
]);

export function ConnectView({
  state,
  connectors,
  onConnect,
  onRetry,
}: {
  state: ConnectState;
  connectors: readonly ConnectorLike[];
  onConnect: (connectorId: string) => void;
  onRetry: () => void;
}) {
  const copy = connectCopy(state);
  const busy = BUSY.has(state.step);
  const bad = state.step === 'unsupported' || state.step === 'error';
  const retryable = state.step === 'rejected' || state.step === 'error';

  return (
    <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col">
      <header className="flex h-14 items-center px-2">
        <Link
          href="/"
          aria-label="Close"
          className="flex size-11 items-center justify-center text-ink"
        >
          <IconClose className="size-6" />
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 px-4 pt-4 outline-none">
        <svg viewBox="0 0 64 64" className="mx-auto size-16" aria-hidden="true" focusable="false">
          <path d="M10 16h44v32H10z" fill="var(--st-surface-3)" />
          <path d="M10 16l22 16 22-16" fill="none" stroke="var(--st-surface-2)" strokeWidth="4" />
          <path d="M40 40h14v8H40z" fill="var(--st-accent)" />
        </svg>
        <h1 className="pt-5 text-center text-h2 font-bold text-ink">Connect your wallet</h1>
        <p className="mx-auto max-w-[46ch] pt-2 text-center text-small text-muted">
          Steward never holds your keys. You grant a capped spend permission and you can revoke it
          at any time.
        </p>

        <div className="pt-6">
          <Row icon={IconShield} title="Base Sepolia only" right={<Chip>Testnet</Chip>} />
          <Row icon={IconLock} title="Read-only until you sign" sub="Signing in moves no funds" />
        </div>

        <div aria-live="polite" className="pt-4">
          {copy ? (
            <div
              role={bad ? 'alert' : 'status'}
              className={`rounded-md p-4 ${bad ? 'bg-deny-tint' : 'bg-surface-2'}`}
              data-state={state.step}
            >
              <p
                className={`flex items-center gap-2 text-h3 font-semibold ${bad ? 'text-deny' : 'text-ink'}`}
              >
                {bad ? <VerdictGlyph tone="deny" className="size-4 shrink-0" /> : null}
                {copy.title}
              </p>
              <p className="max-w-[46ch] pt-2 text-small text-muted">{copy.body}</p>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="px-4 pt-6 pb-6">
        {state.step === 'unsupported' ? (
          <Button onClick={onRetry}>Try again</Button>
        ) : retryable ? (
          <Button onClick={onRetry} loading={busy}>
            Try again
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {connectors.map((c) => (
              <Button key={c.id} onClick={() => onConnect(c.id)} loading={busy}>
                {busy ? 'Connecting' : `Connect with ${c.name}`}
              </Button>
            ))}
          </div>
        )}
        <p className="pt-3 text-center text-small text-faint">
          By connecting you agree to the Terms.
        </p>
      </footer>
    </div>
  );
}
