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
  verifyChain,
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
  action: 'freeze' | 'unfreeze' | 'sweep',
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
    expect((await routes.sweep.POST(post('/api/sweep', { signature: '0x00' }))).status).toBe(401);
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
    // 8.2: the signature is checked FIRST, so this needs a real one to reach the frozen check.
    const res = await signAndSubmit('sweep', owner, routes.sweep, '/api/sweep');
    expect(res.status).toBe(409);
    expect((await json(res))['error']).toMatchObject({ code: 'not_frozen' });
  });

  // 8.2 — the sweep is a real on-chain transaction, so a session alone must not be able to start one.
  it('refuses without a signature at all', async () => {
    signedIn();
    expect((await routes.sweep.POST(post('/api/sweep'))).status).toBe(400);
  });

  it('refuses a signature from someone other than the owner', async () => {
    signedIn();
    const res = await signAndSubmit('sweep', other, routes.sweep, '/api/sweep');
    expect(res.status).toBe(401);
    expect((await json(res))['error']).toMatchObject({ code: 'bad_signature' });
  });

  it('refuses a FREEZE signature spent on the sweep route', async () => {
    signedIn();
    // The nonce was minted for `freeze`; the sweep route re-derives from the SESSION's action, so it
    // sees the mismatch and refuses without even looking at the signature.
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const signature = await owner.signMessage({ message: prepared['message'] as string });
    const res = await routes.sweep.POST(post('/api/sweep', { signature }));
    expect(res.status).toBe(400);
    expect((await json(res))['error']).toMatchObject({ code: 'nonce_expired' });
  });

  it('refuses a replayed sweep signature (the nonce is single-use)', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'sweep' })),
    );
    const signature = await owner.signMessage({ message: prepared['message'] as string });
    expect((await routes.sweep.POST(post('/api/sweep', { signature }))).status).toBe(409);
    const replay = await routes.sweep.POST(post('/api/sweep', { signature }));
    expect(replay.status).toBe(400);
    expect((await json(replay))['error']).toMatchObject({ code: 'nonce_expired' });
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

// ── 8.7 red-team RT-4 ────────────────────────────────────────────────────────────────────────────
// "Can two concurrent freeze / unfreeze / sweep requests race into an inconsistent state?"
//
// The single-use nonce lives in the SESSION. In this harness (and in any shared session store) the
// read-and-clear is synchronous, so exactly one concurrent request can spend it. iron-session is a
// stateless COOKIE, though: two requests sent together each carry their own decrypted copy, so in
// production the same confirmation can be spent twice inside its 2-minute TTL. That is recorded as
// finding RT-4 (LOW), and the reason it is LOW is asserted here — every outcome on this path is
// idempotent and in the SAFE direction, so a doubled request changes nothing.
describe('RT-4 — concurrent owner-path requests', () => {
  it('only one of five concurrent freezes can spend the confirmation', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const signature = await owner.signMessage({ message: prepared['message'] as string });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => routes.freeze.POST(post('/api/freeze', { signature }))),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
    expect((await getWalletById(db, walletId))?.frozen).toBe(true);
  });

  it('a REPLAYED confirmation (the cookie-copy race) is still a safe no-op', async () => {
    signedIn();
    const prepared = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const message = prepared['message'] as string;
    const signature = await owner.signMessage({ message });
    const nonce = sess().freezeNonce;
    const at = sess().freezeNonceAt;

    expect((await routes.freeze.POST(post('/api/freeze', { signature }))).status).toBe(200);
    // Put the cookie back exactly as a second concurrent request would still have it.
    sess().freezeNonce = nonce;
    sess().freezeNonceAt = at;
    sess().freezeAction = 'freeze';
    const again = await routes.freeze.POST(post('/api/freeze', { signature }));
    expect(again.status).toBe(200);
    expect((await json(again))['alreadyFrozen']).toBe(true);

    // The end state is exactly the same as after one request: frozen, and still frozen.
    expect((await getWalletById(db, walletId))?.frozen).toBe(true);
    const chain = await verifyChain(db, walletId);
    expect(chain.ok).toBe(true);
  });

  it('a freeze racing an unfreeze cannot leave the wallet running with an unspent freeze', async () => {
    signedIn();
    await setWalletFrozen(db, walletId, true, 'owner', new Date());
    // Two confirmations cannot coexist: `/prepare` overwrites the session slot, so the second
    // action is the only one that can be spent. A captured signature for the other action is
    // refused by the action check (D-90) rather than applied out of order — and, since the RT-4
    // fix, that refusal does NOT consume the live confirmation, so the owner's own action still
    // lands even when a stale request for the opposite one arrives at the same moment.
    const freezePrep = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'freeze' })),
    );
    const freezeSig = await owner.signMessage({ message: freezePrep['message'] as string });
    const unfreezePrep = await json(
      await routes.prepare.POST(post('/api/freeze/prepare', { action: 'unfreeze' })),
    );
    const unfreezeSig = await owner.signMessage({ message: unfreezePrep['message'] as string });

    const [a, b] = await Promise.all([
      routes.freeze.POST(post('/api/freeze', { signature: freezeSig })),
      routes.unfreeze.POST(post('/api/unfreeze', { signature: unfreezeSig })),
    ]);
    // The freeze is refused (its confirmation was overwritten) and the unfreeze still succeeds.
    expect(a.status).toBe(400);
    expect(b.status).toBe(200);
    expect((await getWalletById(db, walletId))?.frozen).toBe(false);
    expect((await verifyChain(db, walletId)).ok).toBe(true);
  });
});
