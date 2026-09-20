// Server-side wallet helpers for the Phase 2 API routes.
//
// This is the ONLY place in apps/web that reveals CDP credentials, and it hands them straight to the
// CDP client without logging or storing them (I9).
import { CdpClient } from '@coinbase/cdp-sdk';
import { getWalletByUserId, type Db, type Wallet } from '@steward/db';
import { getEnv, type Address } from '@steward/shared';
import { getAddress } from 'viem';
import { apiError, getDb } from './server';
import { getSession } from './session';

export type Owner = { userId: string; address: Address; db: Db };

/** Resolve the signed-in owner, or the 401 response to return. */
export async function requireOwner(): Promise<Owner | Response> {
  const { userId, address } = await getSession();
  if (!userId || !address) return apiError(401, 'unauthorized', 'sign in required');
  return { userId, address: getAddress(address), db: getDb() };
}

export async function requireWallet(owner: Owner): Promise<Wallet | Response> {
  const wallet = await getWalletByUserId(owner.db, owner.userId);
  if (!wallet) return apiError(404, 'no_wallet', 'no wallet for this user');
  return wallet;
}

export function requireProvisioned(wallet: Wallet): Address | Response {
  if (!wallet.agentWalletAddress)
    return apiError(409, 'not_provisioned', 'provision the agent wallet first');
  return getAddress(wallet.agentWalletAddress);
}

let cdp: CdpClient | undefined;

/** CDP client built from the validated env. Throws at startup if credentials are missing. */
export function getCdpClient(): CdpClient {
  if (cdp) return cdp;
  const env = getEnv();
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET || !env.CDP_WALLET_SECRET)
    throw new Error(
      'CDP credentials are not configured (CDP_API_KEY_ID/SECRET, CDP_WALLET_SECRET)',
    );
  cdp = new CdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET.reveal(),
    walletSecret: env.CDP_WALLET_SECRET.reveal(),
  });
  return cdp;
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;
