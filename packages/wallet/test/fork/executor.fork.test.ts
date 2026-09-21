// 5.x fork integration — the whole Phase 5 chain against a REAL Base Sepolia fork:
//   buildCalls → eth_simulateV1 (packages/risk) → receipt → executor → confirmer → ledger,
// with the real deployed MockVault and the real Circle testnet USDC.
//
// Opt-in (needs anvil + an RPC + Postgres):
//   STEWARD_FORK=1 npx vitest run packages/wallet/test/fork
//
// HARNESS LIMITATION (not a product one): a CDP smart account sends the whole `Call[]` as ONE user
// operation, so the confirmer sees every Transfer of the batch in a single receipt. An impersonated
// EOA on anvil cannot batch, so the local sender here sends the calls sequentially and returns the
// last transaction hash. For `sweep_home` (redeem, then transfer) that last receipt therefore shows
// the gross transfer rather than the net batch effect, so the sweep test asserts the on-chain
// outcome and the executor's behaviour, and leaves the log-based effect check to the kinds whose
// effect lands in one transaction. The live run on Base Sepolia exercises the batched path.
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  erc20Abi,
  getAddress,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { hashProposal, signReceipt } from '@steward/policy';
import { simulateProposalCalls } from '@steward/risk';
import { schema, type Db, getExecutionById } from '@steward/db';
import type { AllowReceipt, Policy, Proposal, Verdict } from '@steward/shared';
import { freshTestDb } from '../../../db/test/helpers';
import {
  ERC4626_ABI,
  buildCalls,
  callsHash,
  confirmExecution,
  execute,
  sweepHome,
  type Call,
  type TxSender,
} from '../../src';

const FORK = process.env['STEWARD_FORK'] === '1';
const RPC = process.env['RPC_URL_BASE_SEPOLIA'] ?? 'https://sepolia.base.org';
const VAULT = getAddress(
  process.env['MOCK_VAULT_ADDRESS'] ?? '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485',
);
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
const AGENT = getAddress('0x00000000000000000000000000000000000a9e18');
const TREASURY = getAddress('0x00000000000000000000000000000000000f1a7f');
const ALEX = getAddress('0x1111111111111111111111111111111111111111');
const PORT = 8546;
const ONE = 1_000_000n;
const KEY = new Uint8Array(32).fill(3);

let anvil: ChildProcess;
let client: ReturnType<typeof createTestClient> &
  ReturnType<typeof publicActions> &
  ReturnType<typeof walletActions>;
let publicClient: PublicClient;
let db: Db;
let pool: { end(): Promise<void> };
let walletId: string;
let decisionId: string;
let nonce = 0;
const nextNonce = () => `00000000-0000-4000-a000-${String(++nonce).padStart(12, '0')}`;

const policy = (): Policy =>
  ({
    version: 1,
    walletId,
    chainId: 84532,
    treasuryAddress: TREASURY,
    tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
    vaults: [
      {
        id: 'v1',
        name: 'Steward Mock Vault',
        address: VAULT,
        asset: USDC,
        kind: 'erc4626',
        maxAllocationBps: 10_000,
      },
    ],
    recipients: [{ id: 'alex', label: 'Alex', address: ALEX, maxPerTxMicroUsd: 100n * ONE }],
    limits: { perTxMicroUsd: 100n * ONE, dailyMicroUsd: 1_000n * ONE, maxActionsPerHour: 20 },
    runwayBufferMicroUsd: 0n,
    approvalThresholdMicroUsd: 1_000n * ONE,
    depegThresholdBps: 50,
    vaultDrawdownBps: 100,
    autonomousKinds: ['vault_deposit', 'vault_withdraw', 'pay_recipient', 'sweep_home', 'noop'],
    createdAt: '2026-09-21T00:00:00.000Z',
    signedBy: TREASURY,
    signature: '0xdeadbeef',
  }) as Policy;

const ctx = async () => ({
  agentWalletAddress: AGENT,
  spendPermissionManagerAddress: MANAGER,
  agentUsdcBalance: await usdcBalance(AGENT),
  vaultPositions: {
    v1: {
      shares: await shares(AGENT),
      redeemableAssets: await client.readContract({
        address: VAULT,
        abi: ERC4626_ABI,
        functionName: 'maxWithdraw',
        args: [AGENT],
      }),
    },
  },
  allowMainnet: false,
});

const usdcBalance = (who: Address) =>
  client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
const shares = (who: Address) =>
  client.readContract({ address: VAULT, abi: ERC4626_ABI, functionName: 'balanceOf', args: [who] });

/** The fork's fill of the executor's `TxSender` port. See the harness note at the top. */
const sender: TxSender = {
  getAddress: () => AGENT,
  async send(calls: readonly Call[]) {
    let last: Hex | undefined;
    for (const call of calls) {
      const hash = await client.sendTransaction({ account: AGENT, chain: null, ...call });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`call to ${call.to} reverted`);
      last = hash;
    }
    if (!last) throw new Error('no calls to send');
    return { txHash: last };
  },
};

