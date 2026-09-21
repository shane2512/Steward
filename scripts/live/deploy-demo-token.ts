// Deploy the DEMO-ONLY MockUSDC and a MockVault over it, and mint to a target address.
//
//   STEWARD_LIVE=1 npx tsx scripts/live/deploy-demo-token.ts [mintTo] [wholeTokens]
//
// Why this exists: Circle's testnet USDC comes from a CDP faucet that is rate-limited per project,
// which is not enough to run an unattended loop or rehearse a 3-minute demo. DEMO.md anticipates
// exactly this — "funded with testnet USDC (e.g. 200,000 via MockUSDC if faucet limits are too
// small — then USDC_ADDRESS points to MockUSDC; banner says DEMO DATA)".
//
// Nothing in product code changes: USDC_ADDRESS and MOCK_VAULT_ADDRESS are env values, and I11
// already fences DEMO_MODE to chain 84532, where the UI must show the DEMO DATA banner. Deployment
// goes through the same CREATE2 proxy as `deploy-contracts.ts`, owned by the `steward-demo-admin`
// CDP server account, so no private key is ever created locally.
import {
  concatHex,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
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
  waitFor,
} from './lib';

requireLive('deploy-demo-token');
loadEnv();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String(e)));

const cdp = cdpClient();
const pc = publicClient();
const CREATE2_PROXY = getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C');
/** A different salt from `deploy-contracts.ts` so the demo pair gets its own addresses. */
const SALT = `0x${'00'.repeat(31)}02` as const;

const admin = await cdp.evm.getOrCreateAccount({ name: DEMO_ADMIN_ACCOUNT });
const owner = getAddress(admin.address);
console.log(`demo admin (contract owner): ${owner}`);

if ((await pc.getBalance({ address: owner })) < 10n ** 14n) {
  try {
    const f = await cdp.evm.requestFaucet({ address: owner, network: NETWORK, token: 'eth' });
    console.log(`faucet ETH: ${f.transactionHash}`);
    await waitFor(async () => (await pc.getBalance({ address: owner })) >= 10n ** 14n);
  } catch (e) {
    console.log(`ETH faucet unavailable (${String(e).split('\n')[0]})`);
  }
}
console.log(`admin ETH: ${formatUnits(await pc.getBalance({ address: owner }), 18)}`);

async function send(to: Address, data: `0x${string}`, label: string): Promise<string> {
  const { transactionHash } = await cdp.evm.sendTransaction({
    address: owner,
    network: NETWORK,
    transaction: { to, data, value: 0n },
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${transactionHash}`);
  return transactionHash;
}

async function deploy(name: string, args: unknown[], types: { type: string }[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const initCode = encodeDeployData({ abi: abi as Abi, bytecode, args });
  encodeAbiParameters(types, args); // constructor-mismatch guard, same as deploy-contracts.ts
  const address = getCreate2Address({ from: CREATE2_PROXY, salt: SALT, bytecode: initCode });
  const existing = await pc.getCode({ address });
  if (existing && existing !== '0x') {
    console.log(`${name}: ${address} (already deployed)`);
    return address;
  }
  const hash = await send(CREATE2_PROXY, concatHex([SALT, initCode]), name);
  const landed = await waitFor(async () => ((await pc.getCode({ address })) ?? '0x') !== '0x');
  if (!landed) throw new Error(`${name}: no code at ${address}`);
  console.log(`${name}: ${address}  (deploy ${hash})`);
  console.log(`  ${explorerAddress(address)}`);
  return address;
}

const token = await deploy('MockUSDC', [owner], [{ type: 'address' }]);
const vault = await deploy(
  'MockVault',
  [token, 'Steward Demo Vault', 'sdUSDC', owner],
  [{ type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'address' }],
);

// --- mint ---------------------------------------------------------------------------------------
const mintTo = getAddress((process.argv[2] ?? owner) as Address);
const whole = BigInt(process.argv[3] ?? '200000');
const amount = whole * 1_000_000n;
const balanceOf = (who: Address) =>
  pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
const before = await balanceOf(mintTo);
if (before < amount) {
  const hash = await send(
    token,
    encodeFunctionData({
      abi: artifact('MockUSDC').abi as Abi,
      functionName: 'mint',
      args: [mintTo, amount - before],
    }),
    'mint',
  );
  console.log(`minted ${formatUnits(amount - before, 6)} mUSDC -> ${mintTo} (${hash})`);
  // Phase 2 lesson: the load-balanced RPC answers reads from a node that may be a block behind, so
  // poll rather than reading once — a single read here reported 0 for a mint that had landed.
  if (!(await waitFor(async () => (await balanceOf(mintTo)) >= amount)))
    throw new Error('mint did not become visible');
}

// --- verify on-chain ------------------------------------------------------------------------------
const vaultAbi = artifact('MockVault').abi as Abi;
const read = <T>(address: Address, abi: Abi, functionName: string) =>
  pc.readContract({ address, abi, functionName }) as Promise<T>;

const checks: [string, boolean, string][] = [];
const decimals = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' });
const symbol = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
const balance = await balanceOf(mintTo);
const vaultAsset = await read<Address>(vault, vaultAbi, 'asset');
const vaultOwner = await read<Address>(vault, vaultAbi, 'owner');
const vaultDecimals = await read<number>(vault, vaultAbi, 'decimals');

checks.push(['MockUSDC decimals == 6 (I12)', decimals === 6, String(decimals)]);
checks.push(['MockUSDC symbol == mUSDC', symbol === 'mUSDC', symbol]);
checks.push([`balance of ${mintTo}`, balance >= amount, `${formatUnits(balance, 6)} mUSDC`]);
checks.push(['vault.asset() == MockUSDC', getAddress(vaultAsset) === token, vaultAsset]);
checks.push(['vault.owner() == demo admin', getAddress(vaultOwner) === owner, vaultOwner]);
checks.push(['vault.decimals() == 6', vaultDecimals === 6, String(vaultDecimals)]);

console.log('\non-chain verification');
for (const [label, ok, detail] of checks)
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label} — ${detail}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);

console.log(`\nchainId ${CHAIN_ID}. DEMO-ONLY overrides (shell env, or .env.local for the demo):`);
console.log(`USDC_ADDRESS=${token}`);
console.log(`MOCK_VAULT_ADDRESS=${vault}`);
