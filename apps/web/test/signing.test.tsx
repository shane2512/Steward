// @vitest-environment jsdom
// Task 7.6 — the four signing flows.
//
// The assertion that matters most in every one of these: THE PAYLOAD SHOWN IS THE PAYLOAD FETCHED,
// and the payload signed is that same object. If a flow ever started composing its own message, the
// "signs exactly what the server sent" tests here would fail.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  signMessageAsync: vi.fn(),
  signTypedDataAsync: vi.fn(),
  switchChain: vi.fn(),
  account: {
    address: '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C',
    chainId: 84532,
    connector: { id: 'coinbaseWalletSDK' },
    isConnected: true,
  } as Record<string, unknown>,
  bytecode: { data: '0x60006000', isSuccess: true } as Record<string, unknown>,
  detail: undefined as unknown,
}));

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock('wagmi', () => ({
  useAccount: () => mocks.account,
  useBytecode: () => mocks.bytecode,
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false }),
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedDataAsync }),
}));
vi.mock('../lib/useApi', () => ({
  useApi: () => ({
    data: mocks.detail,
    error: null,
    isLoading: false,
    isFetching: false,
    updatedAt: 1,
    refetch: vi.fn(),
    refreshFailed: false,
  }),
}));

import { AddRecipientSign } from '../components/sign/AddRecipientSign';
import { ApprovalSign, timeLeft } from '../components/sign/ApprovalSign';
import { PolicySign } from '../components/sign/PolicySign';
import { SpendLimitSign, ALLOWANCE_STEPS, maxAtRisk } from '../components/sign/SpendLimitSign';
import { ApiError } from '../lib/api';
import type { Approval, WalletState } from '../lib/contracts';

const OWNER = '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C';
const AGENT = '0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14';
const SIG = `0x${'ab'.repeat(65)}`;

const TYPED_DATA = {
  domain: {
    name: 'Spend Permission Manager',
    version: '1',
    chainId: 84532,
    verifyingContract: '0xf85210B21cC50302F477BA56686d2019dC9b67Ad',
  },
  types: { SpendPermission: [{ name: 'account', type: 'address' }] },
  primaryType: 'SpendPermission',
  message: {
    account: OWNER,
    spender: AGENT,
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    allowance: '25000000000',
    period: 86_400,
    start: 1_800_000_000,
    end: 1_800_086_400,
    salt: '12345',
    extraData: '0x',
  },
};

const wallet: WalletState = {
  wallet: {
    id: 'w1',
    chainId: 84532,
    treasuryAddress: OWNER,
    agentWalletAddress: AGENT,
    frozen: false,
    breakerOpen: false,
  },
  degraded: false,
  balances: { treasuryUsdc: '500000000', agentUsdc: '3000000' },
  spendPermission: { status: null, allowanceRemaining: '0' },
  vault: { address: AGENT, shares: '1000', assets: '2000000' },
  maxAtRiskMicroUsd: '0',
};

const approval: Approval = {
  id: 'a1',
  decisionId: 'd1',
  proposalHash: '0xdead',
  status: 'pending',
  message:
    'Steward approval\nWallet: w1\nProposal: 0xdead\nPolicy: v3\nExpires: 2999-01-01T00:00:00.000Z',
  expiresAt: '2999-01-01T00:00:00.000Z',
  decidedAt: null,
  proposal: null,
  rationale: 'Devon Achebe is due 4,000 USDC and the payment is over your per-payment cap.',
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.signMessageAsync.mockReset();
  mocks.signTypedDataAsync.mockReset();
  mocks.switchChain.mockReset();
  mocks.detail = undefined;
  mocks.account = {
    address: OWNER,
    chainId: 84532,
    connector: { id: 'coinbaseWalletSDK' },
    isConnected: true,
  };
  mocks.bytecode = { data: '0x60006000', isSuccess: true };
});
afterEach(cleanup);

/** A wallet rejection, shaped the way EIP-1193 providers raise it. */
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });

// ─────────────────────────────────────────────────────────── (a) spend permission

