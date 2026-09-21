// PHASE 6 LIVE — an UNATTENDED decision-loop run on Base Sepolia, through the real worker.
//
//   STEWARD_LIVE=1 pnpm live:loop [minutes]
//
// What this actually runs: `registerJobs()` from apps/worker, with real pg-boss cron, the real
// per-wallet advisory lock, the real ContextBuilder, the real PreChecks, the real Policy Engine,
// real `eth_simulateV1`, real AllowReceipts, the real executor sending real user operations through
// CDP, and the real confirmer. Nothing is stubbed. The script sets up the world, starts the worker,
// and then only WATCHES — it never proposes, evaluates or sends anything itself.
//
// Expected sequence with the demo policy below (treasury funded, agent empty, one obligation due
// today): `pull_allowance` to cover the obligation -> `pay_recipient` -> `pull_allowance` for the
// idle cash -> `vault_deposit`. PreChecks put a due obligation ahead of yield deliberately
// (6.2 priority b before c), which is why payroll lands before the deposit rather than after it as
// in the DEMO.md narration.
//
// Owner wallet: a genuine Coinbase Smart Wallet built with viem's `toCoinbaseSmartAccount` whose
// owner key is generated in memory for this run only — never written to disk, never logged.
import { randomBytes } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { eq } from 'drizzle-orm';
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
import { createDb, schema, verifyChain } from '@steward/db';
import { getEnv, type Policy } from '@steward/shared';
import {
  buildSpendPermission,
  ensureApprovedOnchain,
  prepareTypedData,
  serializeSpendPermission,
  spendPermissionHash,
  validateSpendPermission,
  type ApprovalSender,
  type SpendPermission,
} from '@steward/wallet';
import { registerJobs, resumeCrashWindow } from '../../apps/worker/src/jobs';
import {
  demoPriceRefresherFor,
  priceAdapterFor,
  publicClientFor,
  receiptKeyFor,
  senderFactory,
  servClientFor,
} from '../../apps/worker/src/runtime';
import { replay } from '../../apps/worker/src/replay';
import {
  CHAIN_ID,
  cdpClient,
  confirm,
  explorer,
  loadEnv,
  NETWORK,
  publicClient as rawPublicClient,
  requireLive,
  SPEND_PERMISSION_MANAGER as MANAGER,
  USDC,
  waitFor,
  waitForCode,
} from './lib';

requireLive('loop-e2e');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));

const MINUTES = Number(process.argv[2] ?? '10');
const ONE = 1_000_000n;
/** A fixed uuid so re-runs reuse the same CDP accounts (D-3) and the same agent wallet. */
const USER_ID = '55555555-6666-4777-8888-999999999999';

const env = getEnv();
const cdp = cdpClient();
const pc = rawPublicClient();
const VAULT = getAddress(env.MOCK_VAULT_ADDRESS ?? '0x3741f0da6dFFfFD8Be2353e326a49E41a3396485');
const ALEX = getAddress('0x1111111111111111111111111111111111111111');

const step = (n: string, s: string) =>
  console.log(`\n── ${n}. ${s} ${'─'.repeat(Math.max(0, 62 - s.length))}`);
const usdc = (a: Address) =>
  pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const vaultShares = (a: Address) =>
  pc.readContract({
    address: VAULT,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [a],
  });

if (!env.DEMO_MODE) throw new Error('this run expects DEMO_MODE=true (I11)');
if (env.CHAIN_ID !== 84532) throw new Error('testnet only (I8)');

// ── 1. the agent wallet (real CDP smart account) ─────────────────────────────────────────────────
step('1', 'agent wallet');
const senderFor = senderFactory(env);
const sender = await senderFor(USER_ID);
const agent = sender.getAddress();
console.log(`agent wallet: ${agent}`);

// ── 2. the owner treasury + spend permission ─────────────────────────────────────────────────────
step('2', 'owner Coinbase Smart Wallet grants a Spend Permission');
const ownerKey = privateKeyToAccount(generatePrivateKey()); // in memory only, never printed
const ownerWallet = await toCoinbaseSmartAccount({
  client: pc,
  owners: [ownerKey],
  version: '1.1',
});
const treasury = getAddress(ownerWallet.address);
console.log(`owner treasury: ${treasury}`);

const TARGET_TREASURY = 2n * ONE;
while ((await usdc(treasury)) < TARGET_TREASURY) {
  const before = await usdc(treasury);
  const f = await cdp.evm.requestFaucet({ address: treasury, network: NETWORK, token: 'usdc' });
  console.log(`faucet USDC -> treasury: ${f.transactionHash}`);
  if (!(await waitFor(async () => (await usdc(treasury)) > before))) break;
}
console.log(`treasury USDC: ${formatUnits(await usdc(treasury), 6)}`);

if ((await pc.getBalance({ address: ownerKey.address })) === 0n) {
  const f = await cdp.evm.requestFaucet({
    address: ownerKey.address,
    network: NETWORK,
    token: 'eth',
  });
  console.log(`faucet ETH -> owner EOA: ${f.transactionHash}`);
  await waitFor(async () => (await pc.getBalance({ address: ownerKey.address })) > 0n);
}

