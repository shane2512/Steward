'use client';
// Shared chrome for every signing flow (task 7.6). DESIGN §9: the literal payload to be signed is
// rendered in `mono` on SOLID `surface-2` — never on glass, because the owner has to read it.
//
// `LiteralPayload` takes the text or object EXACTLY as the server returned it and prints it. It has
// no formatting parameters on purpose: anything that reshaped the payload would break the promise
// that what you read is what your wallet signs.
import type { ReactNode } from 'react';
import { VerdictGlyph } from '@/components/icons';
import { Button, ErrorPanel } from '@/components/ui/primitives';
import type { SignError } from '@/lib/signCopy';
import { PHASE_STATUS, type SignPhase } from '@/lib/useSignFlow';
import { BLOCKER_COPY, type CompanionTreasury, type SignerBlocker } from '@/lib/useSigner';
import { CopyAddress } from '@/components/ui/CopyAddress';

/**
 * The bytes the wallet will be given. A string is printed as-is; an object is printed as the JSON
 * the wallet receives. Nothing is re-derived, abbreviated or re-ordered here.
 */
export function LiteralPayload({
  value,
  label = 'You will sign:',
  testId = 'literal-payload',
}: {
  value: string | object;
  label?: string;
  testId?: string;
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="pt-4">
      <p className="pb-2 font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
        {label}
      </p>
      <pre
        data-testid={testId}
        tabIndex={0}
        className="max-h-72 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-mono break-words whitespace-pre-wrap text-ink"
      >
        {text}
      </pre>
    </div>
  );
}

/** Announces idle → awaiting-signature → submitting → done to assistive technology. */
export function SignStatus({ phase }: { phase: SignPhase }) {
  return (
    <p
      role="status"
      aria-live="polite"
      data-phase={phase}
      className="pt-3 text-small text-muted empty:hidden"
    >
      {PHASE_STATUS[phase]}
    </p>
  );
}

export function SignErrorPanel({ error, onRetry }: { error: SignError; onRetry?: () => void }) {
  return (
    <div className="pt-4">
      <ErrorPanel
        title={error.title}
        body={error.body}
        {...(error.retryable && onRetry ? { onRetry } : {})}
      />
    </div>
  );
}

/** Wrong network / EOA / disconnected, explained before any signature is requested. */
export function BlockerPanel({
  blocker,
  onSwitch,
  switching,
}: {
  blocker: NonNullable<SignerBlocker>;
  onSwitch: () => void;
  switching: boolean;
}) {
  const copy = BLOCKER_COPY[blocker.kind];
  return (
    <div role="alert" data-blocker={blocker.kind} className="rounded-md bg-escalate-tint p-4">
      <p className="flex items-center gap-2 text-h3 font-semibold text-escalate">
        <VerdictGlyph tone="escalate" className="size-4 shrink-0" />
        {copy.title}
      </p>
      <p className="max-w-[46ch] pt-2 text-small text-escalate">{copy.body}</p>
      {blocker.kind === 'wrong-network' ? (
        <div className="pt-4">
          <Button variant="ghost" loading={switching} onClick={onSwitch}>
            Switch to Base Sepolia
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phase 7 addendum — the owner connected a regular browser wallet, so their treasury is a Coinbase
 * Smart Wallet Steward derived from it. They have to know that BEFORE they fund anything, because
 * money sent to their everyday balance is not money Steward can work with.
 *
 * DESIGN §9: the address is on solid `surface-2` (via CopyAddress), never on glass — it is meant to
 * be read and copied, character by character.
 */
export function CompanionTreasuryNotice({ companion }: { companion: CompanionTreasury }) {
  return (
    <section
      data-testid="companion-treasury"
      aria-labelledby="companion-treasury-title"
      className="rounded-md bg-surface-2 p-4"
    >
      <h3 id="companion-treasury-title" className="text-h3 font-semibold text-ink">
        Your treasury is a Smart Wallet Steward set up for you
      </h3>
      <p className="max-w-[46ch] pt-2 text-small text-muted">
        The wallet you connected is a standard browser wallet, and one of those cannot grant a
        capped spending permission. So your treasury is a Coinbase Smart Wallet owned by the wallet
        you connected — you still control it, and you still sign for it.
      </p>
      <p className="max-w-[46ch] pt-2 text-small font-semibold text-ink">
        Fund this address, not your everyday wallet balance.
      </p>
      <div className="pt-3">
        <CopyAddress address={companion.address} />
      </div>
      <p role="status" aria-live="polite" className="pt-3 text-small text-muted">
        {companion.deployed
          ? 'This wallet is live on Base Sepolia.'
          : 'Not created on-chain yet. It is still safe to send USDC here: the address is fixed, and the wallet is created the first time it is used.'}
      </p>
    </section>
  );
}

/** A labelled fact row inside a sign sheet ("To", "Amount", "Every"). */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-small text-muted">{label}</span>
      <span className="min-w-0 text-right text-h3 font-semibold text-ink">{children}</span>
    </div>
  );
}
