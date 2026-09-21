'use client';
// S4 dashboard (docs/DESIGN.md §11 S4), presentational. Every figure arrives already computed by the
// server; this file arranges it. Glass only on the balance card (§8); everything a user must read a
// number off is solid.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { DecisionRow } from '@/components/activity/DecisionRow';
import {
  IconActivity,
  IconAdd,
  IconApprovals,
  IconRecipients,
  IconRefresh,
  IconShield,
  IconVault,
  IconWallet,
  type IconComponent,
} from '@/components/icons';
import { CopyAddress } from '@/components/ui/CopyAddress';
import { Sheet } from '@/components/ui/Sheet';
import {
  AllowanceMeter,
  Balance,
  Chip,
  Eyebrow,
  Money,
  Row,
  TextButton,
  VerdictBadge,
} from '@/components/ui/primitives';
import type { Dashboard } from '@/lib/contracts';
import { allowanceView, clockTime, dueLabel, runwayView, totalManaged } from '@/lib/dashboardModel';
import { formatAgo, formatToken, toBig } from '@/lib/format';
import { isStale } from '@/lib/status';

/* ---------------------------------------------------------------- balance */

export function BalanceCard({
  d,
  updatedAt,
  now,
  onRefresh,
}: {
  d: Dashboard;
  updatedAt: number | undefined;
  now: number;
  onRefresh: () => void;
}) {
  const a = allowanceView(d);
  const stale = isStale(updatedAt, now);
  const apy = d.vault?.apyPct;
  return (
    <div className={`glass rounded-lg p-5 ${d.wallet.frozen ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between">
        <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
          Treasury
        </p>
        {updatedAt !== undefined ? (
          <span className="flex items-center gap-1 font-mono text-label text-faint">
            <span data-testid="as-of">
              {stale ? 'as of ' : 'updated '}
              {clockTime(updatedAt)}
            </span>
            {stale ? (
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Refresh now"
                className="flex size-11 items-center justify-center text-ink"
              >
                <IconRefresh className="size-4" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <p className={`pt-1 ${stale ? 'opacity-70' : ''}`}>
        <Balance base={totalManaged(d)} />
      </p>
      <p className="pt-1.5 text-small text-muted">
        {apy ? (
          <>
            <span className="tabular">{apy}%</span> APY in vaults
          </>
        ) : d.vault ? (
          'Vault rate not reported yet'
        ) : (
          'Nothing earning yet'
        )}
      </p>
      <div className="pt-5">
        {a.kind === 'active' ? (
          <AllowanceMeter usedPct={a.usedPct} capPct={a.capPct} tone={a.tone} caption={a.caption} />
        ) : (
          <p className="font-mono text-label tracking-[0.06em] text-faint uppercase">{a.caption}</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- action row */

function Circle({
  icon: Icon,
  label,
  href,
  onClick,
  badge,
  disabled,
}: {
  icon: IconComponent;
  label: string;
  href?: string;
  onClick?: () => void;
  badge?: number;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span
        className={`relative flex size-[52px] items-center justify-center rounded-full bg-surface-3 ${
          disabled ? 'opacity-50' : ''
        }`}
      >
        <Icon className="size-6 text-ink" />
        {badge ? (
          <span
            aria-label={`${badge} waiting`}
            className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-label font-bold text-on-accent"
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-small font-semibold text-ink">{label}</span>
    </>
  );
  const cls =
    'flex min-h-11 flex-col items-center gap-2 rounded-md py-1 transition-transform duration-150 active:scale-[0.97]';
  if (disabled)
    return (
      <span className={cls} aria-disabled="true">
        {body}
      </span>
    );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function ActionRow({
  pending,
  frozen,
  onAddFunds,
}: {
  pending: number;
  frozen: boolean;
  onAddFunds: () => void;
}) {
  return (
    <div className="px-4 pt-5">
      <div className="grid grid-cols-4 gap-2">
        <Circle
          icon={IconApprovals}
          label="Approvals"
          href="/app/approvals"
          badge={pending}
          disabled={frozen}
        />
        <Circle icon={IconRecipients} label="Recipients" href="/app/recipients" />
        <Circle icon={IconActivity} label="Activity" href="/app/activity" />
        <Circle icon={IconAdd} label="Add funds" onClick={onAddFunds} disabled={frozen} />
      </div>
      {frozen ? (
        <p className="pt-3 text-center text-small text-muted">
          Frozen: approvals and funding are paused until you unfreeze.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- fund treasury sheet */

export function FundSheet({
  open,
  onClose,
  treasuryAddress,
  testnet,
}: {
  open: boolean;
  onClose: () => void;
  treasuryAddress: string;
  testnet: boolean;
}) {
  return (
    <Sheet open={open} title="Fund your treasury" onClose={onClose}>
      <p className="max-w-[46ch] pb-4 text-small text-muted">
        Send USDC to your own treasury address on Base Sepolia. Steward only ever works from what
        you put here, inside the limits you signed.
      </p>
      <CopyAddress address={treasuryAddress} />
      {testnet ? (
        <p className="pt-4 text-small text-muted">
          This is a testnet.{' '}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-info hover:underline"
          >
            Get free test USDC from the Circle faucet
          </a>
          .
        </p>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- stat cards */

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
        {label}
      </p>
      <p className="pt-2 text-h2 font-bold text-ink">{children}</p>
      {sub ? <p className="pt-1 text-small text-muted">{sub}</p> : null}
    </div>
  );
}

export function StatGrid({ d }: { d: Dashboard }) {
  const r = runwayView(d);
  const a = allowanceView(d);
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pt-5">
      <Stat
        label="Working in vaults"
        sub={
          d.vault?.apyPct
            ? `${d.vault.apyPct}% APY`
            : d.vault
              ? 'Rate not reported'
              : 'No vault yet'
        }
      >
        <Money base={toBig(d.vault?.assets)} token={false} />
        <span className="text-small font-semibold text-muted"> USDC</span>
      </Stat>
      <Stat
        label="Allowance left"
        sub={a.kind === 'active' ? `of ${formatToken(a.allowance)} USDC` : 'No permission yet'}
      >
        {a.kind === 'active' ? (
          <>
            <Money base={a.remaining} token={false} />
            <span className="text-small font-semibold text-muted"> USDC</span>
          </>
        ) : (
          'None'
        )}
      </Stat>
      <div className="col-span-2 rounded-md bg-surface-2 p-4" data-testid="runway">
        <div className="flex items-center justify-between">
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
            Liquid runway
          </p>
          {r.covered === null ? null : r.covered ? (
            <VerdictBadge tone="allow" label="Above buffer" />
          ) : (
            <VerdictBadge tone="escalate" label="Below buffer" />
          )}
        </div>
        <p className="pt-2 text-h2 font-bold text-ink">
          <Money base={r.liquid} />
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <div className="h-full rounded-full bg-ink" style={{ width: `${r.fillPct}%` }} />
        </div>
        <p className="pt-2 text-small text-muted">
          {r.buffer !== null ? (
            <>
              Steward keeps at least <Money base={r.buffer} /> liquid.
            </>
          ) : (
            'No runway buffer set yet.'
          )}
        </p>
      </div>
      <div className="col-span-2 rounded-md bg-surface-2 p-4" data-testid="max-at-risk">
        <p className="font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
          Maximum at risk
        </p>
        <p className="pt-2 text-h2 font-bold text-ink">
          <Money base={toBig(d.maxAtRiskMicroUsd)} usd />
        </p>
        <p className="max-w-[46ch] pt-1 text-small text-muted">
          The most Steward could ever reach right now, even if it were fully compromised.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- lists */

export function Positions({ d }: { d: Dashboard }) {
  const treasury = toBig(d.balances.treasuryUsdc);
  const agent = toBig(d.balances.agentUsdc);
  return (
    <>
      <Eyebrow>Positions</Eyebrow>
      {d.vault ? (
        <Row
          icon={IconVault}
          title={d.vault.name}
          sub={d.vault.apyPct ? `${d.vault.apyPct}% APY` : 'Rate not reported'}
          right={<Money base={toBig(d.vault.assets)} usd />}
        />
      ) : null}
      <Row
        icon={IconWallet}
        title="Idle in treasury"
        sub="Not earning"
        right={<Money base={treasury} usd />}
      />
      {agent > 0n ? (
        <Row
          icon={IconShield}
          title="In the agent wallet"
          sub="Working balance"
          right={<Money base={agent} usd />}
        />
      ) : null}
    </>
  );
}

export function NextUp({ d, now }: { d: Dashboard; now: Date }) {
  return (
    <>
      <Eyebrow>Next up</Eyebrow>
      {d.obligations.length === 0 ? (
        <p className="px-4 pb-2 text-small text-muted">Nothing is due in the next 7 days.</p>
      ) : (
        d.obligations.map((o) => (
          <Row
            key={o.id}
            icon={IconRecipients}
            title={o.recipientLabel}
            sub={dueLabel(o.dueDate, now)}
            right={<Money base={toBig(o.amount)} usd />}
          />
        ))
      )}
    </>
  );
}

export function Recent({ d, now }: { d: Dashboard; now: Date }) {
  return (
    <>
      <Eyebrow>Recent</Eyebrow>
      {d.recent.length === 0 ? (
        <p className="px-4 pb-2 text-small text-muted">
          Nothing yet. Steward checks in every few minutes and writes what it decides here.
        </p>
      ) : (
        d.recent.map((item) => (
          <DecisionRow
            key={item.id}
            item={item}
            variant="compact"
            now={now}
            href={`/app/activity?open=${item.id}`}
          />
        ))
      )}
      <div className="px-4 pt-2 text-right">
        <Link
          href="/app/activity"
          className="inline-flex min-h-11 items-center text-small font-semibold text-accent-ink hover:underline"
        >
          View all activity
        </Link>
      </div>
    </>
  );
}

export function SecurityWidget({ d, now }: { d: Dashboard; now: Date }) {
  const n = d.security.blockedCount;
  return (
    <>
      <Eyebrow>Security</Eyebrow>
      <Row
        icon={IconShield}
        title={n === 1 ? '1 action blocked' : `${n} actions blocked`}
        sub={
          d.security.lastCheckAt
            ? `Last check ${formatAgo(d.security.lastCheckAt, now)}`
            : 'No check has run yet'
        }
        right={
          <Link href="/app/activity" className="text-small font-semibold text-accent-ink">
            See why
          </Link>
        }
      />
    </>
  );
}

/** RR-14: a stuck obligation parks the whole wallet. Shown, never hidden. */
export function ParkedNotice({ d, now }: { d: Dashboard; now: Date }) {
  if (!d.parked) return null;
  return (
    <div className="mx-4 mt-4 rounded-md bg-surface-2 p-4" role="status" data-testid="parked">
      <div className="flex items-center justify-between gap-3">
        <p className="text-h3 font-semibold text-ink">Steward is holding</p>
        <Chip tone="warn">Parked</Chip>
      </div>
      <p className="max-w-[46ch] pt-2 text-small text-muted">{d.parked.reason}</p>
      <p className="pt-2 font-mono text-label text-faint">since {formatAgo(d.parked.since, now)}</p>
    </div>
  );
}

export function DashboardView({
  d,
  updatedAt,
  nowMs,
  onRefresh,
}: {
  d: Dashboard;
  updatedAt: number | undefined;
  nowMs: number;
  onRefresh: () => void;
}) {
  const [fundOpen, setFundOpen] = useState(false);
  const now = new Date(nowMs);
  return (
    <>
      <div className="px-4 pt-4">
        <BalanceCard d={d} updatedAt={updatedAt} now={nowMs} onRefresh={onRefresh} />
      </div>
      <ActionRow
        pending={d.pendingApprovals}
        frozen={d.wallet.frozen}
        onAddFunds={() => setFundOpen(true)}
      />
      <ParkedNotice d={d} now={now} />
      <StatGrid d={d} />
      <Positions d={d} />
      <NextUp d={d} now={now} />
      <Recent d={d} now={now} />
      <SecurityWidget d={d} now={now} />
      <div className="px-4 pt-4 pb-2 text-center">
        <TextButton onClick={onRefresh}>
          <IconRefresh className="size-4" /> Refresh
        </TextButton>
      </div>
      <FundSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        treasuryAddress={d.wallet.treasuryAddress}
        testnet={d.wallet.chainId === 84532}
      />
    </>
  );
}
