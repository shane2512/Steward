import { createPublicClient, http, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createDb, type Db } from '@steward/db';
import { getEnv } from '@steward/shared';

const g = globalThis as unknown as { __db?: Db; __pc?: PublicClient };

export function getDb(): Db {
  return (g.__db ??= createDb(getEnv().DATABASE_URL).db);
}

export function getPublicClient(): PublicClient {
  const env = getEnv();
  return (g.__pc ??= createPublicClient({
    chain: env.CHAIN_ID === 8453 ? base : baseSepolia,
    transport: http(env.RPC_URL_BASE_SEPOLIA),
  }) as PublicClient);
}

export const apiError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });
