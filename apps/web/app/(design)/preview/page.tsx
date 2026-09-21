/**
 * Static design preview — docs/DESIGN.md made visible.
 *
 * Mock data only. No API calls, no auth, no wallet/policy/reasoning imports.
 * This page is the living reference for Phase 7; it is not a product screen.
 *
 * `/preview` renders light, `/preview?theme=dark` renders dark.
 */
import type { ReactNode } from 'react';

export const metadata = { title: 'Steward — design preview' };

/* ---------------------------------------------------------------- primitives */

function Money({
  amount,
  minor,
  token = 'USDC',
  usd,
  size = 'body',
}: {
  amount: string;
  minor: string;
  token?: string;
  usd?: string;
  size?: 'body' | 'balance';
}) {
  const big = size === 'balance';
  return (
    <span className="tabular">
      <span className={big ? 'text-balance font-bold tracking-[-0.02em] sm:text-balance-lg' : ''}>
        {amount}
      </span>
      <span className={big ? 'text-[0.62em] font-bold text-muted' : 'text-muted'}>{minor}</span>
      <span className={big ? 'ml-2 text-small text-muted' : ' text-muted'}> {token}</span>
      {usd ? <span className="block text-small text-muted">({usd})</span> : null}
    </span>
  );
}

function Card({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'warn' | 'stop';
}) {
  const border = tone === 'warn' ? 'border-warn' : tone === 'stop' ? 'border-stop' : 'border-line';
  return <div className={`rounded-lg border ${border} bg-surface p-5 shadow-e1`}>{children}</div>;
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-h2 font-semibold tracking-[-0.01em]">{children}</h2>;
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-label font-medium text-muted">{children}</span>;
}

function Button({
  children,
  variant = 'outline',
}: {
  children: ReactNode;
  variant?: 'primary' | 'outline' | 'danger' | 'danger-outline';
}) {
  const base =
    'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-4 text-small font-medium transition-colors duration-[120ms] sm:px-5';
  const styles = {
    primary: 'bg-seal text-on-accent',
    outline: 'border border-line-strong bg-transparent text-ink',
    danger: 'bg-stop text-on-accent',
    'danger-outline': 'border border-stop bg-transparent text-stop',
  } as const;
  return (
    <button type="button" className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- components */

function Meter({
  pct,
  limitPct = 100,
  tone,
  caption,
  valueText,
}: {
  pct: number;
  limitPct?: number;
  tone: 'seal' | 'warn' | 'stop' | 'ok';
  caption: string;
  valueText: string;
}) {
  const fill = { seal: 'bg-seal', warn: 'bg-warn', stop: 'bg-stop', ok: 'bg-ok' }[tone];
  return (
    <div>
      <div
        className="meter-track"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueText}
      >
        <div className={`meter-fill ${fill}`} style={{ width: `${pct}%` }} />
        <span className="limit-line" style={{ left: `${limitPct}%` }} aria-hidden />
      </div>
      <p className="mt-2 text-small text-muted">{caption}</p>
    </div>
  );
}

const PILLS = {
  running: { dot: 'bg-ok breathe', text: 'text-ink', label: 'Running' },
  idle: { dot: 'bg-muted', text: 'text-muted', label: 'Idle' },
  degraded: { dot: 'bg-warn', text: 'text-warn', label: 'Safe mode' },
  parked: { dot: 'bg-warn', text: 'text-warn', label: 'Holding still' },
  frozen: { dot: 'bg-stop', text: 'text-stop', label: 'Frozen' },
  breaker: { dot: 'bg-stop', text: 'text-stop', label: 'Breaker tripped' },
} as const;

function StatusPill({ state }: { state: keyof typeof PILLS }) {
  const p = PILLS[state];
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line px-3 text-small">
      <span className={`size-2 rounded-full ${p.dot}`} aria-hidden />
      <span className={p.text}>{p.label}</span>
    </span>
  );
}

const VERDICTS = {
  allow: { glyph: '✓', color: 'text-ok', edge: '' },
  escalate: { glyph: '⚠', color: 'text-warn', edge: '' },
  deny: { glyph: '✕', color: 'text-stop', edge: 'border-l-2 border-stop pl-3 -ml-[2px]' },
  noop: { glyph: '·', color: 'text-muted', edge: '' },
} as const;

