// @vitest-environment jsdom
// S10 Settings screen (task 7.7, extended 8.5): the Telegram chat id field, verify shows OK or the
// exact failing row, and Unfreeze (7.8) is offered only while the wallet is frozen.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  fixtureParam: () => null,
}));

// 7.8: UnfreezeSlot signs a server-issued message, so the screen now pulls in wagmi. Its own
// behaviour is covered by the signing tests; here it only has to mount.
vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: false }),
  useBytecode: () => ({ data: undefined, isSuccess: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
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

const me = {
  user: { id: 'u1', address: '0x1', displayName: null, telegramChatId: null as string | null },
  wallet: { id: 'w1', chainId: 84532, agentWalletAddress: '0x2', frozen: false },
};
const configOn = { demoMode: true, chainId: 84532, explorerBase: 'x', telegramEnabled: true };

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/dashboard')) return dashboard;
    if (path.startsWith('/api/me')) return me;
    if (path.startsWith('/api/config')) return configOn;
    if (path.startsWith('/api/audit/verify')) return { ok: true, rows: 12, head: '0xhead' };
    throw new Error(`unexpected path ${path}`);
  });
  mocks.apiPost.mockImplementation(async (path: string, _schema: unknown, body: unknown) => {
    if (path === '/api/me/telegram') return body;
    throw new Error(`unexpected post ${path}`);
  });
});
afterEach(cleanup);

describe('S10 settings screen', () => {
  it('offers a real Telegram chat id field with a Save button when Telegram is configured', async () => {
    wrap(<SettingsScreen />);
    const input = (await screen.findByLabelText('Telegram chat ID')) as HTMLInputElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: '999' } });
    await screen.findByDisplayValue('999');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(mocks.apiPost).toHaveBeenCalledWith('/api/me/telegram', expect.anything(), {
      chatId: '999',
    });
  });

  it('explains Telegram is unavailable instead of showing the field when it is not configured', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/dashboard')) return dashboard;
      if (path.startsWith('/api/me')) return me;
      if (path.startsWith('/api/config')) return { ...configOn, telegramEnabled: false };
      if (path.startsWith('/api/audit/verify')) return { ok: true, rows: 12, head: '0xhead' };
      throw new Error(`unexpected path ${path}`);
    });
    wrap(<SettingsScreen />);
    await screen.findByText(/not configured on this deployment/);
    expect(screen.queryByLabelText('Telegram chat ID')).toBeNull();
  });

  it('verify audit chain reports the row count on a clean chain', async () => {
    wrap(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify audit chain' }));
    await screen.findByText(/12 rows/);
  });

  it('verify audit chain names the exact failing row on a broken chain', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/dashboard')) return dashboard;
      if (path.startsWith('/api/me')) return me;
      if (path.startsWith('/api/config')) return configOn;
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
    expect(screen.queryByTestId('unfreeze')).toBeNull();
  });

  it('offers unfreeze only when frozen', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/dashboard'))
        return { ...dashboard, wallet: { ...dashboard.wallet, frozen: true } };
      if (path.startsWith('/api/me')) return me;
      if (path.startsWith('/api/config')) return configOn;
      return { ok: true, rows: 0, head: '0x' };
    });
    wrap(<SettingsScreen />);
    await screen.findByTestId('unfreeze');
  });
});
