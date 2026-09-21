/**
 * Static design preview — docs/DESIGN.md v2 made visible.
 *
 * Mock data only. No API calls, no auth, no wallet/policy/reasoning imports.
 * This page is the living reference for Phase 7; it is not a product screen.
 *
 * `/preview` renders dark (the default theme). `/preview?theme=light` renders light.
 */
import type { ReactNode } from 'react';

export const metadata = { title: 'Steward — design preview' };

/* ------------------------------------------------------------------- icons
 * Flat geometric glyphs, 1.75px stroke or solid fill, drawn inline rather than
 * pulling a new dependency in for a design-only page. One family, one weight.
 */
type IconProps = { className?: string };
const S = (d: string) =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className={className}
        aria-hidden="true"
      >
        <path d={d} />
      </svg>
    );
  };

const IconApprovals = S('M12 3v11M12 18v2M4 21h16');
const IconRecipients = S(
  'M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
);
const IconActivity = S('M3 12h4l3-7 4 14 3-7h4');
const IconAdd = S('M12 5v14M5 12h14');
const IconChevron = S('M9 5l7 7-7 7');
const IconBack = S('M15 5l-7 7 7 7');
const IconSearch = S('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4');
const IconExternal = S('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6');
const IconVault = S('M4 5h16v14H4zM12 9v6M9 12h6');
const IconWallet = S('M3 7h15a3 3 0 0 1 3 3v7H3zM3 7V5h13M17 13h1');
const IconHome = S('M4 10l8-6 8 6v10H4z');
const IconSettings = S('M4 7h16M4 12h16M4 17h16');
const IconDoc = S('M6 3h8l4 4v14H6zM14 3v4h4');
const IconShield = S('M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z');
const IconBell = S('M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zM10 20h4');
const IconRevoke = S('M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z');
const IconLock = S('M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3');

function VerdictGlyph({ tone, className }: { tone: Verdict; className?: string }) {
  // Three non-colour channels: filled disc, outlined ring, filled disc with a slash.
  if (tone === 'escalate') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      {tone === 'allow' ? (
        <path d="M4.6 8.2l2.3 2.3 4.5-4.7" fill="none" stroke="var(--st-ground)" strokeWidth="2" />
      ) : (
        <path d="M4.6 4.6l6.8 6.8" fill="none" stroke="var(--st-ground)" strokeWidth="2" />
      )}
    </svg>
  );
}

/* -------------------------------------------------------------- primitives */

function Money({
  amount,
  minor,
  token = 'USDC',
  usd,
}: {
  amount: string;
  minor?: string;
  token?: string;
  usd?: string;
}) {
  return (
    <span className="tabular">
      {amount}
      {minor ? <span className="text-line">{minor}</span> : null}
      {token ? ` ${token}` : null}
      {usd ? <span className="text-muted"> ({usd})</span> : null}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pt-6 pb-2 font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
      {children}
    </p>
  );
}

type Verdict = 'allow' | 'escalate' | 'deny';
const VERDICT: Record<Verdict, { text: string; word: string }> = {
  allow: { text: 'text-allow', word: 'Allowed' },
  escalate: { text: 'text-escalate', word: 'Needs you' },
  deny: { text: 'text-deny', word: 'Denied' },
};

function VerdictBadge({ tone, label }: { tone: Verdict; label?: string }) {
  const v = VERDICT[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 ${v.text}`}>
      <VerdictGlyph tone={tone} className="size-3.5 shrink-0" />
      <span className="text-small font-medium">{label ?? v.word}</span>
    </span>
  );
}

function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn'; children: ReactNode }) {
  const cls = tone === 'warn' ? 'bg-escalate/15 text-escalate' : 'bg-surface-2 text-muted';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 font-mono text-label tracking-[0.08em] uppercase ${cls}`}
    >
      {children}
    </span>
  );
}

