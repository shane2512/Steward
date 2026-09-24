// @vitest-environment jsdom
// Task 7.8 — the S9 freeze flow.
//
// The assertions that matter here: the flow RESUMES from what the server says (never from its own
// memory), every action RE-READS that state before doing anything (so a retry cannot be a blind
// repeat), and the header's Freeze control stays reachable once the wallet is frozen — an owner who
// froze and closed the modal still has two steps to finish.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
// The module, not the barrel: the barrel pulls AgentKit, which refuses to load in jsdom.
import { deriveCompanionTreasury } from '../../../packages/wallet/src/companionTreasury';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  signMessageAsync: vi.fn(),
  sendTransactionAsync: vi.fn(),
  switchChain: vi.fn(),
  connectorId: 'coinbaseWalletSDK',
  bytecode: '0x60006000' as string | undefined,
  address: '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C',
  publicClient: undefined as unknown,
}));

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: mocks.address,
    chainId: 84532,
    connector: { id: mocks.connectorId },
    isConnected: true,
  }),
  useBytecode: () => ({ data: mocks.bytecode, isSuccess: true }),
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false }),
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransactionAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  usePublicClient: () => mocks.publicClient,
}));

import { FreezeFlow, stepStates } from '../components/freeze/FreezeFlow';
import { UnfreezeSlot } from '../components/freeze/UnfreezeSlot';
import { FreezeButton } from '../components/shell/AppHeader';
import type { OwnerPath } from '../lib/contracts';

const MANAGER = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad';
const REVOKE_DATA = `0x${'cd'.repeat(80)}`;
const FREEZE_MESSAGE = 'Steward freeze\nWallet: w1\nNonce: abc\nExpires: 2026-01-01T00:00:00.000Z';
/** 8.2 — the sweep gets its own server-issued message, with its own action on the first line. */
const SWEEP_MESSAGE = 'Steward sweep\nWallet: w1\nNonce: def\nExpires: 2026-01-01T00:00:00.000Z';

const status = (over: Partial<OwnerPath> = {}): OwnerPath => ({
  frozen: false,
  frozenAt: null,
  frozenReason: null,
  revoke: { state: 'none' },
  sweep: { state: 'none' },
  ...over,
});

const OWNER = '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C';
/** The spec'd path: the connected Smart Wallet IS the permission's account (the treasury). */
const todoRevoke = {
  state: 'todo',
  account: OWNER,
  to: MANAGER,
  data: REVOKE_DATA,
  permissionId: 'p1',
} as const;

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.signMessageAsync.mockReset();
  mocks.sendTransactionAsync.mockReset();
  mocks.connectorId = 'coinbaseWalletSDK';
  mocks.bytecode = '0x60006000';
  mocks.address = OWNER;
  mocks.publicClient = undefined;
});
afterEach(cleanup);

const flow = (over: Partial<OwnerPath> = {}) => {
  mocks.apiGet.mockResolvedValue(status(over));
  return render(
    <FreezeFlow frozen={over.frozen ?? false} onDone={() => {}} onClose={() => {}} pollMs={1} />,
  );
};

