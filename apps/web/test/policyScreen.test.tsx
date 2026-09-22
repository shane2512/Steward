// @vitest-environment jsdom
// S7 Policy screen (task 7.7): sentences view is the default, JSON is an explicit secondary toggle,
// and "Edit mandate" hands off to the existing MandateStep + PolicySign (not rebuilt here).
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
vi.mock('wagmi', () => ({
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useAccount: () => ({ address: undefined, chainId: undefined, isConnected: false }),
  useBytecode: () => ({ data: undefined, isSuccess: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));

import { PolicyScreen } from '../components/policy/PolicyScreen';
import { fixturePolicyView } from '../lib/fixtures';

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const view = fixturePolicyView('1');

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/policy')) return view;
    if (path.startsWith('/api/onboarding'))
      return {
        step: 'done',
        agentWalletAddress: null,
        mandate: null,
        spendPermissionStatus: null,
        activePolicyVersion: 3,
      };
    throw new Error(`unexpected path ${path}`);
  });
});
afterEach(cleanup);

describe('S7 policy screen', () => {
  it('shows numbered sentences by default, not raw JSON', async () => {
    wrap(<PolicyScreen />);
    await screen.findByTestId('policy-sentences-view');
    expect(screen.queryByTestId('policy-json-view')).toBeNull();
    expect(screen.getByText(view.sentences[0] as string)).toBeTruthy();
  });

  it('toggling to JSON shows the raw body, labelled as reference-only', async () => {
    wrap(<PolicyScreen />);
    await screen.findByTestId('policy-sentences-view');
    fireEvent.click(screen.getByRole('button', { name: 'JSON (reference)' }));
    await screen.findByTestId('policy-json-view');
    expect(screen.getByText(/for reference only/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(String(view.version)))).toBeTruthy();
  });

  it('Edit mandate opens the existing MandateStep compile flow', async () => {
    wrap(<PolicyScreen />);
    await screen.findByTestId('policy-sentences-view');
    fireEvent.click(screen.getByRole('button', { name: 'Edit mandate' }));
    await screen.findByText(/What should Steward do with idle USDC/);
  });
});
