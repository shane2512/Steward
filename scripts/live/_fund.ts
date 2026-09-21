// One-off helper: move idle testnet USDC held by CDP smart accounts we control into a target
// address. The CDP faucet is rate-limited per project, and this is our own leftover test money.
//
//   STEWARD_LIVE=1 npx tsx scripts/live/_fund.ts <toAddress>
import { encodeFunctionData, erc20Abi, formatUnits, getAddress, type Address } from 'viem';
import { cdpClient, loadEnv, NETWORK, publicClient, requireLive, USDC } from './lib';

requireLive('_fund');
loadEnv();
const to = getAddress(process.argv[2] as Address);
const cdp = cdpClient();
const pc = publicClient();

const owners = (await cdp.evm.listAccounts()).accounts ?? [];
const smarts = (await cdp.evm.listSmartAccounts()).accounts ?? [];

for (const smart of smarts) {
  const address = getAddress(smart.address);
  if (address === to) continue;
  const balance = await pc.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
  if (balance === 0n) continue;

  let account: Awaited<ReturnType<typeof cdp.evm.getSmartAccount>> | undefined;
  for (const owner of owners) {
    try {
      account = await cdp.evm.getSmartAccount({ address, owner } as never);
      break;
    } catch {
      /* wrong owner: try the next one */
    }
  }
  if (!account) {
    console.log(`${address}: ${formatUnits(balance, 6)} USDC — no owner found, skipping`);
    continue;
  }
  const op = await cdp.evm.sendUserOperation({
    smartAccount: account,
    network: NETWORK,
    calls: [
      {
        to: USDC,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, balance] }),
        value: 0n,
      },
    ],
  });
  const result = (await cdp.evm.waitForUserOperation({
    smartAccountAddress: address,
    userOpHash: op.userOpHash,
  })) as { status: string; transactionHash?: string };
  console.log(
    `${address}: sent ${formatUnits(balance, 6)} USDC -> ${to} (${result.status} ${result.transactionHash ?? ''})`,
  );
}
console.log(
  `target ${to} now holds ${formatUnits(
    await pc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [to] }),
    6,
  )} USDC`,
);
