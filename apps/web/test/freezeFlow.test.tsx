// @vitest-environment jsdom
// Task 7.8 — the S9 freeze flow.
//
// The assertions that matter here: the flow RESUMES from what the server says (never from its own
// memory), every action RE-READS that state before doing anything (so a retry cannot be a blind
// repeat), and the header's Freeze control stays reachable once the wallet is frozen — an owner who
// froze and closed the modal still has two steps to finish.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  signMessageAsync: vi.fn(),
  sendTransactionAsync: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C',
    chainId: 84532,
    connector: { id: 'coinbaseWalletSDK' },
    isConnected: true,
  }),
  useBytecode: () => ({ data: '0x60006000', isSuccess: true }),
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false }),
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransactionAsync }),
}));

import { FreezeFlow, stepStates } from '../components/freeze/FreezeFlow';
import { FreezeButton } from '../components/shell/AppHeader';
import type { OwnerPath } from '../lib/contracts';

const MANAGER = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad';
const REVOKE_DATA = `0x${'cd'.repeat(80)}`;
const FREEZE_MESSAGE = 'Steward freeze\nWallet: w1\nNonce: abc\nExpires: 2026-01-01T00:00:00.000Z';

const status = (over: Partial<OwnerPath> = {}): OwnerPath => ({
  frozen: false,
  frozenAt: null,
  frozenReason: null,
  revoke: { state: 'none' },
  sweep: { state: 'none' },
  ...over,
});

const todoRevoke = { state: 'todo', to: MANAGER, data: REVOKE_DATA, permissionId: 'p1' } as const;

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.signMessageAsync.mockReset();
  mocks.sendTransactionAsync.mockReset();
});
afterEach(cleanup);

const flow = (over: Partial<OwnerPath> = {}) => {
  mocks.apiGet.mockResolvedValue(status(over));
  return render(
    <FreezeFlow frozen={over.frozen ?? false} onDone={() => {}} onClose={() => {}} pollMs={1} />,
  );
};

describe('stepStates', () => {
  it('starts on step 1 when nothing has happened', () => {
    expect(stepStates(status())).toEqual(['active', 'done', 'todo']);
  });

  it('opens on step 2 when the wallet is already frozen and the permission is live', () => {
    expect(stepStates(status({ frozen: true, revoke: todoRevoke }))).toEqual([
      'done',
      'active',
      'todo',
    ]);
  });

  it('treats "no permission to revoke" as a finished step, not a skipped one', () => {
    expect(stepStates(status({ frozen: true }))).toEqual(['done', 'done', 'active']);
  });

  it('shows a sweep in flight as busy and a confirmed one as done', () => {
    expect(stepStates(status({ frozen: true, sweep: { state: 'submitted' } }))[2]).toBe('busy');
    expect(stepStates(status({ frozen: true, sweep: { state: 'confirmed' } }))[2]).toBe('done');
    expect(stepStates(status({ frozen: true, sweep: { state: 'failed' } }))[2]).toBe('failed');
  });
});

