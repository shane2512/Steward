// Ask the CDP faucet for testnet USDC for the Phase 6 live run's treasury, and report whether the
// project's rate limit has reset. Prints addresses and balances only.
import { erc20Abi, formatUnits, getAddress, keccak256, toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { getEnv } from '@steward/shared';
import { cdpClient, loadEnv, NETWORK, publicClient, requireLive, USDC } from './lib';

requireLive('_faucet');
loadEnv();
const env = getEnv();
const pc = publicClient();
const cdp = cdpClient();
const ownerKey = privateKeyToAccount(
  keccak256(toBytes(`steward:phase6:loop-e2e:owner:${env.SESSION_SECRET.reveal()}`)),
);
const wallet = await toCoinbaseSmartAccount({ client: pc, owners: [ownerKey], version: '1.1' });
const treasury = getAddress(wallet.address);
const bal = (a: Address) =>
  pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

console.log(`treasury ${treasury}: ${formatUnits(await bal(treasury), 6)} USDC`);
try {
  const f = await cdp.evm.requestFaucet({ address: treasury, network: NETWORK, token: 'usdc' });
  console.log(`faucet ok: ${f.transactionHash}`);
} catch (e) {
  console.log(`faucet refused: ${String(e).split('\n')[0]}`);
}
console.log(`treasury now: ${formatUnits(await bal(treasury), 6)} USDC`);
