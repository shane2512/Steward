// @vitest-environment jsdom
// Phase 7 addendum — the spend-limit step when the treasury is a companion smart wallet.
//
// Three things are asserted, in order of how much they would cost to get wrong:
//   1. the owner is TOLD, before signing, that the address to fund is the companion, not their
//      everyday balance — and the address shown is the one the server stored;
//   2. the signature is produced AS the companion: the connected EOA is asked to sign a payload
//      bound to the companion's address, and the result is ERC-6492-wrapped through the Coinbase
//      Smart Wallet factory so it verifies while the wallet is still counterfactual;
//   3. the old hard block still fires when there is no companion — an EOA with nothing derived for
//      it must never be walked into a signature it cannot give.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
  getAddress,
  keccak256,
  parseErc6492Signature,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
// Imported from the module, not the package barrel: the barrel pulls AgentKit, which refuses to
// load in a browser environment — the same reason the client keeps its own copy of the constants.
import {
  COINBASE_SMART_WALLET_NONCE,
  COINBASE_SMART_WALLET_VERSION,
  deriveCompanionTreasury,
} from '../../../packages/wallet/src/companionTreasury';
import { COMPANION_WALLET_NONCE, COMPANION_WALLET_VERSION } from '../lib/useTypedDataSigner';

const eoa = privateKeyToAccount(`0x${'5a'.repeat(32)}` as Hex);
const AGENT = '0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14';
const COINBASE_FACTORY_V1_1 = getAddress('0xba5ed110efdba3d005bfc882d75358acbbb85842');

/** eth_call answered deterministically (as in the derivation tests); the wallet has no code yet. */
const stubClient = createPublicClient({
  chain: baseSepolia,
  transport: custom({
    request: async ({ method, params }) => {
      if (method === 'eth_getCode') return '0x';
      if (method !== 'eth_call') throw new Error(`unexpected RPC: ${method}`);
      return keccak256((params as [{ data: Hex }])[0].data);
    },
  }),
}) as unknown as PublicClient;

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  signMessageAsync: vi.fn(),
  /** Real signing by a real local key, so the payload the EOA is handed is a real assertion. */
  signTypedDataAsync: vi.fn(),
  switchChain: vi.fn(),
  account: {} as Record<string, unknown>,
  bytecode: { data: '0x', isSuccess: true } as Record<string, unknown>,
  publicClient: undefined as unknown,
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
  usePublicClient: () => mocks.publicClient,
}));

import { SpendLimitSign } from '../components/sign/SpendLimitSign';
import type { WalletState } from '../lib/contracts';

let companion: string;

const TYPED_DATA = {
  domain: {
    name: 'Spend Permission Manager',
    version: '1',
    chainId: 84532,
    verifyingContract: '0xf85210B21cC50302F477BA56686d2019dC9b67Ad',
  },
  types: {
    SpendPermission: [
      { name: 'account', type: 'address' },
      { name: 'allowance', type: 'uint160' },
    ],
  },
  primaryType: 'SpendPermission',
  message: { account: '', allowance: '25000000000' } as Record<string, unknown>,
};

const walletState = (treasuryAddress: string): WalletState => ({
  wallet: {
    id: 'w1',
    chainId: 84532,
    treasuryAddress,
    agentWalletAddress: AGENT,
    frozen: false,
    breakerOpen: false,
  },
  degraded: false,
  balances: { treasuryUsdc: '500000000', agentUsdc: '3000000' },
  spendPermission: { status: null, allowanceRemaining: '0' },
  vault: null,
  maxAtRiskMicroUsd: '0',
});

beforeAll(async () => {
  const derived = await deriveCompanionTreasury(stubClient, eoa.address);
  if (!derived.ok) throw new Error(derived.error);
  companion = derived.value;
  TYPED_DATA.message.account = companion;
  mocks.publicClient = stubClient;
  mocks.account = {
    address: eoa.address,
    chainId: 84532,
    connector: { id: 'injected' }, // a plain browser wallet, NOT the Smart Wallet connector
    isConnected: true,
  };
  mocks.signTypedDataAsync.mockImplementation((td: Parameters<typeof eoa.signTypedData>[0]) =>
    eoa.signTypedData(td),
  );
});

