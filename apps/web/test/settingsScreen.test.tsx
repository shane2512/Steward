// @vitest-environment jsdom
// S10 Settings screen (task 7.7): notifications is disabled ("Coming soon"), verify shows OK or the
// exact failing row, and Unfreeze is the marked extension point for task 7.8.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  fixtureParam: () => null,
}));

import { SettingsScreen } from '../components/settings/SettingsScreen';

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const dashboard = {
  wallet: {
    id: 'w1',
    chainId: 84532,
    treasuryAddress: '0x1',
    agentWalletAddress: '0x2',
    frozen: false,
    breakerOpen: false,
  },
  degraded: false,
  paused: false,
  lastLoopAt: null,
  demoMode: true,
  balances: { treasuryUsdc: '0', agentUsdc: '0' },
  vault: null,
  spendPermission: { status: null, allowanceRemaining: '0', allowance: null, periodSeconds: null },
  maxAtRiskMicroUsd: '0',
  policy: null,
  pendingApprovals: 0,
  obligations: [],
  recent: [],
  security: { blockedCount: 0, lastCheckAt: null },
  parked: null,
  asOf: new Date().toISOString(),
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/dashboard')) return dashboard;
    if (path.startsWith('/api/audit/verify')) return { ok: true, rows: 12, head: '0xhead' };
    throw new Error(`unexpected path ${path}`);
  });
});
afterEach(cleanup);

describe('S10 settings screen', () => {
  it('notifications field is disabled with a Coming soon placeholder', async () => {
    wrap(<SettingsScreen />);
    const input = (await screen.findByLabelText('Telegram chat ID')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Coming soon');
  });

  it('verify audit chain reports the row count on a clean chain', async () => {
    wrap(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify audit chain' }));
    await screen.findByText(/12 rows/);
  });

  it('verify audit chain names the exact failing row on a broken chain', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/dashboard')) return dashboard;
      return {
        ok: false,
        break: { rowId: 7, reason: 'row_hash_mismatch', expected: 'a', actual: 'b' },
      };
    });
    wrap(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify audit chain' }));
    await screen.findByText(/Row 7/);
  });

  it('unfreeze is not offered while the wallet is not frozen', async () => {
    wrap(<SettingsScreen />);
    await screen.findByText('Close account');
    expect(screen.queryByTestId('unfreeze-placeholder')).toBeNull();
  });

  it('shows the unfreeze extension-point slot when frozen', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/dashboard'))
        return { ...dashboard, wallet: { ...dashboard.wallet, frozen: true } };
      return { ok: true, rows: 0, head: '0x' };
    });
    wrap(<SettingsScreen />);
    await screen.findByTestId('unfreeze-placeholder');
  });
});
