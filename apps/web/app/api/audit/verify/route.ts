// GET /api/audit/verify — S10 (task 7.7): "Verify audit chain". Recomputes the owner's chain
// server-side and reports OK or the exact failing row; it never just says OK without checking
// (CLAUDE.md I5/I6 — a broken chain must never read as healthy).
import { verifyChain } from '@steward/db';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const result = await verifyChain(owner.db, wallet.id);
  if (result.ok) return Response.json({ ok: true, rows: result.value.rows, head: result.value.head });
  return Response.json({ ok: false, break: result.error });
}
