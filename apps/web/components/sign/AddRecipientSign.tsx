'use client';
// (c) Recipient-add signing — S8 (task 7.6). Task 7.7 embeds this inside the Recipients screen; this
// file is only the form, the confirmation and the signature.
//
// The confirmation screen is the security surface: it shows the address the SERVER checksummed (not
// the characters typed into the box), in full, in 4-character groups, alongside a first-6/last-6
// form — because "0x4b2e…9f10" on its own is exactly what an address-poisoning attack survives (T3).
// The look-alike warning never blocks and never reaches a rule; Steward matches the allowlist by
// exact equality (I4).
import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { Button, TextButton } from '@/components/ui/primitives';
import { VerdictGlyph } from '@/components/icons';
import { apiPost } from '@/lib/api';
import {
  zRecipientAdded,
  zRecipientPrepare,
  type Recipient,
  type RecipientPrepare,
} from '@/lib/contracts';
import { formatMoney, groupAddress } from '@/lib/format';
import { looksLikeExisting, parseUsdc, sixAndSix } from '@/lib/recipientForm';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { BlockerPanel, FactRow, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

const FIELD =
  'mt-2 h-14 w-full rounded-md bg-surface-2 px-4 text-h3 text-ink placeholder:text-faint';

export function AddRecipientSign({
  existing,
  onAdded,
}: {
  /** The current allowlist, for the look-alike warning only. */
  existing: readonly Recipient[];
  onAdded: (r: Recipient, needsPolicySignature: boolean) => void;
}) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [max, setMax] = useState('');
  const [day, setDay] = useState('');
  const { blocker, switchNetwork, switching } = useSigner();
  const { signMessageAsync } = useSignMessage();

  const maxParsed = parseUsdc(max);
  const dayNumber = day === '' ? undefined : Number(day);
  const addressLooksValid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const scheduleOk =
    dayNumber === undefined || (Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 28);
  const complete = label.trim() !== '' && addressLooksValid && maxParsed.ok && scheduleOk;
  const similar = looksLikeExisting(address.trim(), existing);

  const fields = () => ({
    label: label.trim(),
    address: address.trim(),
    maxPerTx: (maxParsed.ok ? maxParsed.value : 0n).toString(),
    ...(dayNumber === undefined
      ? {}
      : // A monthly schedule needs an amount as well as a day, or it would never pay anything.
        {
          schedule: {
            dayOfMonth: dayNumber,
            amountMicroUsd: (maxParsed.ok ? maxParsed.value : 0n).toString(),
          },
        }),
  });

  const flow = useSignFlow<RecipientPrepare>({
    prepare: () => apiPost('/api/recipients/prepare', zRecipientPrepare, fields()),
    sign: (p) => signMessageAsync({ message: p.message }),
    submit: (_p, signature) =>
      apiPost('/api/recipients', zRecipientAdded, { ...fields(), signature }).then((r) =>
        onAdded(r.recipient, r.needsPolicySignature),
      ),
  });

  if (blocker !== null && blocker.kind !== 'disconnected')
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;

  const p = flow.prepared;

  return (
    <div data-testid="add-recipient-sign">
      {p === null ? (
        <>
          <label htmlFor="r-label" className="block text-small font-semibold text-ink">
            Name
          </label>
          <input
            id="r-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Mara Okonjo"
            className={FIELD}
          />

          <label htmlFor="r-address" className="block pt-5 text-small font-semibold text-ink">
            Address
          </label>
          <input
            id="r-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            aria-describedby="r-address-note"
            className={`${FIELD} font-mono text-mono`}
          />
          <p id="r-address-note" className="pt-2 text-small text-muted">
            Steward matches this address exactly. No ENS, no look-alikes. Check every character.
          </p>
          {address.trim() !== '' && !addressLooksValid ? (
            <p role="alert" className="pt-1 text-small text-deny">
              That is not an Ethereum address. Nothing was saved.
            </p>
          ) : null}
          {similar ? (
            <div
              role="alert"
              data-testid="poison-warning"
              className="mt-3 rounded-md bg-escalate-tint p-3"
            >
              <p className="flex items-center gap-2 text-small font-semibold text-escalate">
                <VerdictGlyph tone="escalate" className="size-4 shrink-0" />
                This looks like {similar.label}
              </p>
              <p className="pt-1 text-small text-escalate">
                It starts or ends the same way as an address you already pay, which is how address
                poisoning works. Compare every character before you sign. Steward will not treat
                these two as the same address.
              </p>
            </div>
          ) : null}

          <label htmlFor="r-max" className="block pt-5 text-small font-semibold text-ink">
            Most per payment
          </label>
          <input
            id="r-max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            inputMode="decimal"
            placeholder="1200"
            className={`${FIELD} tabular`}
          />
          {max.trim() !== '' && !maxParsed.ok ? (
            <p role="alert" className="pt-1 text-small text-deny">
              Enter an amount in USDC, like 1200 or 1200.50.
            </p>
          ) : null}

          <label htmlFor="r-day" className="block pt-5 text-small font-semibold text-ink">
            Pay monthly on day (optional)
          </label>
          <input
            id="r-day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            inputMode="numeric"
            placeholder="1 to 28"
            className={`${FIELD} tabular`}
          />
        </>
      ) : (
        <div data-testid="recipient-confirm">
          <div className="rounded-md bg-surface-2 px-4 py-2">
            <FactRow label="Name">{label.trim()}</FactRow>
            <FactRow label="Most per payment">
              {formatMoney(maxParsed.ok ? maxParsed.value : 0n)}
            </FactRow>
            {dayNumber === undefined ? null : (
              <FactRow label="Every month on">day {dayNumber}</FactRow>
            )}
          </div>
          <div className="mt-4 rounded-md bg-surface-2 p-4">
            <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
              Address, in full
            </p>
            {/* Both forms of the SERVER's checksummed address: the compact one people quote, and
                every character, grouped, so a look-alike cannot hide in the middle. */}
            <p className="pt-2 font-mono text-h3 text-ink" data-testid="address-short">
              {sixAndSix(p.address)}
            </p>
            <p
              className="pt-2 font-mono text-mono break-all text-ink"
              data-testid="address-grouped"
            >
              {groupAddress(p.address)}
            </p>
          </div>
          <LiteralPayload value={p.message} />
        </div>
      )}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.reset} /> : null}

      <div className="pt-6">
        {p === null ? (
          <Button disabled={!complete} loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Check this address
          </Button>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              Sign and add recipient
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Go back and edit</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
