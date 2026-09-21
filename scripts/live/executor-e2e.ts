// LIVE Base Sepolia end-to-end run of the Phase 5 chain, through the PRODUCT code only:
//
//   simulate (eth_simulateV1) → evaluate() → signReceipt() → executor.execute() → confirmer
//     → ledger + audit, and finally the owner path `sweepHome`.
//
//   STEWARD_LIVE=1 pnpm live:executor
//
// Everything that moves money goes through `packages/wallet/src/executor.ts` with a real AllowReceipt
// signed from a real ALLOW verdict produced by the real Policy Engine. There is no shortcut path in
// this script: if `evaluate()` says anything but ALLOW, the run stops.
//
// Owner wallet: as in Phase 2's live script, a genuine Coinbase Smart Wallet built with viem's
// `toCoinbaseSmartAccount` whose owner key is generated in memory for this run only — never written
// to disk, never logged, testnet only (V-10 / PROGRESS "Owner-wallet caveat").
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { baseSepolia } from 'viem/chains';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@steward/db';
import { evaluate, hashProposal, signReceipt } from '@steward/policy';
import { mockPriceFeedAdapter, simulateProposalCalls } from '@steward/risk';
import type { Policy, PriceQuote, Proposal } from '@steward/shared';
import {
  buildCalls,
  buildSpendPermission,
  callsHash,
  cdpAccountNames,
  confirmExecution,
  ensureApprovedOnchain,
  execute,
  assertSmartWalletAccount,
  prepareTypedData,
  readAllowanceRemaining,
  spendPermissionHash,
  sweepHome,
  validateSpendPermission,
  type ApprovalSender,
  type Call,
  type SpendPermission,
  type TxSender,
} from '@steward/wallet';
import {
  CHAIN_ID,
  cdpClient,
  confirm,
  explorer,
  loadEnv,
  NETWORK,
  publicClient,
  requireLive,
  SPEND_PERMISSION_MANAGER as MANAGER,
  USDC,
  waitFor,
  waitForCode,
} from './lib';

requireLive('executor-e2e');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));

const cdp = cdpClient();
const pc = publicClient();
const ONE = 1_000_000n;
const VAULT = getAddress(
  process.env['MOCK_VAULT_ADDRESS'] ?? '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485',
);
const FEED = getAddress(
  process.env['MOCK_PRICE_FEED_ADDRESS'] ?? '0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69',
);
/** An allowlisted payee. Addresses only ever come from the Policy (I4). */
const ALEX = getAddress('0x1111111111111111111111111111111111111111');

// The receipt key. If `.env.local` does not carry one, this run mints an ephemeral 32-byte key in
// memory: the property the executor depends on is that a receipt must be signed with the key the
// executor holds, and a per-run key preserves it exactly. It is never printed or persisted.
// Production must set RECEIPT_HMAC_SECRET, or receipts issued by the web app would not verify in
// the worker (recorded as a Phase 5 known issue).
const receiptKeyRaw = process.env['RECEIPT_HMAC_SECRET'];
if (!receiptKeyRaw)
  console.log(
    'RECEIPT_HMAC_SECRET is not set: using an ephemeral in-memory receipt key for this run',
  );
const RECEIPT_KEY = receiptKeyRaw
  ? new TextEncoder().encode(receiptKeyRaw)
  : new Uint8Array(randomBytes(32));
// The local docker-compose database (D-10: host port 5433). Not a secret, and not read from
// .env.local, which currently carries only the CDP/SERV credentials.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://steward:steward@localhost:5433/steward';

const eqWallet = (id: string) => eq(schema.policies.walletId, id);
const eqWalletId = (id: string) => eq(schema.wallets.id, id);

const step = (n: string, s: string) =>
  console.log(`\n── ${n}. ${s} ${'─'.repeat(Math.max(0, 62 - s.length))}`);
const usdcBalance = (a: Address) =>
  pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const vaultShares = (a: Address) =>
  pc.readContract({
    address: VAULT,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [a],
  });
const maxWithdraw = (a: Address) =>
  pc.readContract({
    address: VAULT,
    abi: parseAbi(['function maxWithdraw(address) view returns (uint256)']),
    functionName: 'maxWithdraw',
    args: [a],
  });

