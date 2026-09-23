// Route tests for the task 8.5 notification-center endpoints, against real Postgres — same pattern
// as auditRoutes.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const session = vi.hoisted(() => ({ current: {} as { userId?: string; address?: string } }));
vi.mock('../lib/session', () => ({
  getSession: async () => ({ ...session.current, save: async () => undefined }),
}));

import { freshTestDb, testDbUrl } from '../../../packages/db/test/helpers';
import { ensureWalletForUser, insertNotification, upsertUserByAddress, type Db } from '@steward/db';

const OWNER = getAddress('0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C');
const OTHER = getAddress(`0x${'2'.repeat(39)}a`);

let db: Db;
let pool: {
  end: () => Promise<void>;
  query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
};
let userId: string;
let walletId: string;
let routes: {
  list: typeof import('../app/api/notifications/route');
  read: typeof import('../app/api/notifications/[id]/read/route');
  readAll: typeof import('../app/api/notifications/read-all/route');
};

const get = (path: string) => new Request(`http://localhost:3000${path}`);
const post = (path: string) => new Request(`http://localhost:3000${path}`, { method: 'POST' });

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
  vi.stubEnv('DATABASE_URL', testDbUrl());
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
  vi.stubEnv('CHAIN_ID', '84532');
  vi.stubEnv('NODE_ENV', 'test');

  const user = await upsertUserByAddress(db, OWNER, new Date());
  userId = user.id;
  const wallet = await ensureWalletForUser(db, user.id, 84532, OWNER);
  walletId = wallet.id;
  const other = await upsertUserByAddress(db, OTHER, new Date());

  for (let i = 0; i < 4; i++) {
    await insertNotification(db, {
      userId,
      walletId,
      type: 'execution',
      title: `Event ${i}`,
      body: 'body',
    });
  }
  await insertNotification(db, {
    userId: other.id,
    walletId,
    type: 'execution',
    title: 'not yours',
    body: 'body',
  });

  routes = {
    list: await import('../app/api/notifications/route'),
    read: await import('../app/api/notifications/[id]/read/route'),
    readAll: await import('../app/api/notifications/read-all/route'),
  };
  session.current = { userId, address: OWNER };
});

afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  session.current = { userId, address: OWNER };
});

describe('GET /api/notifications', () => {
  it('requires a session', async () => {
    session.current = {};
    expect((await routes.list.GET(get('/api/notifications'))).status).toBe(401);
  });

  it('lists only this owner, newest first, with an unread count', async () => {
    const res = await routes.list.GET(get('/api/notifications'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { title: string; read: boolean }[];
      unreadCount: number;
    };
    expect(body.rows).toHaveLength(4);
    expect(body.rows[0]?.title).toBe('Event 3'); // newest first
    expect(body.rows.every((r) => !r.read)).toBe(true);
    expect(body.unreadCount).toBe(4);
    expect(body.rows.some((r) => r.title === 'not yours')).toBe(false);
  });

  it('paginates with a cursor', async () => {
    const page1 = (await (await routes.list.GET(get('/api/notifications?limit=2'))).json()) as {
      rows: { title: string }[];
      nextCursor: string | null;
    };
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await (
      await routes.list.GET(get(`/api/notifications?limit=2&before=${page1.nextCursor}`))
    ).json()) as { rows: { title: string }[] };
    expect(page2.rows).toHaveLength(2);
    expect(page1.rows.map((r) => r.title)).not.toEqual(page2.rows.map((r) => r.title));
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('requires a session', async () => {
    session.current = {};
    const res = await routes.read.POST(post('/api/notifications/x/read'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('marks one of THIS owner’s notifications read, and 404s on a bogus id', async () => {
    const list = (await (await routes.list.GET(get('/api/notifications'))).json()) as {
      rows: { id: string; read: boolean }[];
    };
    const target = list.rows[0];
    if (!target) throw new Error('no rows');

    const res = await routes.read.POST(post(`/api/notifications/${target.id}/read`), {
      params: Promise.resolve({ id: target.id }),
    });
    expect(res.status).toBe(200);

    const missing = await routes.read.POST(
      post('/api/notifications/00000000-0000-0000-0000-000000000000/read'),
      {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
      },
    );
    expect(missing.status).toBe(404);

    const after = (await (await routes.list.GET(get('/api/notifications'))).json()) as {
      rows: { id: string; read: boolean }[];
      unreadCount: number;
    };
    expect(after.rows.find((r) => r.id === target.id)?.read).toBe(true);
    expect(after.unreadCount).toBe(3);
  });

  it('cannot mark another owner’s notification read', async () => {
    // The "not yours" row belongs to OTHER; find its id straight from the db.
    const found = (await pool.query(`select id from notifications where title = 'not yours'`))
      .rows as { id: string }[];
    const otherId = found[0]?.id;
    if (!otherId) throw new Error('missing row');
    const res = await routes.read.POST(post(`/api/notifications/${otherId}/read`), {
      params: Promise.resolve({ id: otherId }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('requires a session', async () => {
    session.current = {};
    expect((await routes.readAll.POST()).status).toBe(401);
  });

  it('marks every remaining unread row for this owner read', async () => {
    const res = await routes.readAll.POST();
    expect(res.status).toBe(200);
    const after = (await (await routes.list.GET(get('/api/notifications'))).json()) as {
      unreadCount: number;
    };
    expect(after.unreadCount).toBe(0);
  });
});