function DecisionRow({
  verdict,
  title,
  time,
  amount,
  note,
}: {
  verdict: keyof typeof VERDICTS;
  title: string;
  time: string;
  amount?: string;
  note?: string;
}) {
  const v = VERDICTS[verdict];
  return (
    <div className={`flex min-h-14 gap-3 border-b border-line py-3 last:border-b-0 ${v.edge}`}>
      <span className={`w-5 shrink-0 text-center ${v.color}`} aria-hidden>
        {v.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-h3 font-medium">
          <span className="sr-only">{verdict === 'deny' ? 'Blocked. ' : ''}</span>
          {title}
        </p>
        <p className="text-small text-muted">{time}</p>
        {note ? <p className="mt-1 text-small text-stop">{note}</p> : null}
      </div>
      {amount ? <span className="tabular shrink-0 text-h3 font-medium">{amount}</span> : null}
    </div>
  );
}

function RuleChip({
  code,
  text,
  state,
}: {
  code: string;
  text: string;
  state: keyof typeof VERDICTS;
}) {
  const v = VERDICTS[state];
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-line-strong px-2 py-1 text-small">
      <span className={v.color} aria-hidden>
        {v.glyph}
      </span>
      <span className="font-mono text-mono">{code}</span>
      <span className="text-muted">{text}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ screens */

function DemoBanner() {
  return (
    <div className="glass rounded-md border border-warn px-4 py-3 text-small text-ink">
      Demo data — prices and rates are simulated on Base Sepolia.
    </div>
  );
}

function AppHeader() {
  return (
    <header className="glass flex min-h-14 items-center justify-between rounded-md border border-line px-4">
      <span className="text-h3 font-semibold tracking-[-0.02em]">
        Stewar<span className="border-b-2 border-seal pb-px">d</span>
      </span>
      <div aria-live="polite">
        <StatusPill state="running" />
      </div>
      <Button variant="danger-outline">Freeze</Button>
    </header>
  );
}

function BalanceCard() {
  return (
    <div className="seal-wash rounded-lg">
      <div className="glass rounded-lg border border-line p-5 shadow-e1">
        <p className="text-center">
          <Label>Treasury</Label>
        </p>
        <p className="mt-2 text-center">
          <Money amount="124,000" minor=".00" usd="$124,000.00" size="balance" />
        </p>

        <div className="mt-6">
          <Meter
            pct={58}
            tone="seal"
            valueText="4,200 USDC of a 10,000 USDC daily limit remains"
            caption="Steward can still move 4,200 USDC today, of 10,000."
          />
        </div>

        <p className="mt-4 text-center">
          <span className="tabular inline-flex min-h-8 items-center gap-2 rounded-full border border-line-strong px-3 text-small">
            Maximum at risk 12,400 USDC
            <span className="text-seal" aria-hidden>
              ⓘ
            </span>
          </span>
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Button>Add funds</Button>
          <Button>Activity</Button>
          <Button variant="danger-outline">Freeze</Button>
        </div>
      </div>
    </div>
  );
}

function ParkedNotice() {
  return (
    <Card tone="warn">
      <p className="text-h3 font-medium text-warn">Steward is holding still</p>
      <p className="mt-2 text-small">
        It can’t pay Acme Design (8,000 USDC) inside today’s limit, and it won’t deploy idle cash
        while a payment is due. Nothing is wrong with your funds.
      </p>
      <p className="mt-3">
        <a className="text-small font-medium text-seal underline underline-offset-4" href="#s5">
          See why
        </a>
      </p>
    </Card>
  );
}

const SIGNING_MESSAGE = `Steward approval
Wallet: 7f3c9d21-88ab-4c41-9e5f-1a2b3c4d5e6f
Proposal: 0x9a41c8b2e7d4f6019b3c5a8e2d7f4109c6b3e8a5d2f7019c4b6e3a8d5f201c7b
Policy: v3
Expires: 2026-09-21T18:12:00.000Z`;

function ApprovalSheet() {
  return (
    <div className="rounded-xl bg-ground/60 p-3">
      <div className="glass-sheet rounded-xl border border-line-strong p-5 shadow-e2">
        <h3 className="text-h1 font-bold tracking-[-0.015em]">Pay Acme Design</h3>
        <p className="mt-1">
          <Money amount="8,000" minor=".00" usd="$8,000.00" />
        </p>

        <div className="mt-6">
          <H>You’ll see these changes</H>
          <div className="rounded-md border border-line bg-surface">
            <div className="flex justify-between border-b border-line px-4 py-3 text-small">
              <span>Agent wallet</span>
              <span className="tabular text-stop">−8,000.00 USDC</span>
            </div>
            <div className="flex justify-between px-4 py-3 text-small">
              <span>Acme Design</span>
              <span className="tabular text-ok">+8,000.00 USDC</span>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <H>Why Steward proposed this</H>
          <p className="max-w-[68ch] text-body">
            The 1 October invoice is due and sits above the amount Steward can pay on its own.
          </p>
        </div>

        <div className="mt-6">
          <H>Rules that triggered</H>
          <div className="flex flex-wrap gap-2">
            <RuleChip code="R10" text="Above the autonomous limit" state="escalate" />
            <RuleChip code="R03" text="Recipient is on your list" state="allow" />
          </div>
        </div>

        <div className="mt-6">
          <H>What you will sign</H>
          {/* SECURITY §5 — verbatim from the API, never rebuilt. */}
          <pre className="overflow-x-auto rounded-md border border-line bg-surface p-4 font-mono text-mono whitespace-pre-wrap break-all">
            {SIGNING_MESSAGE}
          </pre>
          <p className="mt-2 text-small text-muted">
            This is exactly what your wallet will show you.
          </p>
        </div>

        <p className="mt-4 text-small text-muted">Expires in 5h 12m</p>
        <div className="mt-4 flex gap-3">
          <Button variant="primary">Approve</Button>
          <Button>Reject</Button>
        </div>
      </div>
    </div>
  );
}

function FreezeModal() {
  const steps = [
    { n: 1, title: 'Freeze now', body: 'Stops every action immediately.', cta: 'danger' as const },
    {
      n: 2,
      title: 'Revoke spending permission',
      body: 'Removes Steward’s on-chain allowance.',
      cta: 'outline' as const,
    },
    {
      n: 3,
      title: 'Bring funds home',
      body: 'Sends everything back to your treasury.',
      cta: 'outline' as const,
    },
  ];
  return (
    <div className="rounded-xl bg-ground/60 p-3">
      <div className="glass-sheet rounded-xl border border-line-strong p-5 shadow-e2">
        <h3 className="text-h1 font-bold tracking-[-0.015em]">Stop Steward</h3>
        <p className="mt-2 max-w-[68ch] text-body text-muted">
          Freezing stops every action immediately. Your funds stay where they are, and you can undo
          this in Settings.
        </p>
        <ol className="mt-5">
          {steps.map((s) => (
            <li key={s.n} className="border-b border-line py-4 last:border-b-0">
              <div className="flex gap-3">
                <span className="tabular w-5 shrink-0 text-muted">{s.n}</span>
                <div className="flex-1">
                  <p className="text-h3 font-medium">{s.title}</p>
                  <p className="text-small text-muted">{s.body}</p>
                  <div className="mt-3">
                    <Button variant={s.cta === 'danger' ? 'danger' : 'outline'}>
                      {s.n === 1 ? 'Freeze now' : s.n === 2 ? 'Revoke' : 'Sweep'}
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-center gap-4 text-small">
          <span className="text-ok">✓ Frozen at 14:02</span>
          <span className="text-stop">✕ Revoke failed. Nothing moved.</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <p className="mb-3 border-b border-line pb-2 text-label font-medium text-muted">{title}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const { theme } = await searchParams;
  const dark = theme === 'dark';

  return (
    <div data-theme={dark ? 'dark' : 'light'} className="min-h-screen bg-ground text-ink">
      <main className="mx-auto w-[min(100%-2rem,440px)] space-y-10 py-8">
        <header>
          <h1 className="text-h1 font-bold tracking-[-0.015em]">
            Stewar<span className="border-b-2 border-seal pb-px">d</span> design preview
          </h1>
          <p className="mt-2 max-w-[68ch] text-body text-muted">
            Static reference for docs/DESIGN.md. Mock data. {dark ? 'Dark' : 'Light'} theme —{' '}
            <a
              className="font-medium text-seal underline underline-offset-4"
              href={dark ? '/preview' : '/preview?theme=dark'}
            >
              switch to {dark ? 'light' : 'dark'}
            </a>
            .
          </p>
        </header>

        <Section id="s1" title="S1 Landing">
          <h2 className="text-h1 font-bold tracking-[-0.015em]">
            The self-driving treasury that can’t run off with the money.
          </h2>
          <p className="max-w-[68ch] text-body text-muted">
            Steward keeps your idle USDC working, pays your team on schedule, and cannot exceed the
            limit you signed.
          </p>
          <Button variant="primary">Connect wallet</Button>
          <BalanceCard />
          <div className="border-t border-line">
            <div className="flex justify-between border-b border-line py-3 text-body">
              <span>Earns on idle cash</span>
            </div>
            <div className="flex justify-between border-b border-line py-3 text-body">
              <span>Pays your team on time</span>
            </div>
            <div className="flex justify-between py-3 text-body">
              <span>Attacks blocked</span>
              <span className="tabular font-medium">1,204</span>
            </div>
          </div>
        </Section>

        <Section id="s2" title="S2 Connect">
          <h2 className="text-h1 font-bold tracking-[-0.015em]">Connect your wallet</h2>
          <p className="max-w-[68ch] text-body text-muted">
            Steward never sees a seed phrase and never holds your funds.
          </p>
          <Card>
            <div className="flex min-h-14 items-center justify-between">
              <div>
                <p className="text-h3 font-medium">Coinbase Smart Wallet</p>
                <p className="text-small text-muted">Passkey — no extension</p>
              </div>
              <span className="text-muted" aria-hidden>
                ›
              </span>
            </div>
          </Card>
          <Card tone="stop">
            <p className="text-h3 font-medium text-stop">Signature declined</p>
            <p className="mt-1 text-small">You declined the signature. Nothing was sent.</p>
            <div className="mt-3">
              <Button>Try again</Button>
            </div>
          </Card>
        </Section>

        <Section id="s4" title="S4 Dashboard">
          <AppHeader />
          <DemoBanner />
          <BalanceCard />
          <ParkedNotice />

          <div className="flex flex-wrap gap-2">
            <StatusPill state="running" />
            <StatusPill state="idle" />
            <StatusPill state="degraded" />
            <StatusPill state="frozen" />
            <StatusPill state="breaker" />
          </div>

          <div>
            <H>Working in vaults</H>
            <Card>
              <div className="flex justify-between">
                <div>
                  <p className="text-h3 font-medium">Aave USDC</p>
                  <p className="text-small text-muted">4.8% APY</p>
                </div>
                <div className="text-right">
                  <span className="tabular text-h3 font-medium">44,000.00</span>
                  <p className="text-small text-warn">Updated 6 min ago</p>
                </div>
              </div>
            </Card>
          </div>

          <div>
            <H>Liquid runway</H>
            <Meter
              pct={74}
              limitPct={60}
              tone="ok"
              valueText="7.4 months of runway against a 6 month buffer"
              caption="7.4 months liquid · buffer 6.0 months"
            />
          </div>

          <div>
            <H>Next up</H>
            <Card>
              <div className="flex justify-between border-b border-line pb-3 text-body">
                <span>Acme Design</span>
                <span className="tabular">
                  <span className="mr-4 text-muted">1 Oct</span>8,000.00
                </span>
              </div>
              <div className="flex justify-between pt-3 text-body">
                <span>Payroll</span>
                <span className="tabular">
                  <span className="mr-4 text-muted">5 Oct</span>22,400.00
                </span>
              </div>
            </Card>
          </div>
        </Section>

        <Section id="s5" title="S5 Timeline">
          <Card>
            <DecisionRow
              verdict="allow"
              title="Deposited 44,000 USDC into Aave"
              time="12:04 · 8 minutes ago"
              amount="44,000.00"
            />
            <DecisionRow
              verdict="escalate"
              title="Waiting for you: pay Acme Design"
              time="11:59 · 13 minutes ago"
              amount="8,000.00"
            />
            <DecisionRow
              verdict="deny"
              title="Blocked a payment to an address not on your list"
              time="11:47 · 25 minutes ago"
              amount="50,000.00"
              note="Why was this blocked?"
            />
          </Card>
          <div className="flex flex-wrap gap-2">
            <RuleChip code="R00" text="Kind is allowed" state="allow" />
            <RuleChip code="R03" text="Recipient is on your list" state="allow" />
            <RuleChip code="R07" text="Over today's limit" state="deny" />
          </div>
        </Section>

        <Section id="s6" title="S6 Approval sheet (glass)">
          <ApprovalSheet />
        </Section>

        <Section id="s9" title="S9 Freeze (glass)">
          <FreezeModal />
        </Section>

        <Section id="states" title="Empty, error and loading">
          <Card>
            <p className="text-h2 font-semibold">No activity yet</p>
            <p className="mt-2 max-w-[68ch] text-body text-muted">
              Steward checks your treasury every five minutes and will explain anything it does
              here.
            </p>
            <div className="mt-4">
              <Button variant="primary">Run a check now</Button>
            </div>
          </Card>

          <Card tone="stop">
            <p className="text-h3 font-medium text-stop">The deposit did not go through</p>
            <p className="mt-2 max-w-[68ch] text-small">
              The vault rejected the transaction. No money moved and your allowance was not used.
              Steward will try again on the next check.
            </p>
            <div className="mt-4">
              <Button>View the decision</Button>
            </div>
          </Card>

          <Card>
            <div className="h-3 w-24 rounded-full bg-line" />
            <div className="mt-3 h-10 w-52 rounded-md bg-line" />
            <div className="mt-4 h-2 w-full rounded-full bg-line" />
            <div className="mt-6 space-y-3">
              <div className="h-4 w-full rounded-sm bg-line" />
              <div className="h-4 w-3/4 rounded-sm bg-line" />
            </div>
          </Card>
        </Section>
      </main>
    </div>
  );
}
