// Shared read model behind GET /api/wallet and GET /api/dashboard: balances, allowance remaining,
// vault position, max-at-risk and the frozen/degraded flags. Allowance comes from the chain, not from
// our DB, so a revoke done directly in the owner's wallet is reflected immediately (I7).
import { getActiveSpendPermission, listAuditForEntity, type Wallet } from '@steward/db';
import { getEnv } from '@steward/shared';
import {
  getBalances,
  getVaultPosition,
  maxAtRisk,
  parseSpendPermission,
  readAllowanceRemaining,
} from '@steward/wallet';
import { getAddress } from 'viem';
import { getPublicClient } from './server';
import type { Owner } from './wallet';

export type WalletStateResult =
  | { ok: false; message: string }
  | {
      ok: true;
      value: {
        wallet: {
          id: string;
          chainId: number;
          treasuryAddress: string;
          agentWalletAddress: string | null;
          frozen: boolean;
          breakerOpen: boolean;
        };
        degraded: boolean;
        balances: { treasuryUsdc: string; agentUsdc: string };
        spendPermission: {
          status: string | null;
          allowanceRemaining: string;
          allowance: string | null;
          periodSeconds: number | null;
        };
        vault: { address: string; shares: string; assets: string } | null;
        maxAtRiskMicroUsd: string;
      };
    };

export async function loadWalletState(owner: Owner, wallet: Wallet): Promise<WalletStateResult> {
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
  if (balances && !balances.ok) return { ok: false, message: balances.error };

  const row = await getActiveSpendPermission(owner.db, wallet.id);
  let allowanceRemaining = 0n;
  let allowance: bigint | null = null;
  let periodSeconds: number | null = null;
  let permissionStatus: string | null = null;
  if (row) {
    permissionStatus = row.status;
    const parsed = parseSpendPermission(row.permission);
    if (parsed.ok) {
      allowance = parsed.value.allowance;
      periodSeconds = parsed.value.period;
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

  // 6.7: the SERV breaker lives in the worker, which publishes its transitions to the system audit
  // chain; the latest one says whether SERV is currently degraded (D-53).
  const servEvents = await listAuditForEntity(owner.db, 'serv', 'serv');
  const degraded = servEvents.at(-1)?.event === 'SERV_DEGRADED';

  const agentUsdc = balances?.ok ? balances.value.agentUsdc : 0n;
  return {
    ok: true,
    value: {
      wallet: {
        id: wallet.id,
        chainId: wallet.chainId,
        treasuryAddress: getAddress(wallet.treasuryAddress),
        agentWalletAddress,
        frozen: wallet.frozen,
        breakerOpen: wallet.breakerOpen,
      },
      degraded,
      balances: {
        treasuryUsdc: (balances?.ok ? balances.value.treasuryUsdc : 0n).toString(),
        agentUsdc: agentUsdc.toString(),
      },
      spendPermission: {
        status: permissionStatus,
        allowanceRemaining: allowanceRemaining.toString(),
        allowance: allowance?.toString() ?? null,
        periodSeconds,
      },
      vault: vaultAddress
        ? {
            address: vaultAddress,
            shares: (position?.ok ? position.value.shares : 0n).toString(),
            assets: vaultAssets.toString(),
          }
        : null,
      maxAtRiskMicroUsd: maxAtRisk({ agentUsdc, vaultAssets, allowanceRemaining }).toString(),
    },
  };
}
