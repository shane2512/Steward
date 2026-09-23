// Phase 8.1 — "the spend permission is gone on-chain" recorded in ONE place.
//
// Two call sites reach this: the owner reporting their own revoke transaction
// (`POST /api/spend-permission/revoked`), and the worker's `permission.scan`, which notices a
// revoke the owner sent straight from their Coinbase wallet with Steward never being told
// (SECURITY §8 "Immediate revoke" / "Recover funds"). Both must leave the database in the same
// state, so both go through here.
//
// The chain is the only authority: a reported `txHash` is recorded as a breadcrumb, never trusted
// as proof. An unreadable chain is not a revocation (I5 — fail closed toward "still live", which
// keeps the row active and keeps offering the revoke, rather than falsely claiming it is done).
//
// Recording a revocation also FREEZES the wallet. A revoked permission means the agent can no
// longer pull funds, so freezing costs nothing operationally, and it is what the owner meant: in
// the §4 flow freeze comes first anyway (this is then a no-op), and when the revoke came from
// outside Steward it is the only way the UI learns to stop pretending the agent is live.
//
// I7: no reasoning, no SERV, no LLM — a DB write and two chain reads.
import {
  appendAudit,
  cancelPendingApprovals,
  getActiveSpendPermission,
  getWalletById,
  listSpendPermissions,
  markSpendPermissionRevoked,
  setWalletFrozen,
  type Db,
} from '@steward/db';
import { err, ok, type Address, type Result } from '@steward/shared';
import type { Hex, PublicClient } from 'viem';
import { isRevoked, parseSpendPermission } from './spendPermission';

export type RevocationOutcome =
  /** This wallet never had a spend permission (nothing to revoke, nothing to record). */
  | { state: 'none' }
  /** Already recorded as revoked in an earlier call. Idempotent success. */
  | { state: 'already-recorded' }
  /** There IS an active permission and the chain still says it is live. */
  | { state: 'not-revoked' }
  | { state: 'recorded'; permissionHash: string; froze: boolean; cancelledApprovals: number };

export type RevocationError = {
  /** Mapped to an HTTP status by the route; logged by the worker. */
  code: 'bad_permission' | 'chain_unreadable' | 'audit_failed';
  message: string;
};

export async function recordRevocationIfRevoked(args: {
  db: Db;
  publicClient: PublicClient;
  manager: Address;
  walletId: string;
  /** `owner` when the owner reported it, `system` when the scan found it. */
  actor: 'owner' | 'system';
  /** The owner's reported transaction, when there is one. Not proof — a breadcrumb. */
  txHash?: Hex;
  now: Date;
}): Promise<Result<RevocationOutcome, RevocationError>> {
  const { db, publicClient, manager, walletId, actor, now } = args;

  const active = await getActiveSpendPermission(db, walletId);
  if (!active) {
    const all = await listSpendPermissions(db, walletId);
    return ok(
      all.some((p) => p.status === 'revoked') ? { state: 'already-recorded' } : { state: 'none' },
    );
  }

  const parsed = parseSpendPermission(active.permission);
  if (!parsed.ok) return err({ code: 'bad_permission', message: parsed.error });

  const onchain = await isRevoked(publicClient, manager, parsed.value);
  if (!onchain.ok) return err({ code: 'chain_unreadable', message: onchain.error });
  if (!onchain.value) return ok({ state: 'not-revoked' });

  // I6 — audit BEFORE the state changes. A refused audit write refuses the whole recording rather
  // than mutating silently.
  const audited = await appendAudit(db, {
    walletId,
    actor,
    event: 'SPEND_PERMISSION_REVOKED',
    entityType: 'spend_permission',
    entityId: active.permissionHash,
    payload: {
      permissionHash: active.permissionHash,
      ...(args.txHash === undefined ? {} : { txHash: args.txHash }),
      detectedBy: actor === 'system' ? 'onchain-scan' : 'owner-report',
    },
    createdAt: now,
  });
  if (!audited.ok) return err({ code: 'audit_failed', message: audited.error.message });

  await markSpendPermissionRevoked(db, active.id, now);

  const wallet = await getWalletById(db, walletId);
  if (wallet?.frozen === false) {
    const reason = actor === 'system' ? 'spend permission revoked on-chain' : 'owner revoke';
    const frozenAudit = await appendAudit(db, {
      walletId,
      actor,
      event: 'FROZEN',
      entityType: 'wallet',
      entityId: walletId,
      payload: { reason, permissionHash: active.permissionHash },
      createdAt: now,
    });
    if (!frozenAudit.ok) return err({ code: 'audit_failed', message: frozenAudit.error.message });
    await setWalletFrozen(db, walletId, true, reason, now);
    const cancelled = await cancelPendingApprovals(db, walletId, now);
    for (const row of cancelled) {
      await appendAudit(db, {
        walletId,
        actor,
        event: 'APPROVAL_CANCELLED',
        entityType: 'approval',
        entityId: row.id,
        payload: { reason, proposalHash: row.proposalHash },
        createdAt: now,
      });
    }
    return ok({
      state: 'recorded',
      permissionHash: active.permissionHash,
      froze: true,
      cancelledApprovals: cancelled.length,
    });
  }

  return ok({
    state: 'recorded',
    permissionHash: active.permissionHash,
    froze: false,
    cancelledApprovals: 0,
  });
}