function Button({
  variant = 'primary',
  children,
  disabled,
}: {
  variant?: 'primary' | 'ghost' | 'danger';
  children: ReactNode;
  disabled?: boolean;
}) {
  const base =
    'inline-flex h-14 w-full items-center justify-center rounded-full px-6 text-h3 font-bold transition-transform duration-150 ease-[var(--ease-enter)] active:scale-[0.97]';
  const tone = disabled
    ? 'bg-surface-2 text-muted'
    : {
        primary: 'bg-accent text-on-accent hover:bg-accent-press',
        ghost: 'border border-line-strong text-ink hover:bg-surface-2',
        danger: 'bg-deny-fill text-on-deny-fill',
      }[variant];
  return (
    <button type="button" disabled={disabled} className={`${base} ${tone}`}>
      {children}
    </button>
  );
}

function Row({
  icon: Icon,
  title,
  sub,
  right,
  pressed,
  tone,
}: {
  icon?: (p: IconProps) => ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  pressed?: boolean;
  tone?: 'deny';
}) {
  return (
    <div className={`flex min-h-[52px] items-center gap-3 px-4 py-3 ${pressed ? 'row-press' : ''}`}>
      {Icon ? (
        <span className={`shrink-0 ${tone === 'deny' ? 'text-deny' : 'text-ink'}`}>
          <Icon className="size-6" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={`block text-h3 font-semibold ${tone === 'deny' ? 'text-deny' : 'text-ink'}`}
        >
          {title}
        </span>
        {sub ? <span className="block text-small text-muted">{sub}</span> : null}
      </span>
      {right ? <span className="shrink-0 text-right text-small">{right}</span> : null}
    </div>
  );
}

function AllowanceMeter({
  usedPct,
  capPct = 100,
  tone = 'accent',
  caption,
}: {
  usedPct: number;
  capPct?: number;
  tone?: 'accent' | 'escalate' | 'deny';
  caption: string;
}) {
  const fill = { accent: 'bg-accent', escalate: 'bg-escalate', deny: 'bg-deny' }[tone];
  return (
    <div>
      <div className="meter-track">
        <div className="meter-beyond" style={{ width: `${100 - capPct}%` }} />
        <div className={`meter-fill ${fill}`} style={{ width: `${usedPct}%` }} />
        <div className="limit-line" style={{ left: `${capPct}%` }} />
      </div>
      <p className="pt-2 font-mono text-label tracking-[0.06em] text-faint uppercase">{caption}</p>
    </div>
  );
}

function StatusPill({ state }: { state: 'running' | 'idle' | 'degraded' | 'frozen' }) {
  const map = {
    running: { dot: 'bg-allow breathe', label: 'Running' },
    idle: { dot: 'bg-muted', label: 'Idle' },
    degraded: { dot: 'bg-escalate', label: 'Degraded' },
    frozen: { dot: 'bg-deny', label: 'Frozen' },
  }[state];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5">
      <span className={`size-2 rounded-full ${map.dot}`} />
      <span className="text-small font-medium text-ink">{map.label}</span>
    </span>
  );
}

function FreezeButton({ frozen }: { frozen?: boolean }) {
  return frozen ? (
    <span className="inline-flex h-9 items-center rounded-full bg-deny-fill px-4 text-small font-bold text-on-deny-fill">
      Frozen
    </span>
  ) : (
    <span className="inline-flex h-9 items-center rounded-full border border-deny/40 px-4 text-small font-bold text-deny">
      Freeze
    </span>
  );
}

function Wordmark() {
  return (
    <span className="relative inline-block text-h3 font-bold tracking-[-0.02em] text-ink">
      Steward
      <span className="wordmark-rule" />
    </span>
  );
}

/* ----------------------------------------------------------------- shells */

function Phone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="w-[390px] shrink-0">
      <h2 className="pb-2 font-mono text-label tracking-[0.12em] text-faint uppercase">{label}</h2>
      <div className="overflow-hidden rounded-lg border border-line bg-ground">{children}</div>
    </section>
  );
}

