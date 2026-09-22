// @vitest-environment jsdom
// S8 Recipients screen (task 7.7). Add/validate/sign lives in the existing AddRecipientSign; this
// covers the list, empty state, and the needsPolicySignature -> PolicySign hand-off from the 7.6
// note ("adding a recipient inserts the row but does not activate a policy... the add response says
// so via needsPolicySignature").
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

import { RecipientsScreen } from '../components/recipients/RecipientsScreen';
import { fixtureRecipients } from '../lib/fixtures';

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const list = fixtureRecipients('1');

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/recipients')) return list;
    throw new Error(`unexpected path ${path}`);
  });
});
afterEach(cleanup);

describe('S8 recipients screen', () => {
  it('lists recipients with their per-payment cap', async () => {
    wrap(<RecipientsScreen />);
    await screen.findByText('Mara Okonjo');
    expect(screen.getByText(/Up to 1,200 USDC \(\$1,200\) per payment/)).toBeTruthy();
  });

  it('empty state explains exact-match addressing', async () => {
    mocks.apiGet.mockImplementation(async () => ({ recipients: [] }));
    wrap(<RecipientsScreen />);
    await screen.findByText('No recipients yet');
  });

  it('Add recipient opens the existing AddRecipientSign form', async () => {
    wrap(<RecipientsScreen />);
    await screen.findByText('Mara Okonjo');
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await screen.findByTestId('add-recipient-sign');
  });

  it('a needsPolicySignature response routes straight into PolicySign', async () => {
    mocks.apiPost.mockImplementation(async (path: string) => {
      if (path === '/api/recipients/prepare')
        return { message: 'Steward recipient\nAddress: 0xabc\nNonce: n1', address: '0xabc', expiresAt: new Date(Date.now() + 300_000).toISOString() };
      if (path === '/api/recipients')
        return {
          recipient: { id: 'r-new', label: 'New Payee', address: '0xabc', maxPerTx: '1000000', scheduleDayOfMonth: null, status: 'active' },
          needsPolicySignature: true,
        };
      if (path === '/api/policy/prepare')
        return { version: 4, bodyHash: '0xdead', message: 'Steward policy v4 0xdead', sentences: ['A rule'], diff: { added: ['A rule'], removed: [], previousVersion: 3 } };
      throw new Error(`unexpected post ${path}`);
    });

    wrap(<RecipientsScreen />);
    await screen.findByText('Mara Okonjo');
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await screen.findByTestId('add-recipient-sign');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Payee' } });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: '0x0000000000000000000000000000000000000abc' },
    });
    fireEvent.change(screen.getByLabelText('Most per payment'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check this address' }));
    await screen.findByTestId('recipient-confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Sign and add recipient' }));

    await screen.findByText(/One more step/);
    await screen.findByTestId('policy-sign');
  });
});
