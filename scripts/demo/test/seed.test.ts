import { describe, expect, it } from 'vitest';
import { parseEnv } from '@steward/shared';
import { schema } from '@steward/db';
import { freshTestDb } from '../../../packages/db/test/helpers';
import { seedDemo, DEMO_OWNER_ADDRESS } from '../seed';

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/steward',
  SESSION_SECRET: 'x'.repeat(32),
  DEMO_MODE: 'true',
  CHAIN_ID: '84532',
};

describe('db:seed:demo (9.1)', () => {
  it('refuses outside DEMO_MODE / chain 84532 (I11)', async () => {
    const { db, pool } = await freshTestDb();
    try {
      const notDemo = parseEnv({ ...baseEnv, DEMO_MODE: 'false' });
      expect(notDemo.ok).toBe(true);
      if (notDemo.ok) await expect(seedDemo(db, notDemo.value, new Date())).rejects.toThrow(/I11/);
    } finally {
      await pool.end();
    }
  });

  it('is idempotent: seeding twice yields one wallet, one active policy, two obligations', async () => {
    const { db, pool } = await freshTestDb();
    try {
      const env = parseEnv(baseEnv);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const now = new Date();

      const first = await seedDemo(db, env.value, now);
      expect(first.policyCreated).toBe(true);
      expect(first.obligationIds).toHaveLength(2);

      const second = await seedDemo(db, env.value, new Date(now.getTime() + 1000));
      expect(second.walletId).toBe(first.walletId);
      expect(second.userId).toBe(first.userId);
      expect(second.policyCreated).toBe(false); // no duplicate policy version
      expect(second.policyVersion).toBe(first.policyVersion);
      expect(second.obligationIds).toHaveLength(2); // refreshed, not accumulated

      const wallets = await db.select().from(schema.wallets);
      expect(wallets).toHaveLength(1);
      expect(wallets[0]?.treasuryAddress).toBe(DEMO_OWNER_ADDRESS);

      const recipients = await db.select().from(schema.recipients);
      expect(recipients).toHaveLength(2);

      const obligations = await db.select().from(schema.obligations);
      expect(obligations).toHaveLength(2); // not 4
    } finally {
      await pool.end();
    }
  });
});
