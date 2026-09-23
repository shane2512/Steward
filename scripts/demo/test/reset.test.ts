import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseEnv } from '@steward/shared';
import { schema } from '@steward/db';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { seedDemo } from '../seed';
import { resetDemo } from '../reset';

const FAKE_HASH = `0x${'ab'.repeat(32)}`;

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/steward',
  SESSION_SECRET: 'x'.repeat(32),
  DEMO_MODE: 'true',
  CHAIN_ID: '84532',
};

describe('demo:reset (9.2)', () => {
  it('clears prior-run state, unfreezes, and re-seeds — matching a fresh seed', async () => {
    const { db, pool } = await freshTestDb();
    try {
      const env = parseEnv(baseEnv);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const now = new Date();

      const seeded = await seedDemo(db, env.value, now);

      // Simulate "ran something": a decision + verdict + execution + freeze, exactly like a real run.
      const [decision] = await db
        .insert(schema.agentDecisions)
        .values({
          walletId: seeded.walletId,
          trigger: 'schedule',
          contextSnapshot: {},
          contextHash: '0xdead',
          proposal: {},
          proposalSource: 'deterministic',
          status: 'allowed',
        })
        .returning();
      await db.insert(schema.verdicts).values({
        decisionId: decision!.id,
        decision: 'ALLOW',
        results: [],
        policyVersion: seeded.policyVersion,
      });
      await db.insert(schema.executions).values({
        walletId: seeded.walletId,
        decisionId: decision!.id,
        proposalHash: FAKE_HASH,
        kind: 'pay_recipient',
        callsHash: FAKE_HASH,
        status: 'confirmed',
      });
      await db
        .update(schema.wallets)
        .set({
          frozen: true,
          frozenAt: now,
          frozenReason: 'test',
          breakerOpen: true,
          breakerFailures: 3,
        })
        .where(eq(schema.wallets.id, seeded.walletId));

      const reset = await resetDemo(db, env.value, new Date(now.getTime() + 1000));
      expect(reset.walletId).toBe(seeded.walletId);
      expect(reset.cleared).toBe(true);

      const [wallet] = await db
        .select()
        .from(schema.wallets)
        .where(eq(schema.wallets.id, seeded.walletId));
      expect(wallet?.frozen).toBe(false);
      expect(wallet?.breakerOpen).toBe(false);
      expect(wallet?.breakerFailures).toBe(0);

      const decisions = await db
        .select()
        .from(schema.agentDecisions)
        .where(eq(schema.agentDecisions.walletId, seeded.walletId));
      expect(decisions).toHaveLength(0);
      const executions = await db
        .select()
        .from(schema.executions)
        .where(eq(schema.executions.walletId, seeded.walletId));
      expect(executions).toHaveLength(0);

      // Re-seeded: same wallet/policy, two fresh obligations due today.
      const obligations = await db
        .select()
        .from(schema.obligations)
        .where(eq(schema.obligations.walletId, seeded.walletId));
      expect(obligations).toHaveLength(2);

      // audit_log was never truncated — the reset itself only ever appends.
      const auditRows = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.walletId, seeded.walletId));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows.some((r) => r.event === 'DEMO_RESET')).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
