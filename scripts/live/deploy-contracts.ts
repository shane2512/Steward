// Deploy MockVault + MockPriceFeed to Base Sepolia through the CDP SDK.
//
// No private key ever touches disk or a log line: the deployer/owner is a CDP server account named
// `steward-demo-admin`, funded from the CDP faucet. Later demo scripts call simulateYield /
// simulateLoss / setPrice as that same account, again through CDP.
//
//   STEWARD_LIVE=1 pnpm contracts:deploy
import {
  concatHex,
  encodeAbiParameters,
  encodeDeployData,
  erc20Abi,
  formatUnits,
  getAddress,
  getCreate2Address,
  type Abi,
  type Address,
} from 'viem';
import {
  artifact,
  CHAIN_ID,
  cdpClient,
  DEMO_ADMIN_ACCOUNT,
  explorerAddress,
  loadEnv,
  NETWORK,
  publicClient,
  requireLive,
  USDC,
  waitFor,
} from './lib';

requireLive('deploy-contracts');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));

const cdp = cdpClient();
const pc = publicClient();

const admin = await cdp.evm.getOrCreateAccount({ name: DEMO_ADMIN_ACCOUNT });
const owner = getAddress(admin.address);
console.log(`demo admin (contract owner): ${owner}`);
console.log(`  ${explorerAddress(owner)}`);

// Deployment costs gas; the faucet tops the admin up if needed.
if ((await pc.getBalance({ address: owner })) === 0n) {
  const f = await cdp.evm.requestFaucet({ address: owner, network: NETWORK, token: 'eth' });
  console.log(`faucet ETH: ${f.transactionHash}`);
  await waitFor(async () => (await pc.getBalance({ address: owner })) > 0n);
}
console.log(`admin ETH: ${await pc.getBalance({ address: owner })} wei`);

/**
 * CDP's `sendTransaction` rejects a contract-creation transaction — its validator requires a `to`
 * ("Malformed unsigned EIP-1559 transaction", both for the object form and for a serialized one).
 * So we deploy through the canonical deterministic-deployment proxy (Arachnid's CREATE2 factory,
 * verified present on Base Sepolia), which takes `salt ‖ initCode` as calldata. That is an ordinary
 * `to`-bearing transaction, so CDP signs it happily and no private key is ever created locally.
 * Bonus: the address is deterministic, and re-running is a no-op instead of a second deployment.
 */
const CREATE2_PROXY = getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C');
const SALT = `0x${'00'.repeat(31)}01` as const; // steward v1

async function deploy(name: string, args: unknown[], types: { type: string }[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const initCode = encodeDeployData({ abi: abi as Abi, bytecode, args });
  // Sanity: the encoded args must round-trip, so a constructor mismatch fails here, not on-chain.
  encodeAbiParameters(types, args);

  const address = getCreate2Address({ from: CREATE2_PROXY, salt: SALT, bytecode: initCode });
  const existing = await pc.getCode({ address });
  if (existing && existing !== '0x') {
    console.log(`\n${name}: ${address} (already deployed, skipping)`);
    return address;
  }

  const data = concatHex([SALT, initCode]);
  const { transactionHash } = await cdp.evm.sendTransaction({
    address: owner,
    network: NETWORK,
    transaction: { to: CREATE2_PROXY, data, value: 0n },
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success')
    throw new Error(`${name} deployment failed: ${transactionHash}`);
  // The load-balanced RPC can answer from a node that has not applied the block yet, so poll rather
  // than reading once (a single read here reported "no code" for an already-deployed contract).
  const landed = await waitFor(async () => ((await pc.getCode({ address })) ?? '0x') !== '0x');
  if (!landed) throw new Error(`${name}: no code at the CREATE2 address ${address}`);

  console.log(`\n${name}: ${address}`);
  console.log(`  deploy tx: ${transactionHash}`);
  console.log(`  ${explorerAddress(address)}`);
  return address;
}

const vault = await deploy(
  'MockVault',
  [USDC, 'Steward Mock Vault', 'svUSDC', owner],
  [{ type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'address' }],
);
const feed = await deploy(
  'MockPriceFeed',
  ['USDC/USD', 1_000_000n, owner],
  [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }],
);

// --- verify on-chain, rather than trusting the receipt ------------------------------------------
const vaultAbi = artifact('MockVault').abi as Abi;
const feedAbi = artifact('MockPriceFeed').abi as Abi;
const read = <T>(address: Address, abi: Abi, functionName: string) =>
  pc.readContract({ address, abi, functionName }) as Promise<T>;

const checks: [string, boolean, string][] = [];
const vaultCode = await pc.getCode({ address: vault });
const feedCode = await pc.getCode({ address: feed });
const vaultOwner = await read<Address>(vault, vaultAbi, 'owner');
const vaultAsset = await read<Address>(vault, vaultAbi, 'asset');
const vaultDecimals = await read<number>(vault, vaultAbi, 'decimals');
const feedOwner = await read<Address>(feed, feedAbi, 'owner');
const feedPrice = await read<bigint>(feed, feedAbi, 'microUsd');
const usdcDecimals = await pc.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: 'decimals',
});

checks.push([
  'MockVault has code',
  (vaultCode?.length ?? 2) > 2,
  `${(vaultCode?.length ?? 2) / 2 - 1} bytes`,
]);
checks.push([
  'MockPriceFeed has code',
  (feedCode?.length ?? 2) > 2,
  `${(feedCode?.length ?? 2) / 2 - 1} bytes`,
]);
checks.push(['vault.owner() == demo admin', getAddress(vaultOwner) === owner, vaultOwner]);
checks.push(['vault.asset() == USDC', getAddress(vaultAsset) === USDC, vaultAsset]);
checks.push([
  'vault.decimals() == USDC decimals',
  vaultDecimals === usdcDecimals,
  String(vaultDecimals),
]);
checks.push(['feed.owner() == demo admin', getAddress(feedOwner) === owner, feedOwner]);
checks.push(['feed price == $1.00', feedPrice === 1_000_000n, `$${formatUnits(feedPrice, 6)}`]);

console.log('\non-chain verification');
for (const [label, ok, detail] of checks)
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label} — ${detail}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);

console.log(`\nchainId ${CHAIN_ID}. Add to .env.local and docs/addresses.md:`);
console.log(`MOCK_VAULT_ADDRESS=${vault}`);
console.log(`MOCK_PRICE_FEED_ADDRESS=${feed}`);
