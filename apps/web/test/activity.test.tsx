// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionDetailView, sortChecks } from '../components/activity/DecisionDetail';
import { applyFilter } from '../components/activity/ActivityScreen';
import { ApiError } from '../lib/api';
import { fixtureDecisionDetail, fixtureDecisions } from '../lib/fixtures';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  fixtureParam: () => null,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { ActivityScreen } from '../components/activity/ActivityScreen';

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const page1 = fixtureDecisions('1');
const page2 = fixtureDecisions('1', 'cursor');

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/config'))
      return { demoMode: true, chainId: 84532, explorerBase: 'https://sepolia.basescan.org' };
    if (path.startsWith('/api/decisions?')) return path.includes('cursor=') ? page2 : page1;
    const id = /\/api\/decisions\/([^?]+)/.exec(path)?.[1];
    const d = id ? fixtureDecisionDetail(decodeURIComponent(id)) : null;
    if (d) return d;
    throw new ApiError(404, 'not_found', 'nope');
  });
});
afterEach(cleanup);

describe('timeline list', () => {
  it('each row: title, verdict glyph + word, one-line explanation, amount rule, time', async () => {
    wrap(<ActivityScreen />);
    const row = (await screen.findByText('Pay Mara Okonjo')).closest('button') as HTMLElement;
    expect(within(row).getByText('Allowed')).toBeTruthy();
    expect(within(row).getByText('Allowed. All 6 checks passed.')).toBeTruthy();
    expect(row.textContent).toContain('1,200 USDC ($1,200)');
    expect(row.querySelector('svg')).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('filters by verdict without losing the list', async () => {
    wrap(<ActivityScreen />);
    await screen.findByText('Pay Mara Okonjo');
    fireEvent.click(screen.getByRole('button', { name: 'Denied' }));
    expect(screen.queryByText('Pay Mara Okonjo')).toBeNull();
    expect(screen.getByText('Pay an unlisted recipient')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Pay Mara Okonjo')).toBeTruthy();
  });

  it('applyFilter is exact on the verdict', () => {
    const all = page1.decisions;
    expect(applyFilter(all, 'all')).toHaveLength(all.length);
    expect(applyFilter(all, 'ESCALATE').every((i) => i.verdict?.decision === 'ESCALATE')).toBe(true);
  });

  it('paginates by cursor: "Load older activity" appends the next page and then goes away', async () => {
    wrap(<ActivityScreen />);
    await screen.findByText('Pay Mara Okonjo');
    expect(screen.queryByText('Withdraw from Aave USDC')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
    await screen.findByText('Withdraw from Aave USDC');
    expect(screen.getByText('Pay Mara Okonjo')).toBeTruthy(); // page 1 is kept
    const cursorCall = mocks.apiGet.mock.calls.find((c) => String(c[0]).includes('cursor='));
    expect(cursorCall?.[0]).toMatch(/cursor=[^&]+/);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull());
  });

  it('empty and error states use plain language', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/config')) return { demoMode: false, chainId: 84532, explorerBase: 'x' };
      return { decisions: [], nextCursor: null };
    });
    wrap(<ActivityScreen />);
    await screen.findByText('No activity yet');
    cleanup();
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/config')) return { demoMode: false, chainId: 84532, explorerBase: 'x' };
      throw new ApiError(500, 'error', 'x');
    });
    wrap(<ActivityScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Nothing moved/);
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('expanding a decision', () => {
  it('loads the detail and shows the six tabs; policy checks first', async () => {
    wrap(<ActivityScreen />);
    fireEvent.click((await screen.findByText('Pay Mara Okonjo')).closest('button') as HTMLElement);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Context',
      'Proposal',
      'Verifier',
      'Policy checks',
      'Simulation',
      'Transaction',
    ]);
    expect(screen.getByRole('tab', { name: 'Policy checks' }).getAttribute('aria-selected')).toBe('true');
    expect(mocks.apiGet.mock.calls.some((c) => c[0] === '/api/decisions/fx-1')).toBe(true);
  });

  it('a second click collapses it', async () => {
    wrap(<ActivityScreen />);
    const btn = (await screen.findByText('Pay Mara Okonjo')).closest('button') as HTMLElement;
    fireEvent.click(btn);
    await screen.findAllByRole('tab');
    fireEvent.click(btn);
    expect(screen.queryByRole('tab', { name: 'Context' })).toBeNull();
  });
});

describe('DecisionDetailView', () => {
  const EXPLORER = 'https://sepolia.basescan.org';
  const denied = fixtureDecisionDetail('fx-3')!;
  const allowed = fixtureDecisionDetail('fx-1')!;

  it('policy checks: every rule code with a mark AND a word, blocked first, sentence from the table', () => {
    render(<DecisionDetailView detail={denied} explorerBase={EXPLORER} />);
    const list = screen.getByTestId('policy-checks');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('R-05');
    expect(items[0]?.textContent).toContain('Blocked');
    expect(items[0]?.textContent).toContain('The recipient is on your allowlist, matched by exact address.');
    expect(items.at(-1)?.textContent).toContain('Passed');
    for (const li of items) expect(li.querySelector('svg')).toBeTruthy();
  });

  it('a denied decision has a "Why was this blocked?" section and says nothing moved', () => {
    render(<DecisionDetailView detail={denied} explorerBase={EXPLORER} />);
    const why = screen.getByRole('heading', { name: 'Why was this blocked?' }).closest('section')!;
    expect(why.textContent).toMatch(/Nothing moved/);
    cleanup();
    render(<DecisionDetailView detail={allowed} explorerBase={EXPLORER} />);
    expect(screen.queryByText('Why was this blocked?')).toBeNull();
  });

  it('sortChecks puts failures before passes and keeps order otherwise', () => {
    const s = sortChecks(denied.verdict!.checks);
    expect(s.map((c) => c.result)).toEqual(['DENY', 'DENY', 'PASS']);
  });

  it('every tab renders plain text, never raw JSON', () => {
    render(<DecisionDetailView detail={allowed} explorerBase={EXPLORER} />);
    for (const name of ['Context', 'Proposal', 'Verifier', 'Policy checks', 'Simulation', 'Transaction']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      const text = screen.getByRole('tabpanel').textContent ?? '';
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/[{}[\]]{2,}|"\w+":/);
    }
  });

  it('simulation deltas and the proposal sentence use the money rule', () => {
    render(<DecisionDetailView detail={allowed} explorerBase={EXPLORER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Proposal' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('1,200 USDC ($1,200)');
    fireEvent.click(screen.getByRole('tab', { name: 'Simulation' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('-1200 USDC');
  });

  it('transaction tab links to Basescan Sepolia; a denied decision says no transaction was sent', () => {
    render(<DecisionDetailView detail={allowed} explorerBase={EXPLORER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Transaction' }));
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(`${EXPLORER}/tx/${allowed.execution?.txHash}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    cleanup();
    render(<DecisionDetailView detail={denied} explorerBase={EXPLORER} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Transaction' }));
    expect(screen.getByRole('tabpanel').textContent).toMatch(/No transaction was sent. Nothing moved./);
  });

  it('tabs are keyboard operable: arrows move and select, roving tabindex', () => {
    render(<DecisionDetailView detail={allowed} explorerBase={EXPLORER} />);
    const active = screen.getByRole('tab', { name: 'Policy checks' });
    active.focus();
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Simulation' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Simulation' }));
    expect(screen.getByRole('tab', { name: 'Context' }).getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Context' }).getAttribute('aria-selected')).toBe('true');
  });
});
