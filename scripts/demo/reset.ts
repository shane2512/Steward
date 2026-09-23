// 9.2 — scripts/demo/reset.ts. Lets the demo be rehearsed repeatedly (Exit Gate: "twice in a row...
// without manual DB edits"). Clears the OPERATIONAL rows a previous run left behind for the demo
// wallet (decisions, verdicts, simulations, executions, approvals, ledger, vault snapshots,
// notifications), un-freezes and closes the breaker (`setWalletFrozen`, the same repo function the
// owner's real unfreeze path uses), and re-seeds (`seedDemo`) so recipients/obligations/policy are
// fresh. `audit_log` is NEVER touched — I6 is append-only and a demo reset is not an exception; the
// reset itself writes its own audit row through the normal `appendAudit` path.
//
//   DEMO_MODE=true CHAIN_ID=84532 pnpm demo:reset     (no live chain call — DB only)
import { eq } from 'drizzle-orm';
import {
  createDb,
  schema,
  setWalletFrozen,
  appendAudit,
  upsertUserByAddress,
  getWalletByUserId,
} from '@steward/db';
import { getEnv } from '@steward/shared';
import { loadEnv } from '../live/lib';
import { seedDemo, assertDemoModeAllowed, DEMO_OWNER_ADDRESS } from './seed';

export async function resetDemo(
  db: ReturnType<typeof createDb>['db'],
  env: ReturnType<typeof getEnv>,
  now: Date,
): Promise<{ walletId: string; cleared: boolean }> {
  assertDemoModeAllowed(env);

  const user = await upsertUserByAddress(db, DEMO_OWNER_ADDRESS, now);
  const wallet = await getWalletByUserId(db, user.id);
  if (!wallet) {
    // Nothing to clear yet; seedDemo below creates it fresh.
    await seedDemo(db, env, now);
    const created = await getWalletByUserId(db, user.id);
    return { walletId: created!.id, cleared: false };
  }

  const walletId = wallet.id;
  const decisionIds = (
    await db
      .select({ id: schema.agentDecisions.id })
      .from(schema.agentDecisions)
      .where(eq(schema.agentDecisions.walletId, walletId))
  ).map((r) => r.id);

  await db.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.walletId, walletId));
  await db.delete(schema.receiptNonces).where(eq(schema.receiptNonces.walletId, walletId));
  await db.delete(schema.executions).where(eq(schema.executions.walletId, walletId));
  await db.delete(schema.approvals).where(eq(schema.approvals.walletId, walletId));
  for (const decisionId of decisionIds) {
    await db.delete(schema.verdicts).where(eq(schema.verdicts.decisionId, decisionId));
    await db.delete(schema.simulations).where(eq(schema.simulations.decisionId, decisionId));
  }
  await db.delete(schema.agentDecisions).where(eq(schema.agentDecisions.walletId, walletId));
  await db.delete(schema.vaultSnapshots).where(eq(schema.vaultSnapshots.walletId, walletId));
  await db.delete(schema.notifications).where(eq(schema.notifications.walletId, walletId));
  await db
    .update(schema.vaults)
    .set({ flagged: false, flaggedReason: null })
    .where(eq(schema.vaults.walletId, walletId));

  // The owner's real unfreeze path (I7): un-freezes AND clears the breaker in one call.
  await setWalletFrozen(db, walletId, false, null, now);

  await appendAudit(db, {
    walletId,
    actor: 'system',
    event: 'DEMO_RESET',
    entityType: 'wallet',
    entityId: walletId,
    payload: { decisionsCleared: decisionIds.length },
    createdAt: now,
  });

  await seedDemo(db, env, now);
  return { walletId, cleared: true };
}

async function main(): Promise<void> {
  loadEnv();
  const env = getEnv();
  assertDemoModeAllowed(env);
  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const result = await resetDemo(db, env, new Date());
    console.log(
      result.cleared
        ? `demo wallet ${result.walletId} reset: decisions/executions/approvals/verdicts/simulations cleared, unfrozen, re-seeded`
        : `demo wallet ${result.walletId} created fresh (nothing to clear)`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('reset.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
