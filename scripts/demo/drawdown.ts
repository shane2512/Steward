// 9.2 — scripts/demo/drawdown.ts. DEMO.md beat 2:25: MockVault.simulateLoss(300 bps), called as the
// demo-admin CDP account (the same account `scripts/live/deploy-contracts.ts` uses to own the mocks
// — no second contract-calling path). This script only pokes the contract: the already-running
// worker's `risk.scan` cron (every 60 s, `apps/worker/src/jobs.ts`) is what notices the drawdown and
// drives a real R20 risk-exit through the real decision loop. Nothing about that is reimplemented
// here.
//
//   STEWARD_LIVE=1 pnpm demo:drawdown [bps]     (default 300, DEMO.md's number)
import { encodeFunctionData, formatUnits, getAddress, type Abi } from 'viem';
import { getEnv } from '@steward/shared';
import {
  artifact,
  cdpClient,
  confirm,
  DEMO_ADMIN_ACCOUNT,
  explorer,
  loadEnv,
  NETWORK,
  publicClient,
  requireLive,
  waitFor,
} from '../live/lib';

const ONE_SHARE = 10n ** 18n;

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.DEMO_MODE || env.CHAIN_ID !== 84532) {
    throw new Error('demo drawdown refuses: requires DEMO_MODE=true and CHAIN_ID=84532 (I11)');
  }
  if (!env.MOCK_VAULT_ADDRESS) throw new Error('MOCK_VAULT_ADDRESS is not set in .env.local');
  const vault = getAddress(env.MOCK_VAULT_ADDRESS);
  const bps = BigInt(process.argv[2] ?? '300');

  const cdp = cdpClient();
  const pc = publicClient();
  const admin = await cdp.evm.getOrCreateAccount({ name: DEMO_ADMIN_ACCOUNT });
  const owner = getAddress(admin.address);
  const { abi } = artifact('MockVault');

  const price = (): Promise<bigint> =>
    pc.readContract({
      address: vault,
      abi: abi as Abi,
      functionName: 'convertToAssets',
      args: [ONE_SHARE],
    }) as Promise<bigint>;

  const before = await price();
  console.log(`vault ${vault} — share price before: ${formatUnits(before, 6)} USDC/share`);

  const data = encodeFunctionData({ abi: abi as Abi, functionName: 'simulateLoss', args: [bps] });
  const { transactionHash } = await cdp.evm.sendTransaction({
    address: owner,
    network: NETWORK,
    transaction: { to: vault, data, value: 0n },
  });
  await confirm(pc, transactionHash as `0x${string}`, 'simulateLoss');
  console.log(`simulateLoss(${bps} bps): ${explorer(transactionHash)}`);

  const after = await waitFor(async () => (await price()) < before).then(price);
  console.log(`share price after: ${formatUnits(after, 6)} USDC/share`);
  console.log(
    "\nthe running worker's risk.scan (every 60s) will notice this on its next tick and drive a " +
      'real R20 risk_exit through the loop — watch /app/activity or the /demo checklist.',
  );
}

requireLive('demo-drawdown');
loadEnv();
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
