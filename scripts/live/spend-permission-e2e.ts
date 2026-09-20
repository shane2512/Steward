// LIVE Base Sepolia end-to-end test of the Phase 2 wallet layer, using the PRODUCT code in
// packages/wallet (not the Phase 0 spikes).
//
//   STEWARD_LIVE=1 pnpm live:spend-permission
//
// Flow:
//   1. provision the agent wallet through the real CDP client (the provisioning path from 2.3, with
//      an in-memory stand-in for the DB so the script needs no Postgres)
//   2. build a SpendPermission with the product encoders and have a REAL Coinbase Smart Wallet sign it
//   3. ensureApprovedOnchain  → approveWithSignature
//   4. buildCalls(pull_allowance) → spend 1 USDC from the treasury into the agent wallet
//   5. owner revokes, and the same spend is attempted again — it must fail
//
// Why an ephemeral local key owns the smart wallet: a Spend Permission must be granted by a contract
// wallet whose owner set includes the SpendPermissionManager (D-5, V-05). The passkey popup normally
// does the deploy + addOwnerAddress; the human has no passkey wallet available (see PROGRESS V-10), so
// this script builds a genuine Coinbase Smart Wallet with viem's `toCoinbaseSmartAccount` and an
// owner key generated in memory for this run only. The key is never written to disk or logged; it is
// throwaway test-wallet material on a testnet. The signing path exercised (ERC-1271/6492 typed data,
// approveWithSignature, spend, revoke) is identical to the one a passkey wallet takes.
import { randomBytes } from 'node:crypto';
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
import type { Policy, Proposal } from '@steward/shared';
import {
  buildCalls,
  buildSpendPermission,
  ensureApprovedOnchain,
  encodeRevoke,
  assertSmartWalletAccount,
  isRevoked,
  prepareTypedData,
  readAllowanceRemaining,
  serializeSpendPermission,
  spendPermissionHash,
  validateSpendPermission,
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

requireLive('spend-permission-e2e');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));

