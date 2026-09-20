// I8 — testnet by default. Everything in this package that can touch a chain goes through
// assertChainAllowed() first, and it fails closed.
import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { err, ok, type Result } from '@steward/shared';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;

/** AgentKit/CDP network id for a supported chain id. */
export const CDP_NETWORK_ID: Record<number, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: 'base-sepolia',
  [BASE_MAINNET_CHAIN_ID]: 'base',
};

/**
 * The Phase 9 mainnet gate (docs/PHASES.md) has NOT been signed off by the human.
 * I8 requires BOTH `STEWARD_ALLOW_MAINNET=true` AND this flag, so mainnet is refused today even if
 * someone sets the env var. Flipping this constant is a deliberate, reviewable one-line change that
 * belongs in the Phase 9 sign-off commit — never in a config file or an env var.
 */
export const MAINNET_GATE_SIGNED_OFF = false;

export type ChainGuardInput = { chainId: number; allowMainnet: boolean };

/** Result-returning chain guard. Unknown chains are refused too (fail closed, I5). */
export function assertChainAllowed({ chainId, allowMainnet }: ChainGuardInput): Result<number> {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return ok(chainId);
  if (chainId === BASE_MAINNET_CHAIN_ID) {
    if (!allowMainnet)
      return err('chain 8453 (Base mainnet) refused: STEWARD_ALLOW_MAINNET is not set (I8)');
    if (!MAINNET_GATE_SIGNED_OFF)
      return err(
        'chain 8453 (Base mainnet) refused: the Phase 9 mainnet gate is not signed off (I8)',
      );
    return ok(chainId);
  }
  return err(`unsupported chainId ${chainId}: Steward runs on 84532 (or 8453 behind the I8 gate)`);
}

export function viemChain(chainId: number): Chain {
  return chainId === BASE_MAINNET_CHAIN_ID ? base : baseSepolia;
}

export function createChainClient(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: viemChain(chainId),
    transport: http(rpcUrl),
  }) as PublicClient;
}