afterEach(() => {
  cleanup();
  mocks.apiPost.mockReset();
});

describe('companion wallet constants', () => {
  // The client cannot import packages/wallet (it reaches CDP), so it keeps its own copy. If these
  // ever drift, the browser would sign for a different address than the server stored and every
  // signature would be refused — so they are pinned together here.
  it('match the server constants exactly', () => {
    expect(COMPANION_WALLET_VERSION).toBe(COINBASE_SMART_WALLET_VERSION);
    expect(COMPANION_WALLET_NONCE).toBe(COINBASE_SMART_WALLET_NONCE);
  });
});

describe('SpendLimitSign with a companion treasury', () => {
  it('explains the companion wallet and shows the address the server stored', () => {
    render(<SpendLimitSign wallet={walletState(companion)} onSigned={vi.fn()} />);
    const panel = screen.getByTestId('companion-treasury');
    expect(panel.textContent).toContain('Fund this address, not your everyday wallet balance.');
    expect(panel.textContent).toContain('Not created on-chain yet');
    // Full address, grouped but never truncated (DESIGN §12).
    expect(panel.textContent?.replace(/\s/g, '')).toContain(companion);
    // Announced, not silently swapped in.
    expect(panel.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByTestId('companion-treasury')?.getAttribute('aria-labelledby')).toBe(
      'companion-treasury-title',
    );
  });

  it('does NOT block an EOA that has a companion treasury', () => {
    render(<SpendLimitSign wallet={walletState(companion)} onSigned={vi.fn()} />);
    expect(screen.queryByText(/cannot give Steward a spending limit/)).toBeNull();
    expect(screen.getByTestId('spend-limit-sign')).toBeTruthy();
  });

  it('still blocks an EOA with no companion (treasury is the EOA itself)', () => {
    render(<SpendLimitSign wallet={walletState(eoa.address)} onSigned={vi.fn()} />);
    expect(screen.queryByTestId('companion-treasury')).toBeNull();
    expect(screen.getByText(/cannot give Steward a spending limit/)).toBeTruthy();
  });

  it('signs AS the companion wallet: the EOA signs a payload bound to it, ERC-6492 wrapped', async () => {
    mocks.apiPost.mockImplementation(async (path: string) => {
      if (path === '/api/spend-permission/prepare')
        return { typedData: TYPED_DATA, permissionHash: '0xfeed' };
      return { id: 'sp1', permissionHash: '0xfeed', status: 'pending', accountKind: 'x' };
    });
    render(<SpendLimitSign wallet={walletState(companion)} onSigned={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review the limit' }));
    await screen.findByRole('button', { name: 'Sign in wallet' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in wallet' }));

    await waitFor(() =>
      expect(mocks.apiPost.mock.calls.some((c) => c[0] === '/api/spend-permission')).toBe(true),
    );

    // The connected EOA was asked to sign the Smart Wallet's replay-safe envelope, whose EIP-712
    // domain names the COMPANION as the verifying contract — not the spend-permission domain.
    const asked = mocks.signTypedDataAsync.mock.calls.at(-1)?.[0] as {
      domain: { verifyingContract: string; name: string };
    };
    expect(getAddress(asked.domain.verifyingContract)).toBe(getAddress(companion));
    expect(asked.domain.name).toBe('Coinbase Smart Wallet');

    const body = mocks.apiPost.mock.calls.find((c) => c[0] === '/api/spend-permission')?.[2] as {
      permission: unknown;
      signature: Hex;
    };
    // Sent verbatim, and wrapped so the server can verify it before the wallet is deployed.
    expect(body.permission).toBe(TYPED_DATA.message);
    const unwrapped = parseErc6492Signature(body.signature);
    expect(getAddress(unwrapped.address!)).toBe(COINBASE_FACTORY_V1_1);
    expect(unwrapped.signature).not.toBe(body.signature); // it really was wrapped
  });
});