// ── 1. agent wallet ──────────────────────────────────────────────────────────────────────────────
step('1', 'agent wallet (real CDP smart account)');
const USER_ID = randomUUID();
const names = cdpAccountNames('55555555-6666-4777-8888-999999999999'); // fixed: re-runs reuse it
if (!names.ok) throw new Error(names.error);
const agentOwner = await cdp.evm.getOrCreateAccount({ name: names.value.owner });
const agentAccount = await cdp.evm.getOrCreateSmartAccount({
  name: names.value.smartAccount,
  owner: agentOwner,
});
const agent = getAddress(agentAccount.address);
console.log(`agent wallet: ${agent}`);

// ── 2. owner treasury + spend permission ─────────────────────────────────────────────────────────
step('2', 'owner Coinbase Smart Wallet grants a Spend Permission');
const ownerKey = privateKeyToAccount(generatePrivateKey()); // in memory only, never printed
const ownerWallet = await toCoinbaseSmartAccount({
  client: pc,
  owners: [ownerKey],
  version: '1.1',
});
const treasury = getAddress(ownerWallet.address);
console.log(`owner treasury: ${treasury}`);

if ((await usdcBalance(treasury)) < ONE) {
  const f = await cdp.evm.requestFaucet({ address: treasury, network: NETWORK, token: 'usdc' });
  console.log(`faucet USDC → treasury: ${f.transactionHash}`);
  await waitFor(async () => (await usdcBalance(treasury)) >= ONE);
}
if ((await pc.getBalance({ address: ownerKey.address })) === 0n) {
  const f = await cdp.evm.requestFaucet({
    address: ownerKey.address,
    network: NETWORK,
    token: 'eth',
  });
  console.log(`faucet ETH → owner EOA: ${f.transactionHash}`);
  await waitFor(async () => (await pc.getBalance({ address: ownerKey.address })) > 0n);
}

const wc = createWalletClient({
  account: ownerKey,
  chain: baseSepolia,
  transport: http(process.env['RPC_URL_BASE_SEPOLIA']),
});
if (((await pc.getCode({ address: treasury })) ?? '0x') === '0x') {
  const factory = await ownerWallet.getFactoryArgs();
  const h = await wc.sendTransaction({ to: factory.factory!, data: factory.factoryData! });
  await confirm(pc, h, 'smart wallet deploy');
  await waitForCode(pc, treasury);
  console.log(`smart wallet deployed: ${explorer(h)}`);
}
const swAbi = parseAbi([
  'function isOwnerAddress(address account) view returns (bool)',
  'function addOwnerAddress(address owner)',
]);
const managerIsOwner = () =>
  pc.readContract({
    address: treasury,
    abi: swAbi,
    functionName: 'isOwnerAddress',
    args: [MANAGER],
  });
if (!(await managerIsOwner())) {
  const h = await wc.sendTransaction({
    to: treasury,
    data: encodeFunctionData({ abi: swAbi, functionName: 'addOwnerAddress', args: [MANAGER] }),
  });
  await confirm(pc, h, 'addOwnerAddress');
  console.log(`manager added as wallet owner: ${explorer(h)}`);
}
if (!(await waitFor(managerIsOwner))) throw new Error('manager is not an owner of the treasury');

const nowSec = Math.floor(Date.now() / 1000);
const permission: SpendPermission = buildSpendPermission({
  account: treasury,
  spender: agent,
  token: USDC,
  allowance: 2n * ONE,
  periodSeconds: 86_400,
  start: nowSec,
  end: nowSec + 3_600,
  salt: BigInt(`0x${randomBytes(16).toString('hex')}`),
});
const valid = validateSpendPermission(permission, {
  ownerAddress: treasury,
  agentWalletAddress: agent,
  usdcAddress: USDC,
  now: nowSec,
});
if (!valid.ok) throw new Error(`validateSpendPermission: ${JSON.stringify(valid.error)}`);
const typedData = prepareTypedData(permission, CHAIN_ID, MANAGER);
const signature = (await ownerWallet.signTypedData(typedData)) as Hex;
const kind = await assertSmartWalletAccount(pc, { typedData, signature });
if (!kind.ok) throw new Error(`D-5 check: ${kind.error}`);
console.log(
  `permission hash: ${spendPermissionHash(permission, CHAIN_ID, MANAGER)} (${kind.value})`,
);