describe('(a) spend permission signing', () => {
  it('signs the EXACT typed data the server prepared, then stores that same message', async () => {
    mocks.apiPost.mockResolvedValueOnce({ typedData: TYPED_DATA, permissionHash: '0xhash' });
    mocks.signTypedDataAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockResolvedValueOnce({
      id: 'sp1',
      permissionHash: '0xhash',
      status: 'pending',
      accountKind: 'smart',
    });
    const done = vi.fn();
    render(<SpendLimitSign wallet={wallet} onSigned={done} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review the limit' }));
    const shown = await screen.findByTestId('literal-payload');

    // what is on screen is exactly what came back
    expect(JSON.parse(shown.textContent ?? '{}')).toEqual(TYPED_DATA);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in wallet' }));

    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    // and exactly what was handed to the wallet
    expect(mocks.signTypedDataAsync).toHaveBeenCalledWith(TYPED_DATA);
    expect(mocks.apiPost.mock.calls[1]?.[2]).toEqual({
      permission: TYPED_DATA.message,
      signature: SIG,
    });
  });

  it('shows "maximum at risk" from the SERVER allowance once a payload is prepared', async () => {
    // slider default is 10,000/day; the server prepares 25,000
    mocks.apiPost.mockResolvedValueOnce({ typedData: TYPED_DATA, permissionHash: '0xh' });
    render(<SpendLimitSign wallet={wallet} onSigned={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review the limit' }));
    await screen.findByTestId('literal-payload');
    // 25,000 allowance + 3 agent USDC + 2 vault USDC
    expect(screen.getByText('25,005 USDC')).toBeTruthy();
  });

  it('a rejected signature stays on the step, explains, and does not claim success', async () => {
    mocks.apiPost.mockResolvedValueOnce({ typedData: TYPED_DATA, permissionHash: '0xh' });
    mocks.signTypedDataAsync.mockRejectedValueOnce(rejected());
    const done = vi.fn();
    render(<SpendLimitSign wallet={wallet} onSigned={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review the limit' }));
    await screen.findByTestId('literal-payload');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in wallet' }));

    await screen.findByText('Signature not given');
    expect(screen.getByText(/Nothing was signed and nothing moved/)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    expect(mocks.apiPost).toHaveBeenCalledTimes(1); // nothing was stored
  });

  it('a failed attempt drops the payload, so the retry re-prepares instead of re-using it', async () => {
    mocks.apiPost.mockResolvedValueOnce({ typedData: TYPED_DATA, permissionHash: '0xh' });
    mocks.signTypedDataAsync.mockRejectedValueOnce(rejected());
    render(<SpendLimitSign wallet={wallet} onSigned={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review the limit' }));
    await screen.findByTestId('literal-payload');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in wallet' }));
    await screen.findByText('Signature not given');
    expect(screen.queryByTestId('literal-payload')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review the limit' })).toBeTruthy();
  });

  it('explains an EOA before asking it to sign, and asks for no signature', () => {
    mocks.account = {
      address: OWNER,
      chainId: 84532,
      connector: { id: 'injected' },
      isConnected: true,
    };
    mocks.bytecode = { data: undefined, isSuccess: true };
    render(<SpendLimitSign wallet={wallet} onSigned={vi.fn()} />);
    expect(screen.getByText('This wallet cannot give Steward a spending limit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign/i })).toBeNull();
  });

  it('a counterfactual smart wallet with no bytecode is NOT called an EOA', () => {
    mocks.bytecode = { data: undefined, isSuccess: true };
    render(<SpendLimitSign wallet={wallet} onSigned={vi.fn()} />);
    expect(screen.queryByText('This wallet cannot give Steward a spending limit')).toBeNull();
  });

  it('offers the network switch instead of a signature on the wrong chain', () => {
    mocks.account = { ...mocks.account, chainId: 1 };
    render(<SpendLimitSign wallet={wallet} onSigned={vi.fn()} />);
    expect(screen.getByText('Wrong network')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Base Sepolia' }));
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 84532 });
  });

  it('maxAtRisk is the sum SECURITY §3 L1 defines, in bigint', () => {
    expect(maxAtRisk({ agentUsdc: 1n, vaultAssets: 2n, allowance: 3n })).toBe(6n);
    expect(ALLOWANCE_STEPS[0]).toBe(1_000_000_000n);
  });
});

// ──────────────────────────────────────────────────────────────── (b) policy

const prepared = {
  version: 2,
  bodyHash: '0xabc',
  message: 'Steward policy v2 0xabc',
  sentences: ['Keep at least 120,000 USDC liquid.', 'Pay only the 2 recipients on your list.'],
  diff: { added: ['Pay only the 2 recipients on your list.'], removed: [], previousVersion: 1 },
};

describe('(b) policy activation signing', () => {
  it('signs the exact message from /api/policy/prepare and reports success only after the server', async () => {
    mocks.apiPost.mockResolvedValueOnce(prepared);
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockResolvedValueOnce({ version: 2, cancelledApprovals: 1 });
    const done = vi.fn();
    render(<PolicySign onActivated={done} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review your policy' }));
    const shown = await screen.findByTestId('literal-payload');
    expect(shown.textContent).toBe('Steward policy v2 0xabc');
    expect(done).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign and activate' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.signMessageAsync).toHaveBeenCalledWith({ message: 'Steward policy v2 0xabc' });
    expect(mocks.apiPost.mock.calls[1]).toEqual([
      '/api/policy/activate',
      expect.anything(),
      { signature: SIG },
    ]);
  });

  it('shows the diff when re-activating over an existing version', async () => {
    mocks.apiPost.mockResolvedValueOnce(prepared);
    render(<PolicySign onActivated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review your policy' }));
    const diff = await screen.findByTestId('policy-diff');
    expect(diff.textContent).toMatch(/What changes from v1/);
    expect(diff.textContent).toMatch(/Added: Pay only the 2 recipients/);
  });

  it('a first activation shows no diff', async () => {
    mocks.apiPost.mockResolvedValueOnce({
      ...prepared,
      version: 1,
      diff: { added: [], removed: [], previousVersion: null },
    });
    render(<PolicySign onActivated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review your policy' }));
    await screen.findByTestId('policy-sentences');
    expect(screen.queryByTestId('policy-diff')).toBeNull();
  });

  it('a stale draft is explained with its own words, not a generic failure', async () => {
    mocks.apiPost.mockResolvedValueOnce(prepared);
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockRejectedValueOnce(new ApiError(401, 'bad_signature', 'no match'));
    const done = vi.fn();
    render(<PolicySign onActivated={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review your policy' }));
    await screen.findByTestId('literal-payload');
    fireEvent.click(screen.getByRole('button', { name: 'Sign and activate' }));
    await screen.findByText('That signature was not accepted');
    expect(done).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────── (c) recipients

const existing = [
  {
    id: 'r1',
    label: 'Mara Okonjo',
    address: '0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802',
    maxPerTx: '1200000000',
    scheduleDayOfMonth: null,
    status: 'active',
  },
];
const LOOKALIKE = '0x1d4f000000000000000000000000000000000000';
const CLEAN = '0x9999999999999999999999999999999999999999';

const fillForm = (address: string) => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Devon Achebe' } });
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: address } });
  fireEvent.change(screen.getByLabelText('Most per payment'), { target: { value: '4000' } });
};

describe('(c) recipient-add signing', () => {
  it('shows the SERVER address (both forms) and signs the server message', async () => {
    const serverAddress = '0x9999999999999999999999999999999999999999';
    mocks.apiPost.mockResolvedValueOnce({
      message: 'Steward recipient\nWallet: w1\nAddress: ' + serverAddress,
      address: serverAddress,
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockResolvedValueOnce({
      recipient: { ...existing[0], id: 'r2', address: serverAddress },
      needsPolicySignature: true,
    });
    const added = vi.fn();
    render(<AddRecipientSign existing={existing} onAdded={added} />);
    fillForm(CLEAN.toLowerCase());
    fireEvent.click(screen.getByRole('button', { name: 'Check this address' }));

    await screen.findByTestId('recipient-confirm');
    expect(screen.getByTestId('address-short').textContent).toBe('0x9999…999999');
    // every character, in 4-char groups
    expect(screen.getByTestId('address-grouped').textContent?.replace(/\s/g, '')).toBe(
      serverAddress,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign and add recipient' }));
    await waitFor(() => expect(added).toHaveBeenCalledOnce());
    expect(mocks.signMessageAsync).toHaveBeenCalledWith({
      message: 'Steward recipient\nWallet: w1\nAddress: ' + serverAddress,
    });
    expect(added.mock.calls[0]?.[1]).toBe(true); // needs a policy signature
  });

  it('warns about a look-alike address without blocking it', () => {
    render(<AddRecipientSign existing={existing} onAdded={vi.fn()} />);
    fillForm(LOOKALIKE);
    expect(screen.getByTestId('poison-warning').textContent).toMatch(/This looks like Mara Okonjo/);
    expect(
      (screen.getByRole('button', { name: 'Check this address' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('does not warn about an unrelated address', () => {
    render(<AddRecipientSign existing={existing} onAdded={vi.fn()} />);
    fillForm(CLEAN);
    expect(screen.queryByTestId('poison-warning')).toBeNull();
  });

  it('refuses to prepare anything for a malformed address', () => {
    render(<AddRecipientSign existing={existing} onAdded={vi.fn()} />);
    fillForm('0xnothex');
    expect(
      (screen.getByRole('button', { name: 'Check this address' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('an expired confirmation says so and nothing was added', async () => {
    mocks.apiPost.mockResolvedValueOnce({
      message: 'Steward recipient\nNonce: x',
      address: CLEAN,
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockRejectedValueOnce(new ApiError(409, 'nonce_expired', 'expired'));
    const added = vi.fn();
    render(<AddRecipientSign existing={existing} onAdded={added} />);
    fillForm(CLEAN);
    fireEvent.click(screen.getByRole('button', { name: 'Check this address' }));
    await screen.findByTestId('recipient-confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Sign and add recipient' }));
    await screen.findByText('That confirmation expired');
    expect(screen.getByText(/Nothing was added/)).toBeTruthy();
    expect(added).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────── (d) approvals

describe('(d) approval signing', () => {
  it('signs the message the queue returned and only succeeds after the server', async () => {
    mocks.apiGet.mockResolvedValueOnce({ approvals: [approval] });
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockResolvedValueOnce({ approval: { id: 'a1', status: 'approved' } });
    const decided = vi.fn();
    render(<ApprovalSign approval={approval} onDecided={decided} />);

    expect(screen.getByTestId('literal-payload').textContent).toBe(approval.message);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('button', { name: 'Sign in wallet' });
    expect(decided).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in wallet' }));
    await waitFor(() => expect(decided).toHaveBeenCalledOnce());
    expect(mocks.signMessageAsync).toHaveBeenCalledWith({ message: approval.message });
    expect(mocks.apiPost.mock.calls[0]?.[0]).toBe('/api/approvals/a1/approve');
    expect(mocks.apiPost.mock.calls[0]?.[2]).toEqual({ signature: SIG });
  });

  it('re-reads the queue before signing, so a vanished approval never reaches the wallet', async () => {
    mocks.apiGet.mockResolvedValueOnce({ approvals: [] });
    render(<ApprovalSign approval={approval} onDecided={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('This was already decided');
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
  });

  it('an expired approval cannot be approved and explains re-evaluation', () => {
    render(
      <ApprovalSign
        approval={{ ...approval, expiresAt: '2000-01-01T00:00:00.000Z' }}
        onDecided={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('approval-expired').textContent).toMatch(/next check/);
  });

  it('a policy change since the proposal is explained as an auto-cancellation', async () => {
    mocks.apiGet.mockResolvedValueOnce({ approvals: [approval] });
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockRejectedValueOnce(
      new ApiError(409, 'policy_version_changed', 'policy changed'),
    );
    const decided = vi.fn();
    render(<ApprovalSign approval={approval} onDecided={decided} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in wallet' }));
    await screen.findByText('Your policy changed after Steward asked');
    expect(screen.getByText(/cancelled automatically/)).toBeTruthy();
    expect(decided).not.toHaveBeenCalled();
  });

  it('a wrong signer shows the server reason, never a generic message', async () => {
    mocks.apiGet.mockResolvedValueOnce({ approvals: [approval] });
    mocks.signMessageAsync.mockResolvedValueOnce(SIG);
    mocks.apiPost.mockRejectedValueOnce(new ApiError(403, 'owner_mismatch', 'not the treasury'));
    render(<ApprovalSign approval={approval} onDecided={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in wallet' }));
    await screen.findByText('That wallet cannot approve this');
  });

  it('rejects without asking for a signature', async () => {
    mocks.apiPost.mockResolvedValueOnce({ approval: { id: 'a1', status: 'rejected' } });
    const decided = vi.fn();
    render(<ApprovalSign approval={approval} onDecided={decided} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(decided).toHaveBeenCalledOnce());
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(mocks.apiPost.mock.calls[0]?.[0]).toBe('/api/approvals/a1/reject');
  });

  it('an already-decided approval refuses a replay', () => {
    render(<ApprovalSign approval={{ ...approval, status: 'approved' }} onDecided={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/already approved/)).toBeTruthy();
  });

  it('timeLeft counts down and lapses', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(timeLeft(new Date(now + 5 * 3_600_000).toISOString(), now)).toBe('5h 0m left');
    expect(timeLeft(new Date(now + 12 * 60_000).toISOString(), now)).toBe('12 min left');
    expect(timeLeft(new Date(now - 1).toISOString(), now)).toBeNull();
    // a badly wrong clock reads as days, never as five digits of hours
    expect(timeLeft(new Date(now + 90 * 86_400_000).toISOString(), now)).toBe('90d left');
    expect(timeLeft('not a date', now)).toBeNull();
  });
});