// I7: the owner's stop control is a message signature any wallet can make — a plain zero-code EOA
// must never be told it "cannot give Steward a spending limit" here.
describe('a plain EOA owner', () => {
  const EOA_BLOCKER = 'This wallet cannot give Steward a spending limit';
  beforeEach(() => {
    mocks.connectorId = 'injected';
    mocks.bytecode = undefined;
  });

  it('can freeze', async () => {
    flow();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalled());
    expect(screen.queryByText(EOA_BLOCKER)).toBeNull();
  });

  it('can unfreeze', () => {
    render(<UnfreezeSlot frozen onUnfrozen={() => {}} />);
    expect(screen.queryByText(EOA_BLOCKER)).toBeNull();
    expect(screen.getByTestId('unfreeze')).toBeTruthy();
  });
});

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
    // A step you cannot start yet offers no control at all: a disabled button on this card reads as
    // unexplained bold text (visual QA), and the dimmed numbered heading already says it is waiting.
    flow({ revoke: todoRevoke });
    await waitFor(() =>
      expect((screen.getByTestId('freeze-now') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByTestId('revoke-now')).toBeNull();
    expect(screen.queryByTestId('sweep-now')).toBeNull();
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

// Phase 7 addendum: the permission's account is a companion smart wallet the connected EOA owns.
// The manager reverts `InvalidSender(eoa, companion)` for a plain tx from the EOA (reproduced
// against Base Sepolia for wallet 6ffa9f11…), so the revoke must reach the manager FROM the
// companion: the EOA calls the wallet's own `execute`, deploying it first if it is counterfactual.
describe('step 2 — revoke, companion treasury', () => {
  const eoa = privateKeyToAccount(`0x${'5a'.repeat(32)}` as Hex);
  const FACTORY = getAddress('0xba5ed110efdba3d005bfc882d75358acbbb85842');
  const CSW = parseAbi([
    'function execute(address target, uint256 value, bytes data)',
    'function createAccount(bytes[] owners, uint256 nonce)',
  ]);
  const DEPLOY_TX = `0x${'d1'.repeat(32)}`;
  const EXEC_TX = `0x${'e1'.repeat(32)}`;

  /** Deterministic chain: eth_call answers as in the derivation tests; code and receipts on demand. */
  const chain = (opts: { deployed: boolean; deployStatus?: '0x1' | '0x0' }) =>
    createPublicClient({
      chain: baseSepolia,
      transport: custom({
        request: async ({ method, params }) => {
          if (method === 'eth_getCode') return opts.deployed ? '0x6000' : '0x';
          if (method === 'eth_call') return keccak256((params as [{ data: Hex }])[0].data);
          if (method === 'eth_blockNumber') return '0x10';
          if (method === 'eth_getTransactionReceipt')
            return {
              transactionHash: (params as [Hex])[0],
              status: opts.deployStatus ?? '0x1',
              blockNumber: '0x10',
              blockHash: `0x${'00'.repeat(32)}`,
              transactionIndex: '0x0',
              from: eoa.address,
              to: FACTORY,
              cumulativeGasUsed: '0x1',
              gasUsed: '0x1',
              effectiveGasPrice: '0x1',
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              type: '0x2',
              contractAddress: null,
            };
          throw new Error(`unexpected RPC: ${method}`);
        },
      }),
    }) as unknown as PublicClient;

  const companionFor = async () => {
    const d = await deriveCompanionTreasury(chain({ deployed: false }), eoa.address);
    if (!d.ok) throw new Error(d.error);
    return d.value;
  };

  const expectExecuteOfRevoke = (call: unknown, companion: string) => {
    const { to, data } = call as { to: string; data: Hex };
    expect(getAddress(to)).toBe(companion);
    const decoded = decodeFunctionData({ abi: CSW, data });
    expect(decoded.functionName).toBe('execute');
    expect(decoded.args).toEqual([MANAGER, 0n, REVOKE_DATA]);
  };

  it('deploys a counterfactual companion, then revokes through its execute', async () => {
    const companion = await companionFor();
    const revoke = { ...todoRevoke, account: companion };
    mocks.address = eoa.address;
    mocks.publicClient = chain({ deployed: false });
    mocks.sendTransactionAsync.mockResolvedValueOnce(DEPLOY_TX).mockResolvedValueOnce(EXEC_TX);
    mocks.apiPost.mockResolvedValue({ revoked: true, alreadyRevoked: false });
    flow({ frozen: true, revoke });

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalled());

    expect(mocks.sendTransactionAsync).toHaveBeenCalledTimes(2);
    const deploy = mocks.sendTransactionAsync.mock.calls[0]?.[0] as { to: string; data: Hex };
    expect(getAddress(deploy.to)).toBe(FACTORY);
    expect(decodeFunctionData({ abi: CSW, data: deploy.data }).functionName).toBe('createAccount');
    expectExecuteOfRevoke(mocks.sendTransactionAsync.mock.calls[1]?.[0], companion);
    // The server is still the judge: it gets the execute tx and reads `isRevoked` itself.
    expect(mocks.apiPost).toHaveBeenCalledWith('/api/spend-permission/revoked', expect.anything(), {
      txHash: EXEC_TX,
    });
  });

  it('an already-deployed companion is not deployed again', async () => {
    const companion = await companionFor();
    mocks.address = eoa.address;
    mocks.publicClient = chain({ deployed: true });
    mocks.sendTransactionAsync.mockResolvedValue(EXEC_TX);
    mocks.apiPost.mockResolvedValue({ revoked: true, alreadyRevoked: false });
    flow({ frozen: true, revoke: { ...todoRevoke, account: companion } });

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalled());
    expect(mocks.sendTransactionAsync).toHaveBeenCalledOnce();
    expectExecuteOfRevoke(mocks.sendTransactionAsync.mock.calls[0]?.[0], companion);
  });

  it('a failed deployment stops before the revoke and says so', async () => {
    const companion = await companionFor();
    mocks.address = eoa.address;
    mocks.publicClient = chain({ deployed: false, deployStatus: '0x0' });
    mocks.sendTransactionAsync.mockResolvedValue(DEPLOY_TX);
    flow({ frozen: true, revoke: { ...todoRevoke, account: companion } });

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() =>
      expect(screen.getByTestId('revoke-now').textContent).toContain('Try again'),
    );
    expect(mocks.sendTransactionAsync).toHaveBeenCalledOnce(); // the deploy only
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('refuses to act for an account the connected EOA does not own (I4)', async () => {
    mocks.address = eoa.address;
    mocks.publicClient = chain({ deployed: true });
    flow({
      frozen: true,
      revoke: { ...todoRevoke, account: '0x9999999999999999999999999999999999999999' },
    });

    fireEvent.click(await screen.findByTestId('revoke-now'));
    await waitFor(() =>
      expect(screen.getByTestId('revoke-now').textContent).toContain('Try again'),
    );
    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('step 3 — sweep', () => {
  it('starts the sweep and follows the execution to confirmation', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(status({ frozen: true }))
      .mockResolvedValueOnce(status({ frozen: true }))
      .mockResolvedValue(status({ frozen: true, sweep: { state: 'confirmed', txHash: '0xabc' } }));
    // 8.2: the sweep asks for its own server-issued message and signs it before posting.
    mocks.apiPost.mockImplementation((path: string) =>
      path === '/api/freeze/prepare'
        ? Promise.resolve({ message: SWEEP_MESSAGE, expiresAt: 'later' })
        : Promise.resolve({ state: 'submitted', txHash: '0xabc', verdict: 'ALLOW' }),
    );
    mocks.signMessageAsync.mockResolvedValue('0xsweepsig');
    render(<FreezeFlow frozen onDone={() => {}} onClose={() => {}} pollMs={1} />);

    fireEvent.click(await screen.findByTestId('sweep-now'));
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith('/api/freeze/prepare', expect.anything(), {
        action: 'sweep',
      }),
    );
    await waitFor(() =>
      expect(mocks.signMessageAsync).toHaveBeenCalledWith({
        message: SWEEP_MESSAGE,
      }),
    );
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith('/api/sweep', expect.anything(), {
        signature: '0xsweepsig',
      }),
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