const cdp = cdpClient();
const pc = publicClient();
const ONE_USDC = 1_000_000n;
const step = (n: number, s: string) =>
  console.log(`\n── ${n}. ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
const usdcBalance = (a: Address) =>
  pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

// ── 1. agent wallet ──────────────────────────────────────────────────────────────────────────────
step(1, 'provision the agent wallet (real CDP, product naming from D-3)');

// `provisionAgentWallet` persists through @steward/db; this script has no Postgres, so it calls the
// same two CDP operations with the same derived names, then reports what the product function stores.
const { cdpAccountNames } = await import('@steward/wallet');
const USER_ID = '11111111-2222-4333-8444-555555555555'; // fixed, so re-runs reuse the same wallet
const names = cdpAccountNames(USER_ID);
if (!names.ok) throw new Error(names.error);
const agentOwner = await cdp.evm.getOrCreateAccount({ name: names.value.owner });
const agentAccount = await cdp.evm.getOrCreateSmartAccount({
  name: names.value.smartAccount,
  owner: agentOwner,
});
const agent = getAddress(agentAccount.address);
console.log(
  `agent wallet: ${agent}  (cdp names ${names.value.owner} / ${names.value.smartAccount})`,
);

// ── 2. owner smart wallet ────────────────────────────────────────────────────────────────────────
step(2, 'owner Coinbase Smart Wallet + signed SpendPermission');
const ownerKey = privateKeyToAccount(generatePrivateKey()); // in memory only, never printed
const ownerWallet = await toCoinbaseSmartAccount({
  client: pc,
  owners: [ownerKey],
  version: '1.1',
});
const treasury = getAddress(ownerWallet.address);
console.log(`owner treasury (Coinbase Smart Wallet): ${treasury}`);

if ((await usdcBalance(treasury)) < 2n * ONE_USDC) {
  const f = await cdp.evm.requestFaucet({ address: treasury, network: NETWORK, token: 'usdc' });
  console.log(`faucet USDC: ${f.transactionHash}`);
  await waitFor(async () => (await usdcBalance(treasury)) >= ONE_USDC);
}
if ((await pc.getBalance({ address: ownerKey.address })) === 0n) {
  const f = await cdp.evm.requestFaucet({
    address: ownerKey.address,
    network: NETWORK,
    token: 'eth',
  });
  console.log(`faucet ETH (owner EOA, pays for the wallet deploy): ${f.transactionHash}`);
  await waitFor(async () => (await pc.getBalance({ address: ownerKey.address })) > 0n);
}
console.log(`treasury USDC: ${formatUnits(await usdcBalance(treasury), 6)}`);

// Deploy the smart wallet and add the manager as an owner — this is what the Coinbase passkey popup
// does for a real user when they approve a spend permission for the first time (V-05).
const wc = createWalletClient({
  account: ownerKey,
  chain: baseSepolia,
  transport: http(process.env['RPC_URL_BASE_SEPOLIA']),
});
if (((await pc.getCode({ address: treasury })) ?? '0x') === '0x') {
  const factory = await ownerWallet.getFactoryArgs();
  const h = await wc.sendTransaction({ to: factory.factory!, data: factory.factoryData! });
  await confirm(pc, h, 'smart wallet deploy');
  // Wait for the code to be visible before the next call: otherwise gas is estimated against a node
  // that still sees an EOA (~22k) and addOwnerAddress runs out of gas and silently reverts.
  await waitForCode(pc, treasury);
  console.log(`smart wallet deployed: ${explorer(h)}`);
}

const swAbi = parseAbi([
  'function isOwnerAddress(address account) view returns (bool)',
  'function addOwnerAddress(address owner)',
  'function execute(address target, uint256 value, bytes data)',
]);
const managerIsOwner = () =>
  pc.readContract({
    address: treasury,
    abi: swAbi,
    functionName: 'isOwnerAddress',
    args: [MANAGER],
  });
if (!(await managerIsOwner())) {
  const h2 = await wc.sendTransaction({
    to: treasury,
    data: encodeFunctionData({ abi: swAbi, functionName: 'addOwnerAddress', args: [MANAGER] }),
  });
  await confirm(pc, h2, 'addOwnerAddress');
  console.log(`SpendPermissionManager added as wallet owner: ${explorer(h2)}`);
}
// Verified, not assumed: without this the manager cannot execute on the account and `spend` reverts
// with Unauthorized() (0x82b42900). Polled, because the read can hit a lagging node.
if (!(await waitFor(managerIsOwner)))
  throw new Error('SpendPermissionManager is not an owner of the treasury wallet');
console.log('manager is an owner of the treasury wallet: true');

const now = Math.floor(Date.now() / 1000);
const permission: SpendPermission = buildSpendPermission({
  account: treasury,
  spender: agent,
  token: USDC,
  allowance: 5n * ONE_USDC,
  periodSeconds: 86_400,
  start: now,
  end: now + 3_600,
  salt: BigInt(`0x${randomBytes(16).toString('hex')}`),
});

const valid = validateSpendPermission(permission, {
  ownerAddress: treasury,
  agentWalletAddress: agent,
  usdcAddress: USDC,
  now,
});
if (!valid.ok)
  throw new Error(`validateSpendPermission rejected it: ${JSON.stringify(valid.error)}`);
console.log(`permission hash: ${spendPermissionHash(permission, CHAIN_ID, MANAGER)}`);
console.log(`terms: ${JSON.stringify(serializeSpendPermission(permission))}`);

const typedData = prepareTypedData(permission, CHAIN_ID, MANAGER);
const signature = (await ownerWallet.signTypedData(typedData)) as Hex;
const kind = await assertSmartWalletAccount(pc, { typedData, signature });
if (!kind.ok) throw new Error(`D-5 check rejected the owner account: ${kind.error}`);
console.log(`D-5 owner-account check: ${kind.value} (signature ${signature.length} hex chars)`);

// ── 3. ensureApprovedOnchain ─────────────────────────────────────────────────────────────────────
step(3, 'ensureApprovedOnchain (approveWithSignature, first use)');

/** Adapter from the CDP smart account to the narrow TxSender the product code accepts. */
const sender: TxSender = {
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

const approved = await ensureApprovedOnchain({
  publicClient: pc,
  sender,
  manager: MANAGER,
  permission,
  signature,
});
if (!approved.ok) throw new Error(approved.error);
console.log(`approve: ${approved.value.status}`);
if (approved.value.status === 'approved') {
  const r = (await cdp.evm.waitForUserOperation({
    smartAccountAddress: agent,
    userOpHash: approved.value.userOpHash,
  })) as { status: string; transactionHash?: string };
  console.log(
    `  userOp ${r.status} → tx ${r.transactionHash} ${explorer(r.transactionHash ?? '')}`,
  );
}
const idempotent = await ensureApprovedOnchain({
  publicClient: pc,
  sender,
  manager: MANAGER,
  permission,
  signature,
});
console.log(`second call (idempotency): ${idempotent.ok && idempotent.value.status}`);

// ── 4. pull 1 USDC through buildCalls ────────────────────────────────────────────────────────────
step(4, 'buildCalls(pull_allowance) → spend 1 USDC');

// The minimal Policy the action registry resolves addresses from. Phase 3 builds the real one.
const policy = {
  version: 1,
  walletId: USER_ID,
  chainId: CHAIN_ID,
  treasuryAddress: treasury,
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
  vaults: [],
  recipients: [],
  limits: { perTxMicroUsd: 5n * ONE_USDC, dailyMicroUsd: 5n * ONE_USDC, maxActionsPerHour: 10 },
  runwayBufferMicroUsd: 0n,
  approvalThresholdMicroUsd: 5n * ONE_USDC,
  depegThresholdBps: 100,
  vaultDrawdownBps: 500,
  autonomousKinds: ['pull_allowance'],
  createdAt: new Date().toISOString(),
  signedBy: treasury,
  signature: '0x',
} as unknown as Policy;

const proposal = {
  kind: 'pull_allowance',
  params: { amount: ONE_USDC },
  expectedDeltas: [],
  rationale: 'live e2e',
  citedFactIds: [],
  confidence: 1,
  source: 'deterministic',
} as unknown as Proposal;

const calls = buildCalls(proposal, policy, {
  agentWalletAddress: agent,
  spendPermissionManagerAddress: MANAGER,
  spendPermission: permission,
  agentUsdcBalance: await usdcBalance(agent),
  vaultPositions: {},
  allowMainnet: false,
});
if (!calls.ok) throw new Error(`${calls.error.code}: ${calls.error.message}`);
console.log(`calls: ${calls.value.map((c) => `${c.to} (${c.data.slice(0, 10)})`).join(', ')}`);

const before = { treasury: await usdcBalance(treasury), agent: await usdcBalance(agent) };
const spendOp = await cdp.evm.sendUserOperation({
  smartAccount: agentAccount,
  network: NETWORK,
  calls: calls.value.map((c) => ({ to: c.to, data: c.data, value: c.value })),
});
const spendResult = (await cdp.evm.waitForUserOperation({
  smartAccountAddress: agent,
  userOpHash: spendOp.userOpHash,
})) as { status: string; transactionHash?: string };
console.log(`spend: ${spendResult.status} → tx ${spendResult.transactionHash}`);
console.log(`  ${explorer(spendResult.transactionHash ?? '')}`);

const after = { treasury: await usdcBalance(treasury), agent: await usdcBalance(agent) };
console.log(
  `treasury ${formatUnits(before.treasury, 6)} → ${formatUnits(after.treasury, 6)} USDC | ` +
    `agent ${formatUnits(before.agent, 6)} → ${formatUnits(after.agent, 6)} USDC`,
);
if (after.agent - before.agent !== ONE_USDC)
  throw new Error('agent did not receive exactly 1 USDC');

const remaining = await readAllowanceRemaining(pc, MANAGER, permission);
console.log(
  `allowance remaining: ${remaining.ok ? formatUnits(remaining.value, 6) : remaining.error} USDC`,
);

// ── 5. revoke, then prove the spend fails ────────────────────────────────────────────────────────
step(5, 'owner revokes → the same spend must fail');
const revokeHash = await wc.sendTransaction({
  to: treasury,
  data: encodeFunctionData({
    abi: swAbi,
    functionName: 'execute',
    args: [MANAGER, 0n, encodeRevoke(permission)],
  }),
});
await confirm(pc, revokeHash, 'owner revoke');
console.log(`owner revoke tx: ${revokeHash}`);
console.log(`  ${explorer(revokeHash)}`);

// Polled: the revoke is confirmed on-chain, but a read can still hit a node one block behind.
const sawRevoked = await waitFor(async () => {
  const r = await isRevoked(pc, MANAGER, permission);
  return r.ok && r.value;
});
console.log(`isRevoked: ${sawRevoked}`);
if (!sawRevoked) throw new Error('permission still not revoked');

let postRevoke: string;
try {
  const op = await cdp.evm.sendUserOperation({
    smartAccount: agentAccount,
    network: NETWORK,
    calls: calls.value.map((c) => ({ to: c.to, data: c.data, value: c.value })),
  });
  const r = (await cdp.evm.waitForUserOperation({
    smartAccountAddress: agent,
    userOpHash: op.userOpHash,
  })) as { status: string };
  postRevoke = `userOp status ${r.status}`;
  if (r.status === 'complete')
    throw new Error('POST-REVOKE SPEND SUCCEEDED — allowance not enforced');
} catch (e) {
  postRevoke = `rejected: ${String((e as Error).message).slice(0, 140)}`;
}
console.log(`post-revoke spend: ${postRevoke}`);

const finalAgent = await usdcBalance(agent);
if (finalAgent !== after.agent) throw new Error('agent balance changed after revoke');
console.log(`agent USDC unchanged after revoke: ${formatUnits(finalAgent, 6)}`);

// `ensureApprovedOnchain` must also refuse to re-approve a revoked permission.
const reApprove = await ensureApprovedOnchain({
  publicClient: pc,
  sender,
  manager: MANAGER,
  permission,
  signature,
});
console.log(`ensureApprovedOnchain on a revoked permission: ${!reApprove.ok && reApprove.error}`);

console.log('\nLIVE FLOW OK');
