// Shared bootstrap for the scripts under scripts/live/.
//
// These scripts touch the real Base Sepolia network, so they are gated behind STEWARD_LIVE=1 and are
// never picked up by vitest (its `include` only covers packages/*/test and apps/*/test).
//
// Credentials come from .env.local through Node's own loader. Values are never printed: everything
// here logs addresses and tx hashes only.
import { readFileSync } from 'node:fs';
import { CdpClient } from '@coinbase/cdp-sdk';
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';

export function requireLive(name: string): void {
  if (process.env['STEWARD_LIVE'] !== '1') {
    console.error(
      `${name} talks to Base Sepolia and is not part of the test suite.\nRe-run with STEWARD_LIVE=1 to confirm.`,
    );
    process.exit(1);
  }
}

export function loadEnv(): void {
  try {
    process.loadEnvFile(new URL('../../.env.local', import.meta.url));
  } catch {
    // the shell may already carry the variables
  }
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (put it in .env.local)`);
  return v;
}

export function cdpClient(): CdpClient {
  return new CdpClient({
    apiKeyId: must('CDP_API_KEY_ID'),
    apiKeySecret: must('CDP_API_KEY_SECRET'),
    walletSecret: must('CDP_WALLET_SECRET'),
  });
}

export function publicClient(): PublicClient {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(process.env['RPC_URL_BASE_SEPOLIA']),
  }) as PublicClient;
}

export const CHAIN_ID = 84532;
export const NETWORK = 'base-sepolia' as const;
export const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
export const SPEND_PERMISSION_MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');

/** The demo admin owns MockVault/MockPriceFeed. A CDP server account — no private key on disk. */
export const DEMO_ADMIN_ACCOUNT = 'steward-demo-admin';

/** Read a forge artifact (contracts/out/<file>.sol/<name>.json). */
export function artifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const path = new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    abi: unknown[];
    bytecode: { object: string };
  };
  const object = json.bytecode.object;
  return {
    abi: json.abi,
    bytecode: (object.startsWith('0x') ? object : `0x${object}`) as `0x${string}`,
  };
}

export const explorer = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const explorerAddress = (a: Address) => `https://sepolia.basescan.org/address/${a}`;

/** Poll until `check` is true or the budget runs out. Returns whether it succeeded. */
export async function waitFor(
  check: () => Promise<boolean>,
  { tries = 30, delayMs = 3_000 } = {},
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Wait until the RPC actually reports code at `address`.
 *
 * The public endpoint is load-balanced, so a read straight after a deployment receipt can hit a node
 * that has not applied the block. That is not cosmetic: the next `estimateGas` then prices the call as
 * if the target were an EOA (~22k) and the real transaction runs out of gas and reverts. Always wait
 * for the code to be visible before sending anything to a freshly deployed contract.
 */
export async function waitForCode(pc: PublicClient, address: Address): Promise<void> {
  const ok = await waitFor(async () => ((await pc.getCode({ address })) ?? '0x') !== '0x');
  if (!ok) throw new Error(`no code at ${address} after waiting`);
}

/** Wait for a receipt and THROW if the transaction reverted (a receipt alone does not mean success). */
export async function confirm(pc: PublicClient, hash: Hex, label: string): Promise<void> {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success')
    throw new Error(`${label} reverted (gasUsed ${receipt.gasUsed}): ${explorer(hash)}`);
}