// ── 3. senders ───────────────────────────────────────────────────────────────────────────────────
// The CDP smart account fills BOTH ports: the Phase 2 `ApprovalSender` (one approveWithSignature)
// and the Phase 5 `TxSender` the executor owns (the whole Call[] as one batched user operation).
const approvalSender: ApprovalSender = {
  getAddress: () => agent,
  sendTransaction: async ({ to, data, value }) => {
    const op = await cdp.evm.sendUserOperation({
      smartAccount: agentAccount,
      network: NETWORK,
      calls: [{ to, data, value }],
    });
    return op.userOpHash as Hex;
  },
  waitForTransactionReceipt: (userOpHash) =>
    cdp.evm.waitForUserOperation({ smartAccountAddress: agent, userOpHash }),
};

const sender: TxSender = {
  getAddress: () => agent,
  async send(calls: readonly Call[]) {
    const op = await cdp.evm.sendUserOperation({
      smartAccount: agentAccount,
      network: NETWORK,
      calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })),
    });
    const result = (await cdp.evm.waitForUserOperation({
      smartAccountAddress: agent,
      userOpHash: op.userOpHash,
    })) as { status: string; transactionHash?: string };
    if (result.status !== 'complete')
      throw new Error(`user operation ${op.userOpHash} status ${result.status}`);
    // Both hashes are stored (CDP gives the userOp hash first, the tx hash after).
    return {
      userOpHash: op.userOpHash as Hex,
      ...(result.transactionHash ? { txHash: result.transactionHash as Hex } : {}),
    };
  },
};

step('3', 'ensureApprovedOnchain');
const approved = await ensureApprovedOnchain({
  publicClient: pc,
  sender: approvalSender,
  manager: MANAGER,
  permission,
  signature,
});
if (!approved.ok) throw new Error(approved.error);
console.log(`approve: ${approved.value.status}`);

// ── 4. database rows ─────────────────────────────────────────────────────────────────────────────
step('4', 'persist wallet + active policy (the executor reads both fresh from the DB)');
const { db, pool } = createDb(DATABASE_URL);

const policy = {
  version: 1,
  walletId: '', // filled once the wallet row exists
  chainId: CHAIN_ID,
  treasuryAddress: treasury,
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
  vaults: [
    {
      id: 'v1',
      name: 'Steward Demo Vault',
      address: VAULT,
      asset: USDC,
      kind: 'erc4626',
      maxAllocationBps: 10_000,
    },
  ],
  recipients: [{ id: 'alex', label: 'Alex', address: ALEX, maxPerTxMicroUsd: ONE }],
  limits: { perTxMicroUsd: 2n * ONE, dailyMicroUsd: 5n * ONE, maxActionsPerHour: 20 },
  runwayBufferMicroUsd: 0n,
  approvalThresholdMicroUsd: 2n * ONE,
  depegThresholdBps: 100,
  vaultDrawdownBps: 500,
  autonomousKinds: ['pull_allowance', 'vault_deposit', 'pay_recipient', 'sweep_home', 'noop'],
  createdAt: new Date().toISOString(),
  signedBy: treasury,
  signature: '0xdeadbeef',
} as unknown as Policy;

const [user] = await db
  .insert(schema.users)
  .values({ ownerAddress: treasury })
  .onConflictDoUpdate({ target: schema.users.ownerAddress, set: { lastLoginAt: new Date() } })
  .returning();
const [walletRow] = await db
  .insert(schema.wallets)
  .values({
    userId: user!.id,
    chainId: CHAIN_ID,
    treasuryAddress: treasury,
    agentWalletAddress: agent,
    activePolicyVersion: 1,
  })
  .onConflictDoUpdate({
    target: schema.wallets.agentWalletAddress,
    set: {
      treasuryAddress: treasury,
      userId: user!.id,
      frozen: false,
      breakerOpen: false,
      breakerFailures: 0,
    },
  })
  .returning();
const walletId = walletRow!.id;
policy.walletId = walletId;

