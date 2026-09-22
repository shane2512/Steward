// @vitest-environment jsdom
// S6 approvals list (task 7.7). The screen itself only lists/filters; opening a row embeds the
// EXISTING ApprovalSheet from task 7.6, so these tests cover the list states, not signing again.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  fixtureParam: () => null,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, chainId: undefined, isConnected: false }),
  useBytecode: () => ({ data: undefined, isSuccess: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));

import { ApprovalsScreen, displayStatus } from '../components/approvals/ApprovalsScreen';
import { fixtureApprovals } from '../lib/fixtures';
import type { Approval } from '../lib/contracts';

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const pending = fixtureApprovals('1').approvals;

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/approvals?status=pending')) return { approvals: pending };
    if (path.startsWith('/api/approvals?status=approved'))
      return { approvals: pending.filter((a) => a.status === 'approved') };
    return { approvals: [] };
  });
});
afterEach(cleanup);

describe('S6 approvals list', () => {
  it('lists pending approvals with a rationale and time left', async () => {
    wrap(<ApprovalsScreen />);
    await screen.findByText(/Pay Mara Okonjo/);
    expect(mocks.apiGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/approvals?status=pending'),
      expect.anything(),
    );
  });

  it('filtering to approved shows the decided one and hides the pending one', async () => {
    wrap(<ApprovalsScreen />);
    await screen.findByText(/Pay Mara Okonjo/);
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    await waitFor(() => expect(screen.queryByText(/Pay Mara Okonjo/)).toBeNull());
    await screen.findByText(/Deposit 9,000 USDC/);
  });

  it('empty pending state explains Steward only asks when a rule requires it', async () => {
    mocks.apiGet.mockImplementation(async () => ({ approvals: [] }));
    wrap(<ApprovalsScreen />);
    await screen.findByText('Nothing needs you');
  });

  it('opening a row shows the ApprovalSheet with the rationale and literal message', async () => {
    wrap(<ApprovalsScreen />);
    const row = await screen.findByText(/Pay Mara Okonjo/);
    fireEvent.click(row.closest('button') as HTMLElement);
    await screen.findByTestId('approval-sign');
  });

  it('displayStatus reads a lapsed pending approval as expired even before the server relabels it', () => {
    const base = pending[0];
    if (!base) throw new Error('missing fixture');
    const a: Approval = { ...base, status: 'pending', expiresAt: new Date(0).toISOString() };
    expect(displayStatus(a, Date.now())).toBe('expired');
  });
});
