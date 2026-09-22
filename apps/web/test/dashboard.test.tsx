// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DecisionRow } from '../components/activity/DecisionRow';
import { DashboardView } from '../components/dashboard/DashboardView';
import {
  AllowanceMeter,
  Balance,
  meterTone,
  Money,
  VerdictBadge,
} from '../components/ui/primitives';
import type { Dashboard, DecisionItem } from '../lib/contracts';
import { allowanceView, dueLabel, runwayView, totalManaged } from '../lib/dashboardModel';
import { fixtureDashboard, fixtureDecisions } from '../lib/fixtures';

afterEach(cleanup);
const NOW = Date.now();
const U = (n: number) => (BigInt(n) * 1_000_000n).toString();
const dash = (over: Partial<Dashboard> = {}): Dashboard => ({ ...fixtureDashboard('1'), ...over });

describe('AllowanceMeter: the limit line', () => {
  it('draws the rule at the cap, beyond the fill, and recesses what is past it', () => {
    render(<AllowanceMeter usedPct={24} capPct={78} caption="2,400 USDC of 10,000 used today" />);
    const fill = screen.getByTestId('meter-fill');
    const line = screen.getByTestId('limit-line');
    const beyond = screen.getByTestId('meter-beyond');
    expect(fill.style.width).toBe('24%');
    expect(line.style.left).toBe('78%'); // the line is to the RIGHT of the fill
    expect(beyond.style.width).toBe('22%'); // 100 - cap: money Steward can never touch
    expect(Number.parseFloat(line.style.left)).toBeGreaterThan(Number.parseFloat(fill.style.width));
    expect(screen.getByText('2,400 USDC of 10,000 used today')).toBeTruthy();
  });

  it('never lets the fill cross the limit line', () => {
    render(<AllowanceMeter usedPct={95} capPct={40} caption="x" />);
    expect(screen.getByTestId('meter-fill').style.width).toBe('40%');
  });

  it('fill turns amber near the cap and red at it; the caption stays as text', () => {
    expect(meterTone(50n, 100n)).toBe('accent');
    expect(meterTone(80n, 100n)).toBe('escalate');
    expect(meterTone(100n, 100n)).toBe('deny');
    expect(meterTone(1n, 0n)).toBe('deny');
    const { container } = render(
      <AllowanceMeter usedPct={100} capPct={100} tone="deny" caption="Daily cap reached" />,
    );
    expect(container.querySelector('[data-tone="deny"]')).toBeTruthy();
    expect(screen.getByText('Daily cap reached')).toBeTruthy();
  });
});

describe('allowanceView (bigint maths behind the meter)', () => {
  it('2,400 used of 10,000 with 7,600 left', () => {
    const v = allowanceView(dash());
    expect(v.kind).toBe('active');
    if (v.kind !== 'active') return;
    expect(v.used).toBe(2_400_000_000n);
    expect(v.caption).toBe('2,400 USDC of 10,000 used today');
    expect(v.tone).toBe('accent');
    expect(v.capPct).toBeLessThan(100); // 10,000 cap on 12,480 managed: money beyond the line exists
    expect(v.usedPct).toBeLessThan(v.capPct);
  });
  it('says the cap is reached in words when it is', () => {
    const v = allowanceView(
      dash({
        spendPermission: {
          status: 'approved_onchain',
          allowance: U(10000),
          allowanceRemaining: '0',
          periodSeconds: 86_400,
        },
      }),
    );
    expect(v.kind === 'active' && v.tone).toBe('deny');
    expect(v.kind === 'active' && v.caption).toMatch(/Daily cap reached/);
  });
  it('no permission yet is stated, not drawn', () => {
    const v = allowanceView(
      dash({
        spendPermission: {
          status: null,
          allowance: null,
          allowanceRemaining: '0',
          periodSeconds: null,
        },
      }),
    );
    expect(v).toEqual({ kind: 'none', caption: 'No spend permission yet' });
  });
  it('runway compares liquid funds with the buffer', () => {
    expect(runwayView(dash()).covered).toBe(true);
    const low = runwayView(dash({ balances: { treasuryUsdc: U(100), agentUsdc: '0' } }));
    expect(low.covered).toBe(false);
    expect(runwayView(dash({ policy: null })).covered).toBeNull();
  });
  it('total managed adds treasury, agent wallet and vault', () =>
    expect(totalManaged(dash())).toBe(BigInt(U(4380)) + BigInt(U(8100))));
  it('dueLabel', () => {
    const today = new Date(2026, 8, 22);
    expect(dueLabel('2026-09-22', today)).toBe('Due today');
    expect(dueLabel('2026-09-23', today)).toBe('Tomorrow');
    expect(dueLabel('2026-09-27', today)).toBe('In 5 days');
  });
});