const wc = createWalletClient({
  account: ownerKey,
  chain: baseSepolia,
  transport: http(env.RPC_URL_BASE_SEPOLIA),
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
  end: nowSec + 6 * 3_600,
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
const permissionHash = spendPermissionHash(permission, CHAIN_ID, MANAGER);
console.log(`permission hash: ${permissionHash}`);

const approvalSender: ApprovalSender = {
  getAddress: () => agent,
  sendTransaction: async ({ to, data, value }) => {
    const op = await cdp.evm.sendUserOperation({
      smartAccount: await cdp.evm.getOrCreateSmartAccount({
        name: `sta-${USER_ID.replace(/-/g, '')}`,
        owner: await cdp.evm.getOrCreateAccount({ name: `sto-${USER_ID.replace(/-/g, '')}` }),
      }),
      network: NETWORK,
      calls: [{ to, data, value }],
    });
    return op.userOpHash as Hex;
  },
  waitForTransactionReceipt: (userOpHash) =>
    cdp.evm.waitForUserOperation({ smartAccountAddress: agent, userOpHash }),
};
const approved = await ensureApprovedOnchain({
  publicClient: pc,
  sender: approvalSender,
  manager: MANAGER,
  permission,
  signature,
});
if (!approved.ok) throw new Error(approved.error);
const approveTxHash: string | null =
  'txHash' in approved.value && typeof approved.value.txHash === 'string'
    ? approved.value.txHash
    : null;
console.log(`approveWithSignature: ${approved.value.status}`);

// ── 3. seed the database ─────────────────────────────────────────────────────────────────────────
step('3', 'seed wallet, policy, recipient and an obligation due today');
const { db, pool } = createDb(env.DATABASE_URL);

const policy = {
  version: Math.floor(Date.now() / 1000),
  walletId: '',
  chainId: CHAIN_ID,
  treasuryAddress: treasury,
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
  vaults: [
    {
      id: 'v1',
      name: 'Steward Demo USDC Vault',
      address: VAULT,
      asset: USDC,
      kind: 'erc4626',
      maxAllocationBps: 10_000,
    },
  ],
  recipients: [
    { id: 'alex', label: 'Alex (contractor)', address: ALEX, maxPerTxMicroUsd: ONE / 2n },
  ],
  limits: { perTxMicroUsd: ONE, dailyMicroUsd: 5n * ONE, maxActionsPerHour: 20 },
  // Scaled-down demo policy: the shape of DEMO.md's "Startup Operating" at faucet amounts.
  runwayBufferMicroUsd: ONE / 2n,
  approvalThresholdMicroUsd: 5n * ONE, // nothing should escalate on this run
  depegThresholdBps: 100,
  vaultDrawdownBps: 500,
  autonomousKinds: ['pull_allowance', 'vault_deposit', 'pay_recipient', 'risk_exit', 'noop'],
  createdAt: new Date().toISOString(),
  signedBy: treasury,
  signature: '0xdeadbeef',
} as unknown as Policy;

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as never;

await db
  .insert(schema.users)
  .values({ id: USER_ID, ownerAddress: treasury })
  .onConflictDoUpdate({ target: schema.users.id, set: { ownerAddress: treasury } });
const [walletRow] = await db
  .insert(schema.wallets)
  .values({
    userId: USER_ID,
    chainId: CHAIN_ID,
    treasuryAddress: treasury,
    agentWalletAddress: agent,
    activePolicyVersion: policy.version,
  })
  .onConflictDoUpdate({
    target: schema.wallets.agentWalletAddress,
    set: {
      treasuryAddress: treasury,
      userId: USER_ID,
      frozen: false,
      breakerOpen: false,
      breakerFailures: 0,
      activePolicyVersion: policy.version,
    },
  })
  .returning();
const walletId = walletRow!.id;
policy.walletId = walletId;

await db
  .update(schema.policies)
  .set({ status: 'superseded' })
  .where(eq(schema.policies.walletId, walletId));
await db.insert(schema.policies).values({
  walletId,
  version: policy.version,
  body: json(policy),
  bodyHash: `0x${randomBytes(32).toString('hex')}`,
  status: 'active',
});
await db
  .insert(schema.vaults)
  .values({
    id: 'v1',
    walletId,
    name: 'Steward Demo USDC Vault',
    address: VAULT,
    assetAddress: USDC,
    kind: 'erc4626',
    maxAllocationBps: 10_000,
  })
  .onConflictDoUpdate({
    target: [schema.vaults.id, schema.vaults.walletId],
    set: { flagged: false, flaggedReason: null },
  });
await db.insert(schema.spendPermissions).values({
  walletId,
  permission: json(serializeSpendPermission(permission)),
  signature,
  permissionHash,
  status: 'approved_onchain',
  approvedTxHash: approveTxHash,
});

const [recipient] = await db
  .insert(schema.recipients)
  .values({ walletId, label: 'Alex (contractor)', address: ALEX, maxPerTx: ONE / 2n })
  .onConflictDoUpdate({
    target: [schema.recipients.walletId, schema.recipients.address],
    set: { status: 'active' },
  })
  .returning();
const today = new Date().toISOString().slice(0, 10);
await db.delete(schema.obligations).where(eq(schema.obligations.walletId, walletId));
await db.insert(schema.obligations).values({
  walletId,
  recipientId: recipient!.id,
  amount: ONE / 5n, // 0.2 USDC
  dueDate: today,
  recurrence: 'monthly',
});
console.log(`wallet ${walletId} · policy v${policy.version} · obligation 0.2 USDC due ${today}`);

// ── 4. refresh the demo oracle once, then start the worker ───────────────────────────────────────
step('4', 'demo oracle + the worker');
const publicClient = publicClientFor(env);
const demoPrice = demoPriceRefresherFor(env);
if (demoPrice) {
  const refreshed = await demoPrice.setPrice(ONE);
  console.log(
    refreshed.ok
      ? `price refreshed: ${explorer(refreshed.value)}`
      : `price refresh failed: ${refreshed.error}`,
  );
}

const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (e: unknown) => console.error('[pg-boss]', String(e)));
await boss.start();
const recovered = await resumeCrashWindow({ boss, db, publicClient });
console.log(`crash window: ${JSON.stringify(recovered)}`);

await registerJobs({
  boss,
  db,
  pool,
  env,
  publicClient,
  senderFor,
  receiptKey: receiptKeyFor(env),
  serv: servClientFor(env),
  priceAdapter: priceAdapterFor(env, publicClient),
  demoPrice,
});
console.log(`worker started · DEMO tick 30 s · running unattended for ${MINUTES} minutes`);

// ── 5. WATCH. This process does not decide anything from here on. ────────────────────────────────
step('5', `unattended (${MINUTES} min)`);
const startedAt = Date.now();
const deadline = startedAt + MINUTES * 60_000;
const seen = new Set<string>();

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000));
  const executions = await db
    .select()
    .from(schema.executions)
    .where(eq(schema.executions.walletId, walletId));
  for (const e of executions) {
    const key = `${e.id}:${e.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[t+${String(elapsed).padStart(4)}s] ${e.kind.padEnd(15)} ${e.status.padEnd(9)} ${
        e.txHash ? explorer(e.txHash) : (e.error ?? '')
      }`,
    );
  }
}

