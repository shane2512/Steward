// GET /api/wallet — balances, allowance remaining, vault position, max-at-risk, frozen state.
//
// Phase 3 replaces the single MOCK_VAULT_ADDRESS below with the vault list from the active Policy.
import { getActiveSpendPermission, listAuditForEntity } from '@steward/db';
import { getEnv } from '@steward/shared';
import {
  getBalances,
  getVaultPosition,
  maxAtRisk,
  parseSpendPermission,
  readAllowanceRemaining,
} from '@steward/wallet';
import { getAddress } from 'viem';
import { apiError, getPublicClient } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const env = getEnv();
  const client = getPublicClient();
  const usdc = getAddress(env.USDC_ADDRESS);
  const manager = getAddress(env.SPEND_PERMISSION_MANAGER_ADDRESS);
  const agentWalletAddress = wallet.agentWalletAddress
    ? getAddress(wallet.agentWalletAddress)
    : null;

  const balances = agentWalletAddress
    ? await getBalances(client, {
        usdc,
        treasuryAddress: getAddress(wallet.treasuryAddress),
        agentWalletAddress,
      })
    : null;
  if (balances && !balances.ok) return apiError(502, 'rpc_error', balances.error);

  // Allowance remaining comes from the chain, not from our DB, so a revoke done directly in the
  // owner's wallet is reflected here immediately (I7).
  const row = await getActiveSpendPermission(owner.db, wallet.id);
  let allowanceRemaining = 0n;
  let permissionStatus: string | null = null;
  if (row) {
    permissionStatus = row.status;
    const parsed = parseSpendPermission(row.permission);
    if (parsed.ok) {
      const remaining = await readAllowanceRemaining(client, manager, parsed.value);
      if (remaining.ok) allowanceRemaining = remaining.value;
    }
  }

  const vaultAddress = env.MOCK_VAULT_ADDRESS ? getAddress(env.MOCK_VAULT_ADDRESS) : null;
  const position =
    vaultAddress && agentWalletAddress
      ? await getVaultPosition(client, { vault: vaultAddress, holder: agentWalletAddress })
      : null;
  const vaultAssets = position?.ok ? position.value.assets : 0n;

  // 6.7 — degraded mode. The SERV circuit breaker lives in the worker process, so it publishes its
  // transitions to the SYSTEM audit chain (SERV is one service, not one wallet's problem) and the UI
  // reads the latest one. No new column, and the flag is as auditable as every other state change.
  const servEvents = await listAuditForEntity(owner.db, 'serv', 'serv');
  const degraded = servEvents.at(-1)?.event === 'SERV_DEGRADED';

  return Response.json({
    wallet: {
      id: wallet.id,
      chainId: wallet.chainId,
      treasuryAddress: getAddress(wallet.treasuryAddress),
      agentWalletAddress,
      frozen: wallet.frozen,
      breakerOpen: wallet.breakerOpen,
    },
    /** True when SERV is unavailable: only deterministic proposals run (SERV_REASONING §1). */
    degraded,
    balances: {
      treasuryUsdc: (balances?.ok ? balances.value.treasuryUsdc : 0n).toString(),
      agentUsdc: (balances?.ok ? balances.value.agentUsdc : 0n).toString(),
    },
    spendPermission: {
      status: permissionStatus,
      allowanceRemaining: allowanceRemaining.toString(),
    },
    vault: vaultAddress
      ? {
          address: vaultAddress,
          shares: (position?.ok ? position.value.shares : 0n).toString(),
          assets: vaultAssets.toString(),
        }
      : null,
    maxAtRiskMicroUsd: maxAtRisk({
      agentUsdc: balances?.ok ? balances.value.agentUsdc : 0n,
      vaultAssets,
      allowanceRemaining,
    }).toString(),
  });
}
