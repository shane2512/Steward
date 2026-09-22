// Route tests for the task 7.7 audit endpoints, against a REAL Postgres (freshTestDb), the same
// pattern as signingApi.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const session = vi.hoisted(() => ({ current: {} as { userId?: string; address?: string } }));
vi.mock('../lib/session', () => ({
  getSession: async () => ({ ...session.current, save: async () => undefined }),
}));

import { freshTestDb, testDbUrl } from '../../../packages/db/test/helpers';
import { appendAudit, ensureWalletForUser, upsertUserByAddress, type Db } from '@steward/db';

const OWNER = getAddress('0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C');

let db: Db;
let pool: {
  end: () => Promise<void>;
  query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
};
let walletId: string;
let routes: {
  export: typeof import('../app/api/audit/export/route');
  verify: typeof import('../app/api/audit/verify/route');
};

const get = (path: string) => new Request(`http://localhost:3000${path}`);

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
  vi.stubEnv('DATABASE_URL', testDbUrl());
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
  vi.stubEnv('CHAIN_ID', '84532');
  vi.stubEnv('NODE_ENV', 'test');

  const user = await upsertUserByAddress(db, OWNER, new Date());
  const wallet = await ensureWalletForUser(db, user.id, 84532, OWNER);
  walletId = wallet.id;

  for (let i = 0; i < 5; i++) {
    await appendAudit(db, {
      walletId,
      actor: 'owner',
      event: `EVENT_${i}`,
      entityType: 'test',
      entityId: String(i),
      payload: { i, note: 'hello world' },
    });
  }

  routes = {
    export: await import('../app/api/audit/export/route'),
    verify: await import('../app/api/audit/verify/route'),
  };
  session.current = { userId: user.id, address: OWNER };
});

afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  session.current = { userId: undefined, address: undefined };
});

const signedIn = async () => {
  session.current = {
    userId: (await upsertUserByAddress(db, OWNER, new Date())).id,
    address: OWNER,
  };
};

describe('GET /api/audit/export', () => {
  it('requires a session', async () => {
    expect((await routes.export.GET(get('/api/audit/export?format=json'))).status).toBe(401);
  });

  it('rejects an unknown format', async () => {
    await signedIn();
    expect((await routes.export.GET(get('/api/audit/export?format=xml'))).status).toBe(400);
  });

  it('json: returns the rows for this wallet, no secrets, cursor-paginated', async () => {
    await signedIn();
    const res = await routes.export.GET(get('/api/audit/export?format=json&limit=2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { event: string }[]; nextCursor: number | null };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]?.event).toBe('EVENT_0');
    expect(body.nextCursor).not.toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/private|secret|mnemonic|password/i);

    const page2 = await routes.export.GET(
      get(`/api/audit/export?format=json&limit=2&cursor=${body.nextCursor}`),
    );
    const body2 = (await page2.json()) as { rows: { event: string }[] };
    expect(body2.rows[0]?.event).toBe('EVENT_2');
  });

  it('csv: returns a header row, one line per audit row, and a next-cursor header when paged', async () => {
    await signedIn();
    const res = await routes.export.GET(get('/api/audit/export?format=csv&limit=2'));
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('id,createdAt,actor,event,entityType,entityId,payload,prevHash,rowHash');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(res.headers.get('x-next-cursor')).toBeTruthy();
  });
});

describe('GET /api/audit/verify', () => {
  it('requires a session', async () => {
    expect((await routes.verify.GET()).status).toBe(401);
  });

  it('reports ok on a clean chain', async () => {
    await signedIn();
    const res = await routes.verify.GET();
    const body = (await res.json()) as { ok: boolean; rows: number };
    expect(body.ok).toBe(true);
    expect(body.rows).toBe(5);
  });

  it('names the exact tampered row when the chain is broken', async () => {
    await signedIn();
    const rows = (
      await pool.query('select id from audit_log where wallet_id = $1 order by id asc', [walletId])
    ).rows as { id: string }[];
    const victim = rows[2];
    if (!victim) throw new Error('missing row');
    await pool.query('alter table audit_log disable trigger audit_log_no_mutation');
    await pool.query('update audit_log set payload = $1 where id = $2', [
      JSON.stringify({ i: 99 }),
      victim.id,
    ]);
    await pool.query('alter table audit_log enable trigger audit_log_no_mutation');

    const res = await routes.verify.GET();
    const body = (await res.json()) as {
      ok: boolean;
      break: { rowId: number; reason: string };
    };
    expect(body.ok).toBe(false);
    expect(body.break.rowId).toBe(Number(victim.id));
    expect(body.break.reason).toBe('row_hash_mismatch');
  });
});
