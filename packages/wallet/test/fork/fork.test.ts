// 2.8 — anvil fork harness. Proves the calldata `buildCalls` produces actually works against the
// REAL deployed MockVault and the REAL Circle testnet USDC, not just against a decoder.
//
// Opt-in, because it needs anvil (ships with Foundry) and an RPC URL:
//   STEWARD_FORK=1 RPC_URL_BASE_SEPOLIA=... MOCK_VAULT_ADDRESS=... npx vitest run packages/wallet/test/fork
//
// It is skipped in `pnpm test` on purpose — the exit gate reports it separately.
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestClient,
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  publicActions,
  walletActions,
  type Address,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import type { Policy, Proposal } from '@steward/shared';
import { buildCalls, ERC4626_ABI } from '../../src';

const FORK = process.env['STEWARD_FORK'] === '1';
const RPC = process.env['RPC_URL_BASE_SEPOLIA'] ?? 'https://sepolia.base.org';
const VAULT = process.env['MOCK_VAULT_ADDRESS'] ?? '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485';
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const PORT = 8545;
const ONE = 1_000_000n;

/** Any address; anvil's `anvil_dealERC20` mints it USDC on the fork. */
const AGENT = getAddress('0x00000000000000000000000000000000000a9e17');

const policy = {
  version: 1,
  walletId: 'fork-test',
  chainId: 84532,
  treasuryAddress: AGENT,
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
  vaults: [
    {
      id: 'v1',
      name: 'Steward Mock Vault',
      address: getAddress(VAULT),
      asset: USDC,
      kind: 'erc4626',
      maxAllocationBps: 10_000,
    },
  ],
  recipients: [],
  limits: { perTxMicroUsd: 100n * ONE, dailyMicroUsd: 100n * ONE, maxActionsPerHour: 10 },
  runwayBufferMicroUsd: 0n,
  approvalThresholdMicroUsd: 100n * ONE,
  depegThresholdBps: 100,
  vaultDrawdownBps: 500,
  autonomousKinds: ['vault_deposit', 'vault_withdraw'],
  createdAt: '2026-09-21T00:00:00.000Z',
  signedBy: AGENT,
  signature: '0x',
} as unknown as Policy;

const proposal = (kind: string, params: unknown) =>
  ({
    kind,
    params,
    expectedDeltas: [],
    rationale: 'fork test',
    citedFactIds: [],
    confidence: 1,
    source: 'deterministic',
  }) as unknown as Proposal;

describe.skipIf(!FORK)('fork: buildCalls output executes against the real MockVault', () => {
  let anvil: ChildProcess;
  let client: ReturnType<typeof createTestClient> &
    ReturnType<typeof publicActions> &
    ReturnType<typeof walletActions>;

  beforeAll(async () => {
    anvil = spawn(
      'anvil',
      ['--fork-url', RPC, '--port', String(PORT), '--silent', '--no-rate-limit'],
      { stdio: 'ignore', shell: process.platform === 'win32' },
    );
    const probe = createPublicClient({ transport: http(`http://127.0.0.1:${PORT}`) });
    for (let i = 0; i < 60; i++) {
      try {
        await probe.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    client = createTestClient({
      chain: baseSepolia,
      mode: 'anvil',
      transport: http(`http://127.0.0.1:${PORT}`),
    })
      .extend(publicActions)
      .extend(walletActions) as typeof client;

    // Fund the agent: ETH for gas, and USDC via anvil's own cheat (viem has no action for it).
    await client.setBalance({ address: AGENT, value: 10n ** 18n });
    const raw = client as unknown as {
      request(args: { method: string; params: unknown[] }): Promise<unknown>;
    };
    await raw.request({
      method: 'anvil_dealERC20',
      params: [AGENT, USDC, `0x${(10n * ONE).toString(16)}`],
    });
    await client.impersonateAccount({ address: AGENT });
  }, 120_000);

  afterAll(() => {
    anvil?.kill();
  });

  const send = async (calls: { to: Address; data: `0x${string}`; value: bigint }[]) => {
    for (const call of calls) {
      const hash = await client.sendTransaction({ account: AGENT, chain: null, ...call });
      const receipt = await client.waitForTransactionReceipt({ hash });
      expect(receipt.status, `call to ${call.to} reverted`).toBe('success');
    }
  };

  it('the fork really has the deployed MockVault over real USDC', async () => {
    const asset = await client.readContract({
      address: getAddress(VAULT),
      abi: ERC4626_ABI,
      functionName: 'asset',
    });
    expect(getAddress(asset)).toBe(USDC);
    expect(await client.getBalance({ address: AGENT })).toBeGreaterThan(0n);
    expect(
      await client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [AGENT],
      }),
    ).toBe(10n * ONE);
  });

  it('vault_deposit: exact approve + deposit succeed and mint shares', async () => {
    const built = buildCalls(
      proposal('vault_deposit', { vaultId: 'v1', amount: 5n * ONE }),
      policy,
      {
        agentWalletAddress: AGENT,
        spendPermissionManagerAddress: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
        agentUsdcBalance: 10n * ONE,
        vaultPositions: {},
        allowMainnet: false,
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await send(built.value);

    const shares = await client.readContract({
      address: getAddress(VAULT),
      abi: ERC4626_ABI,
      functionName: 'balanceOf',
      args: [AGENT],
    });
    expect(shares).toBeGreaterThan(0n);

    // T5/R18: the approval was consumed exactly — no residual allowance is left behind.
    const residual = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [AGENT, getAddress(VAULT)],
    });
    expect(residual).toBe(0n);
  }, 60_000);

  it('vault_withdraw: withdrawing part of the position succeeds', async () => {
    const before = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [AGENT],
    });
    const built = buildCalls(
      proposal('vault_withdraw', { vaultId: 'v1', amount: 2n * ONE }),
      policy,
      {
        agentWalletAddress: AGENT,
        spendPermissionManagerAddress: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
        agentUsdcBalance: before,
        vaultPositions: {},
        allowMainnet: false,
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await send(built.value);

    const after = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [AGENT],
    });
    expect(after - before).toBe(2n * ONE);
  }, 60_000);

  it('sweep_home: redeems the remaining shares and sends everything to the treasury', async () => {
    const shares = await client.readContract({
      address: getAddress(VAULT),
      abi: ERC4626_ABI,
      functionName: 'balanceOf',
      args: [AGENT],
    });
    const redeemable = await client.readContract({
      address: getAddress(VAULT),
      abi: ERC4626_ABI,
      functionName: 'maxWithdraw',
      args: [AGENT],
    });
    const usdc = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [AGENT],
    });

    // Treasury is a separate address here, so the transfer is observable.
    const treasury = getAddress('0x00000000000000000000000000000000000f1a7e');
    const built = buildCalls(
      proposal('sweep_home', {}),
      { ...policy, treasuryAddress: treasury },
      {
        agentWalletAddress: AGENT,
        spendPermissionManagerAddress: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
        agentUsdcBalance: usdc,
        vaultPositions: { v1: { shares, redeemableAssets: redeemable } },
        allowMainnet: false,
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await send(built.value);

    expect(
      await client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [treasury],
      }),
    ).toBe(usdc + redeemable);
  }, 60_000);
});
