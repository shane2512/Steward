// Route tests for the owner control path (task 7.8): freeze, unfreeze, sweep.
//
// What these are here to prove, one test each:
//   - none of the four routes does anything without a session AND a fresh owner signature;
//   - the server re-derives the message it verifies from the SESSION's nonce and action, so a
//     confirmation issued for an unfreeze can never be spent on a freeze;
//   - freezing is idempotent: the second freeze is a successful no-op, not an error;
//   - freezing cancels pending approvals and writes a FROZEN audit row (SECURITY §4);
//   - unfreezing clears the circuit breaker (SECURITY §5);
//   - the sweep refuses on a running wallet (it is the only action allowed while FROZEN);
//   - **the whole path works with the reasoning package dead** — `@steward/reasoning` is mocked to
//     throw on import here, so if any route in this graph reached it, every test below would fail
//     (I7; check:arch already proves it statically, this proves it at runtime).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// I7 at runtime: importing reasoning explodes. Nothing on the owner path may touch it.
vi.mock('@steward/reasoning', () => {
  throw new Error('SERV/reasoning is down: the owner path must not need it');
});

const OWNER_KEY = `0x${'31'.repeat(32)}` as Hex;
const OTHER_KEY = `0x${'32'.repeat(32)}` as Hex;
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

type SessionShape = {
  userId?: string;
  address?: string;
  freezeNonce?: string;
  freezeNonceAt?: number;
  freezeAction?: 'freeze' | 'unfreeze';
};
const session = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../lib/session', () => ({
  getSession: async () =>
    new Proxy(session.current, {
      get: (t, k) => (k === 'save' ? async () => undefined : Reflect.get(t, k)),
      set: (t, k, v) => Reflect.set(t, k, v),
    }),
}));

vi.mock('../lib/server', async (orig) => {
  const real = await orig<typeof import('../lib/server')>();
  return {
    ...real,
    getPublicClient: () => ({
      verifyMessage: async (a: { address: string; message: string; signature: Hex }) =>
        getAddress(await recoverMessageAddress({ message: a.message, signature: a.signature })) ===
        getAddress(a.address),
    }),
  };
});

import { freshTestDb, testDbUrl } from '../../../packages/db/test/helpers';
import {
  ensureWalletForUser,
  getWalletById,
  insertAgentDecision,
  insertApproval,
  listAuditPage,
  setWalletFrozen,
  upsertUserByAddress,
  type Db,
} from '@steward/db';

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');

let db: Db;
let pool: { end: () => Promise<void> };
let walletId: string;
let userId: string;
let routes: {
  prepare: typeof import('../app/api/freeze/prepare/route');
  freeze: typeof import('../app/api/freeze/route');
  unfreeze: typeof import('../app/api/unfreeze/route');
  sweep: typeof import('../app/api/sweep/route');
  revoked: typeof import('../app/api/spend-permission/revoked/route');
};

const get = (path: string) => new Request(`http://localhost:3000${path}`);
const post = (path: string, body?: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const sess = () => session.current as SessionShape;
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
  vi.stubEnv('DATABASE_URL', testDbUrl());
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
  vi.stubEnv('CHAIN_ID', '84532');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('USDC_ADDRESS', USDC);

  const user = await upsertUserByAddress(db, owner.address, new Date());
  userId = user.id;
  walletId = (await ensureWalletForUser(db, user.id, 84532, owner.address)).id;

  routes = {
    prepare: await import('../app/api/freeze/prepare/route'),
    freeze: await import('../app/api/freeze/route'),
    unfreeze: await import('../app/api/unfreeze/route'),
    sweep: await import('../app/api/sweep/route'),
    revoked: await import('../app/api/spend-permission/revoked/route'),
  };
});

afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  session.current = {};
  await setWalletFrozen(db, walletId, false, null, new Date());
});

const signedIn = () => {
  sess().userId = userId;
  sess().address = owner.address;
};

/** Ask for the real message, sign it with `account`, and submit it to `route`. */
async function signAndSubmit(
  action: 'freeze' | 'unfreeze',
  account: typeof owner,
  route: { POST: (r: Request) => Promise<Response> },
  path: string,
): Promise<Response> {
  const prepared = await json(await routes.prepare.POST(post('/api/freeze/prepare', { action })));
  const signature = await account.signMessage({ message: prepared['message'] as string });
  return route.POST(post(path, { signature }));
}

