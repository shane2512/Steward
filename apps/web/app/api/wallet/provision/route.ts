// POST /api/wallet/provision — create the agent operating wallet (idempotent, audited).
import { CDP_NETWORK_ID, provisionAgentWallet } from '@steward/wallet';
import { getEnv } from '@steward/shared';
import { apiError } from '@/lib/server';
import { getCdpClient, isResponse, requireOwner } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;

  const env = getEnv();
  const networkId = CDP_NETWORK_ID[env.CHAIN_ID];
  if (!networkId) return apiError(400, 'bad_chain', `unsupported chain ${env.CHAIN_ID}`);

  const r = await provisionAgentWallet(
    {
      db: owner.db,
      cdp: getCdpClient().evm,
      chainId: env.CHAIN_ID,
      allowMainnet: env.STEWARD_ALLOW_MAINNET,
      networkId,
    },
    owner.userId,
  );
  if (!r.ok) {
    const status = r.error.code === 'NO_WALLET' ? 404 : r.error.code === 'CONFLICT' ? 409 : 400;
    return apiError(status, r.error.code.toLowerCase(), r.error.message);
  }
  return Response.json({
    walletId: r.value.walletId,
    agentWalletAddress: r.value.agentWalletAddress,
    created: r.value.created,
  });
}