function Header({ frozen }: { frozen?: boolean }) {
  return (
    <header className="glass sticky top-0 z-10 flex h-14 items-center justify-between px-4">
      <Wordmark />
      <StatusPill state={frozen ? 'frozen' : 'running'} />
      <FreezeButton frozen={frozen} />
    </header>
  );
}

function TabBar({ active = 'Home' }: { active?: string }) {
  const items: Array<[string, (p: IconProps) => ReactNode]> = [
    ['Home', IconHome],
    ['Activity', IconActivity],
    ['Approve', IconApprovals],
    ['People', IconRecipients],
    ['Settings', IconSettings],
  ];
  return (
    <nav className="flex bg-surface pt-0 pb-3">
      {items.map(([name, Icon]) => {
        const on = name === active;
        return (
          <span key={name} className="relative flex flex-1 flex-col items-center gap-1 pt-3">
            {on ? <span className="absolute top-0 h-[3px] w-10 rounded-full bg-accent" /> : null}
            <Icon className={`size-6 ${on ? 'text-ink' : 'text-muted'}`} />
            <span className={`text-label ${on ? 'font-semibold text-ink' : 'text-muted'}`}>
              {name}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative bg-ground pt-16">
      <div className="scrim absolute inset-0" />
      <div className="glass-sheet relative rounded-t-xl px-4 pt-3 pb-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-faint" />
        <h3 className="pb-4 text-h2 font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ screens */

function Dashboard() {
  return (
    <>
      <Header />
      <div className="flex items-center gap-2 bg-escalate/15 px-4 py-2">
        <span className="font-mono text-label font-semibold tracking-[0.12em] text-escalate uppercase">
          Demo data
        </span>
        <span className="text-small text-escalate">
          Prices and rates are mocked on Base Sepolia.
        </span>
      </div>

      <div className="px-4 pt-4">
        <div className="glass rounded-lg p-5">
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
            Treasury
          </p>
          <p className="pt-2 text-balance font-bold tracking-[-0.02em] text-ink tabular">
            $12,480<span className="text-line">.00</span>
          </p>
          <p className="pt-1.5 text-small text-muted">
            <span className="text-allow tabular">+$38.20</span> today · 4.12% APY
          </p>
          <div className="pt-5">
            <AllowanceMeter usedPct={24} capPct={78} caption="2,400 USDC of 10,000 used today" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-4 pt-5">
        {(
          [
            ['Approvals', IconApprovals, '2'],
            ['Recipients', IconRecipients, null],
            ['Activity', IconActivity, null],
            ['Add funds', IconAdd, null],
          ] as Array<[string, (p: IconProps) => ReactNode, string | null]>
        ).map(([name, Icon, badge]) => (
          <span key={name} className="flex flex-col items-center gap-2">
            <span className="relative flex size-[52px] items-center justify-center rounded-full bg-surface-3">
              <Icon className="size-6 text-ink" />
              {badge ? (
                <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-label font-bold text-on-accent">
                  {badge}
                </span>
              ) : null}
            </span>
            <span className="text-small font-semibold text-ink">{name}</span>
          </span>
        ))}
      </div>

      <Eyebrow>Positions</Eyebrow>
      <Row
        icon={IconVault}
        title="Aave USDC"
        sub="4.12% APY"
        right={<Money amount="8,100" usd="$8,100" />}
      />
      <Row
        icon={IconWallet}
        title="Idle in treasury"
        sub="not earning"
        right={<Money amount="4,380" usd="$4,380" />}
      />

      <Eyebrow>Recent</Eyebrow>
      <Row
        icon={IconActivity}
        title="Paid Mara Okonjo"
        sub={<VerdictBadge tone="allow" />}
        right={
          <>
            <Money amount="1,200" />
            <span className="block font-mono text-label text-faint">2h ago</span>
          </>
        }
      />
      <Row
        icon={IconVault}
        title="Deposit to Aave"
        sub={<VerdictBadge tone="allow" />}
        right={
          <>
            <Money amount="3,000" />
            <span className="block font-mono text-label text-faint">6h ago</span>
          </>
        }
      />
      <Row
        icon={IconActivity}
        title="Pay 0x7ac1...4d90"
        sub={<VerdictBadge tone="deny" />}
        right={
          <>
            <span className="text-muted">blocked</span>
            <span className="block font-mono text-label text-faint">9h ago · R-04</span>
          </>
        }
      />
      <div className="px-4 pt-2 pb-6 text-right">
        <span className="text-small font-semibold text-accent-ink">View all activity</span>
      </div>

      <TabBar active="Home" />
    </>
  );
}

function Timeline() {
  return (
    <>
      <header className="glass sticky top-0 z-10 flex h-14 items-center gap-3 px-4">
        <IconBack className="size-6 text-ink" />
        <span className="flex-1 text-h3 font-semibold text-ink">Activity</span>
        <FreezeButton />
      </header>

      <div className="px-4 pt-4">
        <div className="flex rounded-full bg-surface-2 p-1">
          {['All', 'Allowed', 'Needs you', 'Denied'].map((t, i) => (
            <span
              key={t}
              className={`flex-1 rounded-full py-2 text-center text-small ${
                i === 0 ? 'bg-surface-3 font-semibold text-ink' : 'text-muted'
              }`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="pt-2">
        <Row
          icon={IconActivity}
          title="Paid Mara Okonjo"
          sub={<VerdictBadge tone="allow" />}
          right={
            <>
              <Money amount="1,200" />
              <span className="block font-mono text-label text-faint">14:22</span>
            </>
          }
        />

        <div className="px-4">
          <div className="row-press px-0">
            <Row
              icon={IconVault}
              title="Deposit to Aave"
              sub={<VerdictBadge tone="allow" />}
              right={
                <>
                  <Money amount="3,000" />
                  <span className="block font-mono text-label text-faint">09:04</span>
                </>
              }
            />
            <div className="mx-3 mb-3 rounded-md bg-surface-2 p-4">
              <p className="text-small text-ink">
                Steward proposed moving <Money amount="3,000" usd="$3,000" /> into Aave USDC.
              </p>
              <ul className="space-y-2 pt-4">
                {(
                  [
                    ['allow', 'R-01', 'Daily cap', '2,400 of 10,000'],
                    ['allow', 'R-03', 'Allowlist', 'exact match'],
                    ['allow', 'R-07', 'Depeg guard', 'USDC at 1.0000'],
                    ['allow', 'SIM', 'Simulation', 'no revert'],
                  ] as Array<[Verdict, string, string, string]>
                ).map(([tone, id, name, detail]) => (
                  <li key={id} className="flex items-center gap-2 text-small">
                    <VerdictGlyph
                      tone={tone}
                      className={`size-3.5 shrink-0 ${VERDICT[tone].text}`}
                    />
                    <span className="font-mono text-mono text-faint">{id}</span>
                    <span className="flex-1 text-ink">{name}</span>
                    <span className="text-muted tabular">{detail}</span>
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-2 pt-4 font-mono text-mono text-accent-ink">
                tx 0x9f3c 44ae 7b12 a21b
                <IconExternal className="size-4" />
              </p>
            </div>
          </div>
        </div>

        <Row
          icon={IconActivity}
          title="Pay 0x7ac1...4d90"
          sub={<VerdictBadge tone="deny" />}
          right={
            <>
              <span className="text-muted">blocked</span>
              <span className="block font-mono text-label text-faint">08:51</span>
            </>
          }
        />
        <div className="h-6" />
      </div>
    </>
  );
}

function ApprovalSheet() {
  return (
    <Sheet title="Approve this payment">
      <dl className="space-y-3 text-small">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">To</dt>
          <dd className="text-right text-ink">
            Devon Achebe
            <span className="block font-mono text-mono text-muted">0x4b2e 88c1 90fa 9f10</span>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Amount</dt>
          <dd className="text-ink">
            <Money amount="4,000" usd="$4,000" />
          </dd>
        </div>
      </dl>

      <div className="pt-5">
        <AllowanceMeter
          usedPct={64}
          capPct={78}
          tone="escalate"
          caption="Would use 6,400 of 10,000 today"
        />
      </div>

      <p className="pt-5 pb-2 font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
        You will sign
      </p>
      <pre className="overflow-x-auto rounded-md bg-surface-2 p-4 font-mono text-mono text-ink">
        {`Steward: approve payment
4000 USDC to
0x4b2e88c190fa...9f10
nonce 84 · expires 15m`}
      </pre>

      <ul className="space-y-2 pt-5">
        <li className="flex items-center gap-2 text-small">
          <VerdictGlyph tone="escalate" className="size-3.5 shrink-0 text-escalate" />
          <span className="font-mono text-mono text-faint">R-02</span>
          <span className="flex-1 text-ink">Over the 2,500 single-payment cap</span>
        </li>
        <li className="flex items-center gap-2 text-small">
          <VerdictGlyph tone="allow" className="size-3.5 shrink-0 text-allow" />
          <span className="font-mono text-mono text-faint">R-03</span>
          <span className="flex-1 text-ink">Recipient is allowlisted</span>
        </li>
      </ul>

      <div className="space-y-2 pt-6">
        <Button>Approve</Button>
        <Button variant="ghost">Reject</Button>
      </div>
    </Sheet>
  );
}

function FreezeModal() {
  return (
    <div className="relative bg-ground px-4 py-16">
      <div className="scrim absolute inset-0" />
      <div className="glass-sheet relative rounded-lg p-5">
        <h3 className="text-h2 font-bold text-ink">Freeze Steward</h3>
        <p className="max-w-[46ch] pt-3 text-small text-muted">
          Steward stops proposing and stops executing, right now. Your spend permission is revoked
          on-chain. Nothing in the treasury moves until you unfreeze.
        </p>
        <div className="space-y-2 pt-6">
          <Button variant="danger">Freeze now</Button>
          <Button variant="ghost">Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function AddRecipientSheet() {
  return (
    <Sheet title="Add recipient">
      <label className="block pb-4">
        <span className="block pb-2 text-small font-medium text-ink">Label</span>
        <span className="flex h-12 items-center rounded-md border border-line px-4 text-ink">
          Mara Okonjo
        </span>
      </label>
      <label className="block">
        <span className="block pb-2 text-small font-medium text-ink">Address</span>
        <span className="flex h-12 items-center rounded-md border-2 border-accent-ink px-4 font-mono text-mono text-ink">
          0x1d4f 2a99 60b7 c802
        </span>
      </label>
      <p className="flex gap-2 pt-3 text-small text-escalate">
        <VerdictGlyph tone="escalate" className="mt-1 size-3.5 shrink-0" />
        <span>Steward matches this address exactly. No ENS, no lookalikes. Check it.</span>
      </p>
      <div className="pt-6">
        <Button>Add recipient</Button>
      </div>
    </Sheet>
  );
}

function OnboardingStep() {
  return (
    <>
      <div className="flex gap-1 px-4 pt-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-[3px] flex-1 rounded-full ${i <= 1 ? 'bg-ink' : 'bg-surface-3'}`}
          />
        ))}
      </div>
      <header className="flex h-14 items-center gap-3 px-4">
        <IconBack className="size-6 text-ink" />
        <span className="flex-1" />
        <span className="font-mono text-mono text-faint">Step 2 of 5</span>
      </header>

      <div className="px-4 pt-2">
        <h3 className="text-h1 font-bold tracking-[-0.015em] text-ink">
          What should Steward do with idle USDC?
        </h3>
        <div className="mt-5 rounded-md bg-surface-2 p-4 font-mono text-mono leading-relaxed text-ink">
          Keep 20,000 USDC liquid. Put the rest in Aave. Pay the contractors every Friday.
        </div>
        <p className="max-w-[46ch] pt-3 text-small text-muted">
          Plain English. Steward compiles it into a policy you approve next.
        </p>
      </div>

      <div className="px-4 pt-8 pb-6">
        <Button>Continue</Button>
      </div>
    </>
  );
}

function Settings() {
  return (
    <>
      <header className="flex h-14 items-center justify-center px-4">
        <span className="text-h3 font-semibold text-ink">Settings</span>
      </header>
      <Row
        icon={IconDoc}
        title="Mandate"
        sub="Edit what Steward may do"
        right={<IconChevron className="size-5 text-muted" />}
      />
      <Row
        icon={IconShield}
        title="Spend permission"
        sub="10,000 USDC per day"
        right={<IconChevron className="size-5 text-muted" />}
      />
      <Row
        icon={IconRecipients}
        title="Recipients"
        sub="4 allowlisted addresses"
        right={<IconChevron className="size-5 text-muted" />}
        pressed
      />
      <Row
        icon={IconBell}
        title="Notifications"
        sub="Tell me when Steward needs me"
        right={<IconChevron className="size-5 text-muted" />}
      />
      <Row
        icon={IconDoc}
        title="Export audit log"
        sub="Download every decision as JSON"
        right={<IconChevron className="size-5 text-muted" />}
      />
      <Row
        icon={IconLock}
        title="Verify audit chain"
        sub="Check the log has not been edited"
        right={<IconChevron className="size-5 text-muted" />}
      />
      <Row
        icon={IconSettings}
        title="Network"
        sub="Steward only runs on testnet"
        right={<Chip>Base Sepolia</Chip>}
      />
      <Row
        icon={IconRevoke}
        title="Revoke permission"
        sub="Steward can no longer spend"
        right={<IconChevron className="size-5 text-deny" />}
        tone="deny"
      />
      <Row
        icon={IconRevoke}
        title="Close account"
        sub="Freeze, revoke, sweep home, export"
        right={<IconChevron className="size-5 text-deny" />}
        tone="deny"
      />
      <p className="px-4 py-6 text-center text-small text-faint">Steward runs on Base Sepolia.</p>
      <TabBar active="Settings" />
    </>
  );
}

function StatesColumn() {
  return (
    <>
      {/* loading */}
      <div className="loadbar h-[3px] overflow-hidden bg-transparent">
        <span className="block h-full w-1/4 rounded-full bg-accent" />
      </div>
      <Eyebrow>Loading</Eyebrow>
      <div className="space-y-3 px-4 pb-4">
        <div className="skeleton h-[132px] w-full rounded-lg" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>

      {/* empty */}
      <Eyebrow>Empty</Eyebrow>
      <div className="px-8 py-6 text-center">
        <svg viewBox="0 0 64 64" className="mx-auto size-16" aria-hidden="true">
          <path d="M8 20h34l10 10v26H8z" fill="var(--st-surface-3)" />
          <path d="M42 20v10h10" fill="var(--st-surface-2)" />
          <path d="M18 40h20M18 48h12" stroke="var(--st-accent)" strokeWidth="3" />
        </svg>
        <h3 className="pt-4 text-h2 font-bold text-ink">Nothing needs you</h3>
        <p className="mx-auto max-w-[46ch] pt-2 text-small text-muted">
          Steward is inside every limit you set. It will ask before it is not.
        </p>
      </div>

      {/* error */}
      <Eyebrow>Error</Eyebrow>
      <div className="mx-4 rounded-md bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-h3 font-semibold text-deny">
          <VerdictGlyph tone="deny" className="size-4" />
          Vault unreachable
        </p>
        <p className="max-w-[46ch] pt-2 text-small text-muted">
          Steward could not reach Aave. It retried twice and stopped. Nothing moved.
        </p>
        <div className="pt-4">
          <span className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-small font-bold text-ink">
            Retry
          </span>
        </div>
      </div>

      {/* stale + degraded + frozen */}
      <Eyebrow>Stale, degraded, frozen</Eyebrow>
      <div className="space-y-3 px-4 pb-6">
        <p className="text-small text-muted">
          <Money amount="12,480" minor=".00" token="" usd="$12,480" />{' '}
          <span className="font-mono text-label text-faint">as of 14:02</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusPill state="running" />
          <StatusPill state="idle" />
          <StatusPill state="degraded" />
          <StatusPill state="frozen" />
        </div>
        <p className="rounded-md bg-surface-2 p-3 text-small text-escalate">
          SERV is unreachable. Steward is not proposing. Freeze still works.
        </p>
        <div className="flex items-center justify-between rounded-md bg-surface-2 p-3">
          <span className="text-small text-ink">Aave position could not be exited</span>
          <Chip tone="warn">Parked</Chip>
        </div>
        <div className="space-y-2 pt-2">
          <Button disabled>Approve (frozen)</Button>
          <AllowanceMeter usedPct={78} capPct={78} tone="deny" caption="Daily cap reached" />
        </div>
      </div>
    </>
  );
}

function Recipients() {
  return (
    <>
      <header className="flex h-14 items-center gap-3 px-4">
        <IconBack className="size-6 text-ink" />
        <span className="flex-1 text-h3 font-semibold text-ink">Recipients</span>
        <IconAdd className="size-6 text-ink" />
      </header>
      <div className="px-4">
        <span className="flex h-12 items-center gap-3 rounded-md border border-line px-4 text-muted">
          <IconSearch className="size-5" />
          Search
        </span>
      </div>
      <Eyebrow>Allowlist</Eyebrow>
      {(
        [
          ['MO', 'Mara Okonjo', '0x1d4f 2a99 60b7 c802', '1,200', 'paid Fri'],
          ['DA', 'Devon Achebe', '0x4b2e 88c1 90fa 9f10', '4,000', 'pending'],
          ['TB', 'Tomas Berg', '0x88a0 4c1e 2d55 6b31', '900', 'paid Fri'],
        ] as Array<[string, string, string, string, string]>
      ).map(([init, name, addr, amt, when]) => (
        <div key={addr} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-small font-bold text-ink">
            {init}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-h3 font-semibold text-ink">{name}</span>
            <span className="block truncate font-mono text-mono text-muted">{addr}</span>
          </span>
          <span className="shrink-0 text-right text-small">
            <Money amount={amt} token="" />
            <span className="block font-mono text-label text-faint">{when}</span>
          </span>
        </div>
      ))}
      <div className="h-6" />
    </>
  );
}

/* -------------------------------------------------------------------- page */

function Board() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="pb-8">
        <Wordmark />
        <h1 className="pt-3 text-h1 font-bold tracking-[-0.015em] text-ink">Design preview</h1>
        <p className="max-w-[65ch] pt-2 text-small text-muted">
          Every component in docs/DESIGN.md §9, rendered with mock data. No API, no auth, no wallet
          imports. If a product screen disagrees with this page, this page is right.
        </p>
      </header>

      <div className="flex flex-wrap gap-8">
        <Phone label="S4 Dashboard">
          <Dashboard />
        </Phone>
        <Phone label="S5 Timeline, one row expanded">
          <Timeline />
        </Phone>
        <Phone label="S6 Approval sheet">
          <ApprovalSheet />
        </Phone>
        <Phone label="S9 Freeze modal">
          <FreezeModal />
        </Phone>
        <Phone label="S8 Recipients">
          <Recipients />
        </Phone>
        <Phone label="S8 Add recipient sheet">
          <AddRecipientSheet />
        </Phone>
        <Phone label="S3 Onboarding, step 2">
          <OnboardingStep />
        </Phone>
        <Phone label="S10 Settings">
          <Settings />
        </Phone>
        <Phone label="Global states">
          <StatesColumn />
        </Phone>
      </div>
    </div>
  );
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const { theme } = await searchParams;
  const mode = theme === 'light' ? 'light' : 'dark';
  return (
    <main data-theme={mode} className="min-h-dvh bg-ground">
      <Board />
    </main>
  );
}