describe('the owner path refuses anonymous callers', () => {
  it('401s on every route without a session', async () => {
    expect(
      (await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' }))).status,
    ).toBe(401);
    expect((await routes.freeze.GET(get('/api/freeze'))).status).toBe(401);
    expect((await routes.freeze.POST(post('/api/freeze', { signature: '0x00' }))).status).toBe(401);
    expect((await routes.unfreeze.POST(post('/api/unfreeze', { signature: '0x00' }))).status).toBe(
      401,
    );
    expect((await routes.sweep.GET()).status).toBe(401);
    expect((await routes.sweep.POST()).status).toBe(401);
    expect(
      (await routes.revoked.POST(post('/api/spend-permission/revoked', { txHash: '0xab' }))).status,
    ).toBe(401);
  });
});

describe('POST /api/freeze', () => {
  it('stops the wallet on a valid owner signature and audits it', async () => {
    signedIn();
    const res = await signAndSubmit('freeze', owner, routes.freeze, '/api/freeze');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body['frozen']).toBe(true);
    expect(body['alreadyFrozen']).toBe(false);

    expect((await getWalletById(db, walletId))?.frozen).toBe(true);
    const audit = await listAuditPage(db, walletId, { limit: 50 });
    expect(audit.some((r) => r.event === 'FROZEN')).toBe(true);
  });

  it('is idempotent: freezing an already-frozen wallet succeeds as a no-op', async () => {
    signedIn();
    await signAndSubmit('freeze', owner, routes.freeze, '/api/freeze');
    const second = await signAndSubmit('freeze', owner, routes.freeze, '/api/freeze');
    expect(second.status).toBe(200);
    expect((await json(second))['alreadyFrozen']).toBe(true);
  });

  it('cancels pending approvals (SECURITY §4 step 2)', async () => {
    signedIn();
    const decision = await insertAgentDecision(db, {
      walletId,
      trigger: 'owner',
      contextSnapshot: {},
      contextHash: `0x${'0'.repeat(64)}`,
      proposalSource: 'deterministic',
      status: 'escalated',
    });
    await insertApproval(db, {
      walletId,
      decisionId: decision.id,
      proposalHash: `0x${'7'.repeat(64)}`,
      message: 'Steward approval',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await signAndSubmit('freeze', owner, routes.freeze, '/api/freeze');
    expect((await json(res))['cancelledApprovals']).toBe(1);
  });

  it('refuses a signature from another wallet', async () => {
    signedIn();
    const res = await signAndSubmit('freeze', other, routes.freeze, '/api/freeze');
    expect(res.status).toBe(401);
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
  });

  it('refuses a replay of the same signature (the nonce is single-use)', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const signature = await owner.signMessage({ message: prepared['message'] as string });
    expect((await routes.freeze.POST(post('/api/freeze', { signature }))).status).toBe(200);
    await setWalletFrozen(db, walletId, false, null, new Date());
    const replay = await routes.freeze.POST(post('/api/freeze', { signature }));
    expect(replay.status).toBe(400);
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
  });

  it('refuses an unfreeze confirmation spent on a freeze', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'unfreeze' })),
    );
    const signature = await owner.signMessage({ message: prepared['message'] as string });
    const res = await routes.freeze.POST(post('/api/freeze', { signature }));
    expect(res.status).toBe(400);
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
  });

  it('issues a message naming the action and the wallet, with a nonce and an expiry', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const message = prepared['message'] as string;
    expect(message.split('\n')[0]).toBe('Steward freeze');
    expect(message).toContain(`Wallet: ${walletId}`);
    expect(message).toMatch(/\nNonce: [0-9a-f]{32}\n/);
    expect(message).toMatch(/\nExpires: \d{4}-\d\d-\d\dT/);
  });
});

describe('POST /api/unfreeze', () => {
  it('needs a valid owner signature and clears the breaker', async () => {
    signedIn();
    await setWalletFrozen(db, walletId, true, 'breaker', new Date());
    expect((await signAndSubmit('unfreeze', other, routes.unfreeze, '/api/unfreeze')).status).toBe(
      401,
    );
    expect((await getWalletById(db, walletId))?.frozen).toBe(true);

    const ok = await signAndSubmit('unfreeze', owner, routes.unfreeze, '/api/unfreeze');
    expect(ok.status).toBe(200);
    const wallet = await getWalletById(db, walletId);
    expect(wallet?.frozen).toBe(false);
    expect(wallet?.breakerOpen).toBe(false);
    const audit = await listAuditPage(db, walletId, { limit: 50 });
    expect(audit.some((r) => r.event === 'UNFROZEN')).toBe(true);
  });

  it('is idempotent on a running wallet', async () => {
    signedIn();
    const res = await signAndSubmit('unfreeze', owner, routes.unfreeze, '/api/unfreeze');
    expect(res.status).toBe(200);
    expect((await json(res))['alreadyRunning']).toBe(true);
  });
});

describe('the sweep is the only action allowed while frozen', () => {
  it('refuses on a running wallet', async () => {
    signedIn();
    const res = await routes.sweep.POST();
    expect(res.status).toBe(409);
    expect((await json(res))['error']).toMatchObject({ code: 'not_frozen' });
  });

  it('reports no sweep before one has been attempted', async () => {
    signedIn();
    expect((await json(await routes.sweep.GET()))['state']).toBe('none');
  });
});

describe('GET /api/freeze (resume state)', () => {
  it('describes all three steps from server rows', async () => {
    signedIn();
    const body = await json(await routes.freeze.GET(get('/api/freeze')));
    expect(body['frozen']).toBe(false);
    // No permission was ever granted in this fixture, so there is nothing to revoke.
    expect(body['revoke']).toMatchObject({ state: 'none' });
    expect(body['sweep']).toMatchObject({ state: 'none' });
  });
});

describe('POST /api/spend-permission/revoked', () => {
  it('404s when there is no permission to revoke', async () => {
    signedIn();
    const res = await routes.revoked.POST(
      post('/api/spend-permission/revoked', { txHash: `0x${'ab'.repeat(32)}` }),
    );
    expect(res.status).toBe(404);
  });
});