function verdictFor(proposal: Proposal, p: Policy): Verdict {
  return {
    decision: 'ALLOW',
    results: [{ code: 'R00', result: 'PASS' }],
    proposalHash: hashProposal(proposal),
    policyVersion: p.version,
    walletId,
    evaluatedAt: new Date().toISOString(),
  };
}

function receiptFor(proposal: Proposal, p: Policy, hash: Hex): AllowReceipt {
  const signed = signReceipt(verdictFor(proposal, p), KEY, new Date(), nextNonce(), {
    callsHash: hash,
  });
  if (!signed.ok) throw new Error(signed.error.message);
  return signed.value;
}

/** buildCalls → simulate → receipt → execute → confirm, the way Phase 6 will drive it. */
async function runProposal(
  proposal: Proposal,
  opts: { recipient?: Address; confirm?: boolean } = {},
) {
  const p = policy();
  const buildContext = await ctx();
  const built = buildCalls(proposal, p, buildContext);
  expect(built.ok, built.ok ? '' : JSON.stringify(built)).toBe(true);
  if (!built.ok) throw new Error('unreachable');
  const hash = callsHash(built.value);

  const simulated = await simulateProposalCalls({
    publicClient,
    calls: built.value,
    from: AGENT,
    token: USDC,
    holders: { agent: AGENT, treasury: TREASURY, recipient: opts.recipient },
  });
  expect(simulated.ok, simulated.ok ? '' : JSON.stringify(simulated)).toBe(true);
  if (!simulated.ok) throw new Error('unreachable');
  expect(simulated.value.ok, simulated.value.error).toBe(true);

  const receipt = receiptFor(proposal, p, hash);
  const result = await execute(
    { db, sender, receiptKey: KEY, now: () => new Date() },
    {
      walletId,
      decisionId,
      proposal,
      policy: p,
      receipt,
      buildContext,
      simulatedCallsHash: hash,
    },
  );
  expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
  if (!result.ok || result.value.status !== 'submitted') throw new Error('not submitted');

  if (opts.confirm !== false) {
    const confirmed = await confirmExecution(
      { db, publicClient, now: () => new Date(), timeoutMs: 30_000, pollIntervalMs: 250 },
      {
        executionId: result.value.execution.id,
        token: USDC,
        holders: { agent: AGENT, treasury: TREASURY, recipient: opts.recipient },
        expectedDeltas: proposal.expectedDeltas,
      },
    );
    expect(confirmed.ok, confirmed.ok ? '' : String(confirmed)).toBe(true);
    if (!confirmed.ok) throw new Error('unreachable');
    expect(
      confirmed.value.status,
      confirmed.value.status === 'failed' ? confirmed.value.reason : '',
    ).toBe('confirmed');
  }

  return { simulation: simulated.value, executionId: result.value.execution.id, callsHash: hash };
}

