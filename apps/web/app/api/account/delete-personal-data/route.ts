// POST /api/account/delete-personal-data — S11 closure checklist (task 7.7): scrub the PII fields
// Steward owns. Per I6 (append-only audit) this route must never touch `audit_log` — it only clears
// `users.display_name` — so decisions made under this account stay in the record, just without a
// name attached. It does not freeze, revoke or sweep (7.8's FreezeFlow owns that part of S11).
import { appendAudit, scrubUserPersonalData } from '@steward/db';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST() {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  await scrubUserPersonalData(owner.db, owner.userId);
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'PERSONAL_DATA_DELETED',
    entityType: 'user',
    entityId: owner.userId,
    payload: {},
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);
  return Response.json({ done: true });
}
