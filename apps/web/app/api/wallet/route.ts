// GET /api/wallet: balances, allowance remaining, vault position, max-at-risk, frozen state.
// The read model lives in lib/walletState.ts (shared with GET /api/dashboard).
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';
import { loadWalletState } from '@/lib/walletState';

export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const state = await loadWalletState(owner, wallet);
  if (!state.ok) return apiError(502, 'rpc_error', state.message);
  return Response.json(state.value);
}