describe('Balance and Money', () => {
  it('dims the minor units and reads out as one number', () => {
    const { container } = render(<Balance base={12_480_000_000n} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('$12,480.00');
    expect(container.querySelector('.text-minor')?.textContent).toBe('.00');
    // `aria-label` is not a permitted attribute on a role-less `span` (axe: aria-prohibited-attr),
    // so the accessible name is a visually-hidden text node instead (task 7.9/7.10 a11y audit).
    expect(container.querySelector('.sr-only')?.textContent).toBe('12,480.00 dollars');
  });
  it('Money follows the rule and never loses precision', () => {
    const { container } = render(<Money base={9_007_199_254_740_993_000_000n} usd />);
    expect(container.textContent).toBe('9,007,199,254,740,993 USDC ($9,007,199,254,740,993)');
  });
});

describe('DecisionRow: the verdict is never colour alone', () => {
  const items = fixtureDecisions('1').decisions;
  const byVerdict = (v: string) => items.find((i) => i.verdict?.decision === v) as DecisionItem;

  it('every verdict renders a glyph AND a visible word', () => {
    for (const [v, word] of [
      ['ALLOW', 'Allowed'],
      ['ESCALATE', 'Needs you'],
      ['DENY', 'Denied'],
    ] as const) {
      const { container, unmount } = render(<DecisionRow item={byVerdict(v)} variant="compact" />);
      expect(screen.getByText(word)).toBeTruthy(); // the word is real text, not a title attribute
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });

  it('the three verdicts use three different glyph shapes (greyscale-distinguishable)', () => {
    const shapes = ['allow', 'escalate', 'deny'].map((t) => {
      const { container, unmount } = render(<VerdictBadge tone={t as 'allow'} />);
      const s = container.innerHTML.replace(/class="[^"]*"/g, '');
      unmount();
      return s;
    });
    expect(new Set(shapes).size).toBe(3);
  });

  it('a decision that never reached the engine says so in words', () => {
    render(<DecisionRow item={{ ...byVerdict('ALLOW'), verdict: null }} variant="compact" />);
    expect(screen.getByText('No action taken')).toBeTruthy();
  });

  it('full variant shows the one-line explanation and a money-rule amount', () => {
    render(<DecisionRow item={byVerdict('ALLOW')} variant="full" />);
    expect(screen.getByText('Allowed. All 6 checks passed.')).toBeTruthy();
    expect(screen.getByText(/1,200 USDC/).textContent).toContain('($1,200)');
  });

  it('compact denied rows show the rule that blocked them', () => {
    render(<DecisionRow item={byVerdict('DENY')} variant="compact" />);
    expect(screen.getByText(/R-05 R-16/)).toBeTruthy();
  });
});

describe('DashboardView', () => {
  const renderView = (d: Dashboard, updatedAt: number | undefined = NOW) =>
    render(<DashboardView d={d} updatedAt={updatedAt} nowMs={NOW} onRefresh={() => {}} />);

  it('shows every card from the spec', () => {
    renderView(dash());
    expect(screen.getByText('Treasury')).toBeTruthy();
    expect(screen.getByText('Working in vaults')).toBeTruthy();
    expect(screen.getByText('Allowance left')).toBeTruthy();
    expect(screen.getByText('Liquid runway')).toBeTruthy();
    expect(screen.getByText('Maximum at risk')).toBeTruthy();
    expect(screen.getByText('Next up')).toBeTruthy();
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
    expect(screen.getByText('3 actions blocked')).toBeTruthy();
    expect(within(screen.getByTestId('max-at-risk')).getByText(/15,700 USDC/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View all activity' }).getAttribute('href')).toBe(
      '/app/activity',
    );
  });

  it('parked (RR-14) is surfaced clearly with its reason', () => {
    renderView(
      dash({
        parked: {
          reason: 'A payment is due but Steward has no way to fund it.',
          since: new Date(NOW - 600_000).toISOString(),
        },
      }),
    );
    const p = screen.getByTestId('parked');
    expect(p.textContent).toMatch(/Parked/);
    expect(p.textContent).toMatch(/no way to fund it/);
    cleanup();
    renderView(dash({ parked: null }));
    expect(screen.queryByTestId('parked')).toBeNull();
  });

  it('stale data stays visible with an "as of" time and a Refresh control', () => {
    renderView(dash(), NOW - 120_000);
    expect(screen.getByTestId('as-of').textContent).toMatch(/^as of \d\d:\d\d$/);
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeTruthy();
    expect(screen.getByText('Treasury')).toBeTruthy(); // never blanked
  });

  it('fresh data says "updated" and offers no urgent refresh', () => {
    renderView(dash(), NOW - 2_000);
    expect(screen.getByTestId('as-of').textContent).toMatch(/^updated /);
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
  });

  it('frozen: approvals and funding are disabled with the reason inline, activity stays reachable', () => {
    renderView(dash({ wallet: { ...dash().wallet, frozen: true } }));
    expect(screen.getByText(/Frozen: approvals and funding are paused/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Approvals/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add funds/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Activity/ })).toBeTruthy();
  });

  it('pending approvals badge on the Approvals action', () => {
    renderView(dash({ pendingApprovals: 2 }));
    expect(screen.getByLabelText('2 waiting')).toBeTruthy();
  });

  it('empty states are plain language', () => {
    renderView(
      dash({ recent: [], obligations: [], security: { blockedCount: 0, lastCheckAt: null } }),
    );
    expect(screen.getByText(/Nothing is due in the next 7 days/)).toBeTruthy();
    expect(screen.getByText(/Steward checks in every few minutes/)).toBeTruthy();
    expect(screen.getByText('0 actions blocked')).toBeTruthy();
    expect(screen.getByText('No check has run yet')).toBeTruthy();
  });

  it('Add funds opens the fund sheet with the full treasury address and a testnet faucet', () => {
    const d = dash();
    renderView(d);
    fireEvent.click(screen.getByRole('button', { name: /Add funds/ }));
    const dialog = screen.getByRole('dialog', { name: 'Fund your treasury' });
    expect(dialog.textContent).toContain('0x 1d4f 2a99');
    expect(
      within(dialog)
        .getByRole('link', { name: /Circle faucet/ })
        .getAttribute('href'),
    ).toBe('https://faucet.circle.com');
  });
});
