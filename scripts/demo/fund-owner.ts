// Requests testnet USDC from the CDP faucet for an arbitrary address — generalizes the pattern in
// scripts/live/_faucet.ts (which is hardcoded to one derived phase-6 treasury) so it can fund whatever
// agent wallet scripts/demo/provision-owner.ts just created. The CDP faucet is rate-limited per
// project; if it refuses, fund the address manually via the CDP portal or a public Base Sepolia USDC
// faucet instead.
//
//   STEWARD_LIVE=1 pnpm demo:fund-owner <address>
import { erc20Abi, formatUnits, getAddress, type Address } from 'viem';
import { cdpClient, loadEnv, NETWORK, publicClient, requireLive, USDC } from '../live/lib';

requireLive('demo-fund-owner');
loadEnv();

const target = process.argv[2];
if (!target) {
  console.error('usage: STEWARD_LIVE=1 pnpm demo:fund-owner <address>');
  process.exit(1);
}
const address = getAddress(target as Address);

const pc = publicClient();
const cdp = cdpClient();
const balance = (a: Address) =>
  pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

console.log(`${address}: ${formatUnits(await balance(address), 6)} USDC`);
try {
  const f = await cdp.evm.requestFaucet({ address, network: NETWORK, token: 'usdc' });
  console.log(`faucet ok: ${f.transactionHash}`);
} catch (e) {
  console.log(`faucet refused: ${String(e).split('\n')[0]}`);
  console.log('fund it manually instead (CDP portal, or a public Base Sepolia USDC faucet).');
}
console.log(`${address} now: ${formatUnits(await balance(address), 6)} USDC`);