describe.skipIf(!FORK)('fork: the full Phase 5 chain against Base Sepolia state', () => {
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
    publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(`http://127.0.0.1:${PORT}`),
    }) as PublicClient;

    await client.setBalance({ address: AGENT, value: 10n ** 18n });
    const raw = client as unknown as {
      request(args: { method: string; params: unknown[] }): Promise<unknown>;
    };
    await raw.request({
      method: 'anvil_dealERC20',
      params: [AGENT, USDC, `0x${(100n * ONE).toString(16)}`],
    });
    await client.impersonateAccount({ address: AGENT });

    const fresh = await freshTestDb();
    db = fresh.db;
    pool = fresh.pool;
    const [user] = await db.insert(schema.users).values({ ownerAddress: TREASURY }).returning();
    const [wallet] = await db
      .insert(schema.wallets)
      .values({
        userId: user!.id,
        chainId: 84532,
        treasuryAddress: TREASURY,
        agentWalletAddress: AGENT,
        activePolicyVersion: 1,
      })
      .returning();
    walletId = wallet!.id;
    await db.insert(schema.policies).values({
      walletId,
      version: 1,
      body: JSON.parse(
        JSON.stringify(policy(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      ),
      bodyHash: `0x${'11'.repeat(32)}`,
      status: 'active',
    });
    const [decision] = await db
      .insert(schema.agentDecisions)
      .values({
        walletId,
        trigger: 'owner',
        contextSnapshot: {},
        contextHash: `0x${'22'.repeat(32)}`,
        proposalSource: 'owner',
        status: 'allowed',
      })
      .returning();
    decisionId = decision!.id;
  }, 180_000);

  afterAll(async () => {
    anvil?.kill();
    await pool?.end();
  });

  it('vault_deposit: simulated deltas match, executor sends, confirmer confirms', async () => {
    const amount = 20n * ONE;
    const before = await usdcBalance(AGENT);
    const { simulation, executionId } = await runProposal({
      kind: 'vault_deposit',
      params: { vaultId: 'v1', amount },
      expectedDeltas: [{ token: USDC, holder: 'agent', delta: -amount }],
      rationale: 'deploy idle cash',
      citedFactIds: [],
      confidence: 1,
      source: 'deterministic',
    });

    expect(simulation.deltas.find((d) => d.holder === 'agent')?.delta).toBe(-amount);
    // R18's input: exactly one approval, for exactly the deposited amount, to the policy vault.
    expect(simulation.approvals).toEqual([{ token: USDC, spender: VAULT, amount }]);

    expect(await usdcBalance(AGENT)).toBe(before - amount);
    expect(await shares(AGENT)).toBeGreaterThan(0n);
    expect(
      await client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [AGENT, VAULT],
      }),
    ).toBe(0n);
    expect((await getExecutionById(db, executionId))?.status).toBe('confirmed');
  }, 120_000);

  it('vault_withdraw: assets come back to the agent', async () => {
    const amount = 5n * ONE;
    const before = await usdcBalance(AGENT);
    await runProposal({
      kind: 'vault_withdraw',
      params: { vaultId: 'v1', amount },
      expectedDeltas: [{ token: USDC, holder: 'agent', delta: amount }],
      rationale: 'free up liquidity',
      citedFactIds: [],
      confidence: 1,
      source: 'deterministic',
    });
    expect(await usdcBalance(AGENT)).toBe(before + amount);
  }, 120_000);

  it('pay_recipient: the allowlisted recipient is paid exactly once', async () => {
    const amount = 3n * ONE;
    const before = await usdcBalance(ALEX);
    const { executionId } = await runProposal(
      {
        kind: 'pay_recipient',
        params: { recipientId: 'alex', amount },
        expectedDeltas: [
          { token: USDC, holder: 'agent', delta: -amount },
          { token: USDC, holder: 'recipient', delta: amount },
        ],
        rationale: 'payroll',
        citedFactIds: [],
        confidence: 1,
        source: 'deterministic',
      },
      { recipient: ALEX },
    );
    expect(await usdcBalance(ALEX)).toBe(before + amount);

    const ledger = await db.select().from(schema.ledgerEntries);
    expect(ledger.some((l) => l.executionId === executionId && l.direction === 'out')).toBe(true);
  }, 120_000);

  it('a proposal whose calls would revert is caught by the simulation, before any send', async () => {
    const tooMuch = 10_000n * ONE; // more USDC than the agent has
    const p = policy();
    const buildContext = await ctx();
    const built = buildCalls(
      {
        kind: 'pay_recipient',
        params: { recipientId: 'alex', amount: tooMuch },
        expectedDeltas: [{ token: USDC, holder: 'agent', delta: -tooMuch }],
        rationale: 'overspend',
        citedFactIds: [],
        confidence: 1,
        source: 'deterministic',
      },
      p,
      buildContext,
    );
    if (!built.ok) throw new Error('build should succeed; the policy allows the size');
    const simulated = await simulateProposalCalls({
      publicClient,
      calls: built.value,
      from: AGENT,
      token: USDC,
      holders: { agent: AGENT, treasury: TREASURY, recipient: ALEX },
    });
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.value.ok).toBe(false); // ⇒ R11 DENY, nothing is ever executed
    expect(simulated.value.error).toContain('reverted');
  }, 120_000);

  it('sweepHome: owner path works WHILE FROZEN and empties the agent wallet', async () => {
    await db.update(schema.wallets).set({ frozen: true, frozenReason: 'owner froze' });

    const agentBefore = await usdcBalance(AGENT);
    const treasuryBefore = await usdcBalance(TREASURY);
    const redeemable = await client.readContract({
      address: VAULT,
      abi: ERC4626_ABI,
      functionName: 'maxWithdraw',
      args: [AGENT],
    });
    expect(agentBefore + redeemable).toBeGreaterThan(0n);

    const result = await sweepHome(
      {
        db,
        publicClient,
        sender,
        receiptKey: KEY,
        now: () => new Date(),
        spendPermissionManagerAddress: MANAGER,
        decisionId,
      },
      walletId,
    );
    expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;
    expect(result.value.verdict.decision).toBe('ALLOW');
    expect(result.value.execution?.status).toBe('submitted');

    // Everything is home: the agent keeps at most share-price dust (D-22).
    expect(await usdcBalance(AGENT)).toBeLessThanOrEqual(1n);
    expect(await usdcBalance(TREASURY)).toBe(treasuryBefore + agentBefore + redeemable);
    expect(await shares(AGENT)).toBe(0n);

    // The sweep was simulated and the simulation row carries the calls hash the executor used.
    const [simulationRow] = await db.select().from(schema.simulations);
    expect(simulationRow?.ok).toBe(true);
    const sweepRow = (await db.select().from(schema.executions)).find(
      (e) => e.kind === 'sweep_home',
    );
    expect(sweepRow?.callsHash).toBe(simulationRow?.callsHash);
  }, 180_000);
});