// ── 6. the report ────────────────────────────────────────────────────────────────────────────────
step('6', 'result');
await boss.stop({ graceful: true });

const decisions = await db
  .select()
  .from(schema.agentDecisions)
  .where(eq(schema.agentDecisions.walletId, walletId));
const executions = await db
  .select()
  .from(schema.executions)
  .where(eq(schema.executions.walletId, walletId));
const verdicts = await db.select().from(schema.verdicts);

console.log(`ran for ${Math.round((Date.now() - startedAt) / 1000)}s`);
console.log(
  `decisions ${decisions.length} · verdicts ${verdicts.length} · executions ${executions.length}`,
);
for (const d of decisions) {
  const v = verdicts.find((x) => x.decisionId === d.id);
  console.log(
    `  ${d.createdAt.toISOString()} ${d.trigger.padEnd(10)} ${d.proposalSource.padEnd(13)} ${d.status.padEnd(9)} ${v?.decision ?? ''} ${d.id}`,
  );
}
console.log('\nexecutions:');
for (const e of executions)
  console.log(`  ${e.kind.padEnd(15)} ${e.status.padEnd(9)} ${e.id}  ${e.txHash ?? e.error ?? ''}`);

const failures = executions.filter((e) => e.status !== 'confirmed');
console.log(`\nnon-confirmed executions: ${failures.length}`);

const chain = await verifyChain(db, walletId);
console.log(
  `audit chain: ${chain.ok ? `OK (${chain.value.rows} rows, head ${chain.value.head})` : `BROKEN ${JSON.stringify(chain.error)}`}`,
);

// NFR-4 on live data: every decision that reached a verdict must replay identically.
let replayed = 0;
let identical = 0;
for (const d of decisions) {
  const r = await replay(db, d.id, walletId);
  if (!r.ok) continue;
  replayed += 1;
  if (r.value.identical) identical += 1;
  else console.log(`  REPLAY DIFFERS for ${d.id}: ${r.value.differences.join('; ')}`);
}
console.log(`replayed ${identical}/${replayed} decisions identically (NFR-4)`);

const kinds = new Set(executions.filter((e) => e.status === 'confirmed').map((e) => e.kind));
console.log(`\nconfirmed kinds: ${[...kinds].join(', ') || '(none)'}`);
console.log(
  `agent ${formatUnits(await usdc(agent), 6)} USDC · shares ${await vaultShares(agent)} · treasury ${formatUnits(await usdc(treasury), 6)} USDC`,
);
console.log(`\nwallet ${walletId} · agent ${agent} · treasury ${treasury}`);

await pool.end();
process.exit(failures.length === 0 && chain.ok && identical === replayed ? 0 : 1);
