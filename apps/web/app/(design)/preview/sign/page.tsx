'use client';
/**
 * Design reference for the task 7.6 signing surfaces, alongside `/preview`.
 *
 * Mock props only — no API call decides anything here. It exists so the approval sheet and the
 * add-recipient sheet can be seen and screenshotted before task 7.7 builds the screens that host
 * them, and so their glass/mono/contrast can be checked against DESIGN.md in both themes.
 *
 * `/preview/sign` renders dark (the default). `/preview/sign?theme=light` renders light.
 */
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AddRecipientSign } from '@/components/sign/AddRecipientSign';
import { ApprovalSign } from '@/components/sign/ApprovalSign';
import { LiteralPayload, FactRow } from '@/components/sign/SignSurface';
import { Sheet } from '@/components/ui/Sheet';
import { groupAddress } from '@/lib/format';
import type { Approval, Recipient } from '@/lib/contracts';

const PAYEE = '0x4B2E0000000000000000000000000000000009f1';

const approval: Approval = {
  id: 'fx-approval',
  decisionId: 'fx-decision',
  proposalHash: '0x9f3c1d0a6b5e4f2a8c7d1e0b9a8f7e6d5c4b3a291807f6e5d4c3b2a190807060',
  status: 'pending',
  message: [
    'Steward approval',
    'Wallet: 7f1c8e40-3b2a-4d5e-9f10-0a1b2c3d4e5f',
    'Proposal: 0x9f3c1d0a6b5e4f2a8c7d1e0b9a8f7e6d5c4b3a291807f6e5d4c3b2a190807060',
    'Policy: v3',
    'Expires: 2026-09-23T09:00:00.000Z',
  ].join('\n'),
  // Fixed, not `Date.now()`: a relative time computed at module scope differs between the server
  // render and the client hydration, which is a mismatch, not a design.
  expiresAt: '2026-12-01T09:00:00.000Z',
  decidedAt: null,
  proposal: null,
  rationale:
    'Devon Achebe is due 4,000 USDC today, which is over the 2,500 USDC you allow per payment.',
};

const existing: Recipient[] = [
  {
    id: 'fx-r1',
    label: 'Mara Okonjo',
    address: '0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802',
    maxPerTx: '1200000000',
    scheduleDayOfMonth: 1,
    status: 'active',
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-10">
      <h2 className="px-4 pb-3 font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
        {title}
      </h2>
      <div className="mx-auto max-w-[440px] rounded-lg bg-surface p-4">{children}</div>
    </section>
  );
}

function Body() {
  const params = useSearchParams();
  // No `?theme` means "follow the browser", which is what the screenshot script emulates.
  const theme = params.get('theme');
  const noop = () => {};
  return (
    <main
      {...(theme === 'light' || theme === 'dark' ? { 'data-theme': theme } : {})}
      className="min-h-dvh bg-ground pb-24 font-sans text-body text-ink"
    >
      <h1 className="px-4 pt-8 text-h1 font-bold">Signing surfaces (7.6)</h1>
      <p className="max-w-[60ch] px-4 pt-2 text-small text-muted">
        Mock data. Every literal payload below is rendered exactly as a server route would return
        it; in the product nothing on this page is ever composed in the browser.
      </p>

      <Section title="S6 approval sheet">
        <ApprovalSign approval={approval} onDecided={noop} />
      </Section>

      <Section title="S8 add recipient">
        <AddRecipientSign existing={existing} onAdded={noop} />
      </Section>

      <Section title="S8 confirmation block">
        <div className="rounded-md bg-surface-2 px-4 py-2">
          <FactRow label="Name">Devon Achebe</FactRow>
          <FactRow label="Most per payment">4,000 USDC ($4,000)</FactRow>
        </div>
        <div className="mt-4 rounded-md bg-surface-2 p-4">
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
            Address, in full
          </p>
          <p className="pt-2 font-mono text-h3">0x4B2E…0009f1</p>
          <p className="pt-2 font-mono text-mono break-all">{groupAddress(PAYEE)}</p>
        </div>
        <LiteralPayload
          value={[
            'Steward recipient',
            'Wallet: 7f1c8e40-3b2a-4d5e-9f10-0a1b2c3d4e5f',
            'Label: Devon Achebe',
            `Address: ${PAYEE}`,
            'Max per payment: 4000 USDC',
            'Schedule: monthly on day 1',
            'Nonce: 6d1f8a2c4b9e0d7f',
            'Expires: 2026-09-22T09:05:00.000Z',
          ].join('\n')}
        />
      </Section>

      <Section title="S3 step 5 policy activation">
        <LiteralPayload
          value={
            'Steward policy v3 0x7b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c'
          }
        />
      </Section>

      {/* `?sheet=1` puts the same approval in its real chrome: glass, 28px top corners, grabber. */}
      {params.get('sheet') === '1' ? (
        <Sheet open title="Steward needs you" onClose={noop}>
          <ApprovalSign approval={approval} onDecided={noop} />
        </Sheet>
      ) : null}
    </main>
  );
}

export default function SignPreviewPage() {
  return (
    <Suspense>
      <Body />
    </Suspense>
  );
}