// One active policy per wallet (partial unique index): supersede any previous run's.
await db.update(schema.policies).set({ status: 'superseded' }).where(eqWallet(walletId));
const version = Math.floor(Date.now() / 1000);
policy.version = version;
await db.insert(schema.policies).values({
  walletId,
  version,
  body: JSON.parse(JSON.stringify(policy, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
  bodyHash: `0x${randomBytes(32).toString('hex')}`,
  status: 'active',
});
await db.update(schema.wallets).set({ activePolicyVersion: version }).where(eqWalletId(walletId));
console.log(`wallet ${walletId} · policy v${version} · agent ${agent}`);

// ── 5. the price quote (5.2) ─────────────────────────────────────────────────────────────────────
step('5', 'oracle (MockPriceFeed, I11-fenced)');
let quote: PriceQuote | undefined;
const adapter = mockPriceFeedAdapter({
  publicClient: pc,
  feed: FEED,
  token: USDC,
  chainId: CHAIN_ID,
  demoMode: true,
});
if (adapter.ok) {
  const read = await adapter.value.getPrice(USDC);
  if (read.ok) {
    const ageSec = Math.round((Date.now() - read.value.publishedAt.getTime()) / 1000);
    console.log(
      `${read.value.source}: $${formatUnits(read.value.microUsd, 6)} published ${ageSec}s ago (demo=${read.value.demo})`,
    );
    // R12 refuses a quote older than 60 s. A stale demo feed is not an excuse to skip the rule: we
    // fall back to the fenced I11 parity instead, which the engine only honours on 84532.
    if (ageSec <= 45)
      quote = { microUsd: read.value.microUsd, publishedAt: read.value.publishedAt };
    else console.log('  quote is stale for R12 → using the fenced DEMO parity fallback (I11)');
  } else console.log(`feed read failed (${read.error}) → DEMO parity fallback`);
}

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────────
type RunResult = { executionId: string; userOpHash?: string | null; txHash?: string | null };

async function runThroughPolicy(
  label: string,
  proposal: Proposal,
  opts: { recipient?: Address } = {},
): Promise<RunResult> {
  const [decision] = await db
    .insert(schema.agentDecisions)
    .values({
      walletId,
      trigger: 'owner',
      contextSnapshot: { live: label },
      contextHash: `0x${randomBytes(32).toString('hex')}`,
      proposal: JSON.parse(
        JSON.stringify(proposal, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      ),
      proposalHash: hashProposal(proposal),
      proposalSource: proposal.source,
      status: 'allowed',
    })
    .returning();
  const decisionId = decision!.id;

  const agentUsdc = await usdcBalance(agent);
  const treasuryUsdc = await usdcBalance(treasury);
  const shares = await vaultShares(agent);
  const redeemable = await maxWithdraw(agent);
  const allowance = await readAllowanceRemaining(pc, MANAGER, permission);
  if (!allowance.ok) throw new Error(allowance.error);

  const buildContext = {
    agentWalletAddress: agent,
    spendPermissionManagerAddress: MANAGER,
    spendPermission: permission,
    agentUsdcBalance: agentUsdc,
    vaultPositions: { v1: { shares, redeemableAssets: redeemable } },
    allowMainnet: false,
  };
  const built = buildCalls(proposal, policy, buildContext);
  if (!built.ok) throw new Error(`${label}: buildCalls ${built.error.code} ${built.error.message}`);
  const hash = callsHash(built.value);

  // --- simulate the exact calls (5.1) ---
  const simulated = await simulateProposalCalls({
    publicClient: pc,
    calls: built.value,
    from: agent,
    token: USDC,
    holders: { agent, treasury, recipient: opts.recipient },
  });
  if (!simulated.ok) throw new Error(`${label}: simulation ${simulated.error.code}`);
  await db.insert(schema.simulations).values({
    decisionId,
    calls: built.value.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
    callsHash: hash,
    ok: simulated.value.ok,
    deltas: simulated.value.deltas.map((d) => ({ ...d, delta: d.delta.toString() })),
    error: simulated.value.error ?? null,
    blockNumber: simulated.value.blockNumber,
  });
  console.log(
    `${label}: simulation ok=${simulated.value.ok} deltas ${simulated.value.deltas
      .map((d) => `${d.holder}:${d.delta}`)
      .join(' ')}${simulated.value.error ? ` (${simulated.value.error})` : ''}`,
  );
  if (!simulated.value.ok) throw new Error(`${label}: simulation failed`);

  // --- the REAL policy engine ---
  const verdict = evaluate({
    policy,
    proposal,
    now: new Date(),
    chainId: CHAIN_ID,
    allowMainnet: false,
    demoStableParity: quote === undefined,
    state: {
      frozen: false,
      breakerOpen: false,
      agentUsdc,
      treasuryUsdc,
      allowanceRemaining: allowance.value,
      vaultPositions: { v1: redeemable },
      prices: quote === undefined ? {} : { [USDC]: quote },
      contractHasCode: { [VAULT]: true, [USDC]: true },
      riskTriggers: [],
    },
    ledger: { outflowsLast24hMicroUsd: 0n, actionsLastHour: 0, recentProposalHashes: [] },
    simulation: {
      ok: simulated.value.ok,
      deltas: simulated.value.deltas,
      approvals: simulated.value.approvals,
    },
    verifier: null,
    screen: { injectionSuspected: false, signals: [] },
    contextFactIds: [],
    ownerApproval: null,
  });
  await db.insert(schema.verdicts).values({
    decisionId,
    decision: verdict.decision,
    results: verdict.results,
    policyVersion: verdict.policyVersion,
  });
  console.log(
    `${label}: verdict ${verdict.decision} — ${
      verdict.results
        .filter((r) => r.result !== 'PASS')
        .map((r) => `${r.code}:${r.result}`)
        .join(', ') || 'all rules PASS'
    }`,
  );
  if (verdict.decision !== 'ALLOW') throw new Error(`${label}: policy said ${verdict.decision}`);

  const receipt = signReceipt(verdict, RECEIPT_KEY, new Date(), randomUUID(), { callsHash: hash });
  if (!receipt.ok) throw new Error(`${label}: signReceipt ${receipt.error.code}`);

  const result = await execute(
    { db, sender, receiptKey: RECEIPT_KEY, now: () => new Date() },
    {
      walletId,
      decisionId,
      proposal,
      policy,
      receipt: receipt.value,
      buildContext,
      simulatedCallsHash: hash,
    },
  );
  if (!result.ok)
    throw new Error(`${label}: executor ${result.error.code} ${result.error.message}`);
  if (result.value.status !== 'submitted')
    throw new Error(`${label}: executor returned ${result.value.status}`);
  const execution = result.value.execution;
  console.log(
    `${label}: submitted execution ${execution.id} userOp ${execution.userOpHash} tx ${execution.txHash}`,
  );
  if (execution.txHash) console.log(`  ${explorer(execution.txHash)}`);

  const confirmed = await confirmExecution(
    { db, publicClient: pc, now: () => new Date(), timeoutMs: 180_000, pollIntervalMs: 3_000 },
    {
      executionId: execution.id,
      token: USDC,
      holders: { agent, treasury, recipient: opts.recipient },
      expectedDeltas: proposal.expectedDeltas,
    },
  );
  if (!confirmed.ok) throw new Error(`${label}: confirmer ${confirmed.error}`);
  console.log(
    `${label}: ${confirmed.value.status}${confirmed.value.status === 'failed' ? ` — ${confirmed.value.reason}` : ''}`,
  );
  if (confirmed.value.status !== 'confirmed') throw new Error(`${label}: not confirmed`);

  return {
    executionId: execution.id,
    userOpHash: execution.userOpHash,
    txHash: confirmed.value.execution.txHash,
  };
}

// ── 6. pull 1 USDC ───────────────────────────────────────────────────────────────────────────────
step('6', 'pull_allowance 1 USDC (funds the agent through the on-chain cap)');
const pull = await runThroughPolicy('pull_allowance', {
  kind: 'pull_allowance',
  params: { amount: ONE },
  expectedDeltas: [
    { token: USDC, holder: 'agent', delta: ONE },
    { token: USDC, holder: 'treasury', delta: -ONE },
  ],
  rationale: 'Fund the agent wallet within the owner-granted allowance.',
  citedFactIds: [],
  confidence: 1,
  source: 'deterministic',
});

// ── 7. deposit ───────────────────────────────────────────────────────────────────────────────────
step('7', 'vault_deposit 0.6 USDC into MockVault');
const depositAmount = 600_000n;
const deposit = await runThroughPolicy('vault_deposit', {
  kind: 'vault_deposit',
  params: { vaultId: 'v1', amount: depositAmount },
  expectedDeltas: [{ token: USDC, holder: 'agent', delta: -depositAmount }],
  rationale: 'Put idle cash to work in the allowlisted vault.',
  citedFactIds: [],
  confidence: 1,
  source: 'deterministic',
});
console.log(`agent shares: ${await vaultShares(agent)}`);

// ── 8. payment ───────────────────────────────────────────────────────────────────────────────────
step('8', 'pay_recipient 0.2 USDC to the allowlisted recipient');
const payAmount = 200_000n;
const payment = await runThroughPolicy(
  'pay_recipient',
  {
    kind: 'pay_recipient',
    params: { recipientId: 'alex', amount: payAmount },
    expectedDeltas: [
      { token: USDC, holder: 'agent', delta: -payAmount },
      { token: USDC, holder: 'recipient', delta: payAmount },
    ],
    rationale: 'Scheduled payment to an allowlisted recipient.',
    citedFactIds: [],
    confidence: 1,
    source: 'deterministic',
  },
  { recipient: ALEX },
);

// ── 9. sweep home (owner path, while frozen) ─────────────────────────────────────────────────────
step('9', 'sweepHome — owner path, executed WHILE FROZEN (I7)');
await db
  .update(schema.wallets)
  .set({ frozen: true, frozenAt: new Date(), frozenReason: 'live e2e freeze' })
  .where(eqWalletId(walletId));
const [sweepDecision] = await db
  .insert(schema.agentDecisions)
  .values({
    walletId,
    trigger: 'owner',
    contextSnapshot: { live: 'sweep' },
    contextHash: `0x${randomBytes(32).toString('hex')}`,
    proposalSource: 'owner',
    status: 'allowed',
  })
  .returning();

const beforeSweep = { agent: await usdcBalance(agent), treasury: await usdcBalance(treasury) };
const swept = await sweepHome(
  {
    db,
    publicClient: pc,
    sender,
    receiptKey: RECEIPT_KEY,
    now: () => new Date(),
    spendPermissionManagerAddress: MANAGER,
    decisionId: sweepDecision!.id,
    ...(quote === undefined ? {} : { usdcQuote: quote }),
  },
  walletId,
);
if (!swept.ok) throw new Error(`sweepHome: ${swept.error.code} ${swept.error.message}`);
console.log(`sweep verdict: ${swept.value.verdict.decision}`);
const sweepExecution =
  swept.value.execution && 'execution' in swept.value.execution
    ? swept.value.execution.execution
    : undefined;
console.log(
  `sweep execution ${sweepExecution?.id} userOp ${sweepExecution?.userOpHash} tx ${sweepExecution?.txHash}`,
);
if (sweepExecution?.txHash) console.log(`  ${explorer(sweepExecution.txHash)}`);

const afterSweep = { agent: await usdcBalance(agent), treasury: await usdcBalance(treasury) };
console.log(
  `agent ${formatUnits(beforeSweep.agent, 6)} → ${formatUnits(afterSweep.agent, 6)} USDC | ` +
    `treasury ${formatUnits(beforeSweep.treasury, 6)} → ${formatUnits(afterSweep.treasury, 6)} USDC | ` +
    `shares ${await vaultShares(agent)}`,
);

// ── summary ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n── summary ─────────────────────────────────────────────────────────────');
console.log(`user ${USER_ID} · wallet ${walletId} · agent ${agent} · treasury ${treasury}`);
for (const [label, r] of [
  ['pull_allowance', pull],
  ['vault_deposit', deposit],
  ['pay_recipient', payment],
] as const)
  console.log(`${label.padEnd(15)} execution ${r.executionId}  tx ${r.txHash}`);
console.log(`sweep_home      execution ${sweepExecution?.id}  tx ${sweepExecution?.txHash}`);

await pool.end();