describe('resuming', () => {
  it('opens on step 2 when the server says the wallet is already frozen', async () => {
    flow({ frozen: true, revoke: todoRevoke });
    await waitFor(() => expect(screen.getByTestId('freeze-step-1').dataset['state']).toBe('done'));
    expect(screen.getByTestId('freeze-stopped').textContent).toContain('Steward is stopped');
    expect(screen.getByTestId('freeze-step-2').dataset['state']).toBe('active');
    expect((screen.getByTestId('revoke-now') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not trust the frozen prop once the server has answered', async () => {
    // The dashboard poll said frozen; the server says otherwise. The server wins.
    mocks.apiGet.mockResolvedValue(status({ frozen: false }));
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('freeze-step-1').dataset['state']).toBe('active'),
    );
  });

  it('keeps revoke and sweep out of reach until the wallet is actually stopped', async () => {
    flow({ revoke: todoRevoke });
    await waitFor(() =>
      expect((screen.getByTestId('freeze-now') as HTMLButtonElement).disabled).toBe(false),
    );
    expect((screen.getByTestId('revoke-now') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('sweep-now') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('step 1 — freeze', () => {
  it('signs exactly the message the server issued, then submits it', async () => {
    mocks.apiGet.mockResolvedValue(status());
    mocks.apiPost.mockImplementation((path: string) =>
      path === '/api/freeze/prepare'
        ? Promise.resolve({ message: FREEZE_MESSAGE, expiresAt: '2026-01-01T00:00:00.000Z' })
        : Promise.resolve({
            ...status({ frozen: true }),
            alreadyFrozen: false,
            cancelledApprovals: 1,
          }),
    );
    mocks.signMessageAsync.mockResolvedValue('0xsig');
    render(<FreezeFlow frozen={false} onDone={() => {}} onClose={() => {}} pollMs={1} />);

    fireEvent.click(await screen.findByTestId('freeze-now'));
    await waitFor(() =>
      expect(screen.getByTestId('literal-payload').textContent).toContain('Steward freeze'),
    );
    fireEvent.click(screen.getByTestId('freeze-now'));

    await waitFor(() =>
      expect(mocks.signMessageAsync).toHaveBeenCalledWith({ message: FREEZE_MESSAGE }),
    );
    expect(mocks.apiPost).toHaveBeenCalledWith('/api/freeze', expect.anything(), {
      signature: '0xsig',
    });
    await waitFor(() =>
      expect(screen.getByTestId('freeze-stopped').textContent).toContain('stopped'),
    );
  });

  it('does not ask for a signature when the wallet is already frozen', async () => {
    // The status is re-read inside `prepare`, so a stale "not frozen" view cannot cause a pointless
    // wallet prompt.
    mocks.apiGet.mockResolvedValueOnce(status()).mockResolvedValue(status({ frozen: true }));
    render(<FreezeFlow frozen={false} onDone={() => {}} onClose={() => {}} pollMs={1} />);
    fireEvent.click(await screen.findByTestId('freeze-now'));
    // The re-read finds it already frozen, so step 1 simply completes: no wallet prompt, no POST.
    await waitFor(() => expect(screen.getByTestId('freeze-step-1').dataset['state']).toBe('done'));
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });
});

describe('step 2 — revoke', () => {
  it('sends the calldata the server gave it and waits for the server to see it on-chain', async () => {
    mocks.apiGet.mockResolvedValue(status({ frozen: true, revoke: todoRevoke }));
    mocks.sendTransactionAsync.mockResolvedValue('0xtx');
    mocks.apiPost.mockResolvedValue({ revoked: true, alreadyRevoked: false });
    flow({ frozen: true, revoke: todoRevoke });

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() =>
      expect(mocks.sendTransactionAsync).toHaveBeenCalledWith({ to: MANAGER, data: REVOKE_DATA }),
    );
    expect(mocks.apiPost).toHaveBeenCalledWith('/api/spend-permission/revoked', expect.anything(), {
      txHash: '0xtx',
    });
  });

  it('re-checks before retrying: an already-revoked permission sends nothing', async () => {
    // First read (on open) says there is something to revoke; by the time the owner clicks, another
    // tab has done it. No transaction should be requested.
    mocks.apiGet
      .mockResolvedValueOnce(status({ frozen: true, revoke: todoRevoke }))
      .mockResolvedValue(status({ frozen: true, revoke: { state: 'revoked', at: null } }));
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() => expect(screen.getByTestId('freeze-step-2').dataset['state']).toBe('done'));
    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
  });

  it('explains a failure and offers a retry instead of leaving the step silent', async () => {
    mocks.apiGet.mockResolvedValue(status({ frozen: true, revoke: todoRevoke }));
    mocks.sendTransactionAsync.mockRejectedValue(new Error('user rejected'));
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() =>
      expect(screen.getByTestId('revoke-now').textContent).toContain('Try again'),
    );
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });
});

describe('step 3 — sweep', () => {
  it('starts the sweep and follows the execution to confirmation', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(status({ frozen: true }))
      .mockResolvedValueOnce(status({ frozen: true }))
      .mockResolvedValue(status({ frozen: true, sweep: { state: 'confirmed', txHash: '0xabc' } }));
    mocks.apiPost.mockResolvedValue({ state: 'submitted', txHash: '0xabc', verdict: 'ALLOW' });
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);

    fireEvent.click(await screen.findByTestId('sweep-now'));
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith('/api/sweep', expect.anything()),
    );
    await waitFor(() => expect(screen.getByTestId('freeze-step-3').dataset['state']).toBe('done'));
  });

  it('does not re-run a sweep that already confirmed', async () => {
    mocks.apiGet.mockResolvedValue(
      status({ frozen: true, sweep: { state: 'confirmed', txHash: '0xabc' } }),
    );
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);
    await waitFor(() => expect(screen.getByTestId('freeze-step-3').dataset['state']).toBe('done'));
    expect(screen.queryByTestId('sweep-now')).toBeNull();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });
});

describe('the Freeze control stays reachable', () => {
  it('is still a button once the wallet is frozen, so the flow can be resumed', () => {
    const open = vi.fn();
    render(<FreezeButton frozen onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Frozen' }));
    expect(open).toHaveBeenCalled();
  });

  it('opens the flow from the calm state too', () => {
    const open = vi.fn();
    render(<FreezeButton frozen={false} onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(open).toHaveBeenCalled();
  });
});
