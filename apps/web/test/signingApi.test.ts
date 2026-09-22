// Route tests for the task 7.6 signing endpoints, against a REAL Postgres and a REAL signature.
//
// What these are here to prove, one test each:
//   - a session cookie alone can never sign anything into existence (auth + signature both required);
//   - the server re-derives the message it verifies, so it only accepts one it would have issued;
//   - a replay of the same bytes is refused (policy version primary key; recipient nonce spent);
//   - an expired confirmation is refused;
//   - a wrong signer is refused;
//   - nothing secret ever appears in a response (I9).
//
// `getPublicClient` is replaced with a local EOA verifier: viem's `verifyMessage` on a real public
// client is an RPC call, and these tests must not need a chain. Everything else — the routes, the
// schemas, the database, the audit chain — is the real thing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const OWNER_KEY = `0x${'11'.repeat(32)}` as Hex;
const OTHER_KEY = `0x${'22'.repeat(32)}` as Hex;
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const session = vi.hoisted(() => ({
  current: {} as {
    userId?: string;
    address?: string;
    recipientNonce?: string;
    recipientNonceAt?: number;
  },
}));
vi.mock('../lib/session', () => ({
  getSession: async () => ({
    ...session.current,
    save: async () => {
      /* the object above IS the session: mutations land on it */
    },
    set recipientNonce(v: string | undefined) {
      session.current.recipientNonce = v;
    },
    get recipientNonce() {
      return session.current.recipientNonce;
    },
    set recipientNonceAt(v: number | undefined) {
      session.current.recipientNonceAt = v;
    },
    get recipientNonceAt() {
      return session.current.recipientNonceAt;
    },
  }),
}));

vi.mock('../lib/server', async (orig) => {
  const real = await orig<typeof import('../lib/server')>();
  return {
    ...real,
    getPublicClient: () => ({
      // Local EOA equivalent of viem's ERC-1271/6492-aware check.
      verifyMessage: async (a: { address: string; message: string; signature: Hex }) =>
        getAddress(await recoverMessageAddress({ message: a.message, signature: a.signature })) ===
        getAddress(a.address),
    }),
  };
});

import { freshTestDb, testDbUrl } from '../../../packages/db/test/helpers';
import {
  ensureWalletForUser,
  insertMandate,
  listRecipients,
  upsertUserByAddress,
  type Db,
} from '@steward/db';
import { policyDraftFromTemplate } from '@steward/policy';
import { canonicalJson } from '@steward/shared';
import { zRecipientAddBody, zRecipientFields } from '../lib/recipientSchemas';

const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const VAULT = getAddress('0x3741f0da6dFFfFD8Be2353e326a49E41a3396485');
const PAYEE = getAddress('0x4b2e0000000000000000000000000000000009f1');

let db: Db;
let pool: { end: () => Promise<void> };
let walletId: string;
let routes: {
  policyPrepare: typeof import('../app/api/policy/prepare/route');
  policyActivate: typeof import('../app/api/policy/activate/route');
  recipients: typeof import('../app/api/recipients/route');
  recipientsPrepare: typeof import('../app/api/recipients/prepare/route');
};

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
  const wallet = await ensureWalletForUser(db, user.id, 84532, owner.address);
  walletId = wallet.id;

  const draft = policyDraftFromTemplate('startup', {
    chainId: 84532,
    treasuryAddress: getAddress(owner.address),
    usdcAddress: USDC,
    vaults: [{ id: 'v1', name: 'Mock vault', address: VAULT, maxAllocationBps: 5_000 }],
    recipients: [],
  });
  if (!draft.ok) throw new Error(`template did not compile: ${JSON.stringify(draft.error)}`);
  await insertMandate(db, {
    walletId: wallet.id,
    text: 'Keep the buffer liquid and pay the team.',
    template: 'startup',
    compiledDraft: JSON.parse(canonicalJson(draft.value)) as unknown,
    assumptions: [],
    questions: [],
  });

  session.current = { userId: user.id, address: owner.address };
  routes = {
    policyPrepare: await import('../app/api/policy/prepare/route'),
    policyActivate: await import('../app/api/policy/activate/route'),
    recipients: await import('../app/api/recipients/route'),
    recipientsPrepare: await import('../app/api/recipients/prepare/route'),
  };
});

afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  session.current.userId = undefined;
  session.current.address = undefined;
  session.current.recipientNonce = undefined;
  session.current.recipientNonceAt = undefined;
});

const signedIn = async () => {
  const user = await upsertUserByAddress(db, owner.address, new Date());
  session.current.userId = user.id;
  session.current.address = owner.address;
};

const body = async (r: Response) => (await r.json()) as Record<string, never>;

// ─────────────────────────────────────────────────────────────────── auth

describe('every signing route requires a session', () => {
  it('refuses an anonymous caller', async () => {
    expect((await routes.policyPrepare.POST()).status).toBe(401);
    expect(
      (await routes.policyActivate.POST(post('/api/policy/activate', { signature: '0x00' })))
        .status,
    ).toBe(401);
    expect((await routes.recipientsPrepare.POST(post('/api/recipients/prepare', {}))).status).toBe(
      401,
    );
    expect((await routes.recipients.POST(post('/api/recipients', {}))).status).toBe(401);
    expect((await routes.recipients.GET()).status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────── policy routes

describe('POST /api/policy/prepare + /activate', () => {
  it('prepares a message bound to the version and the body hash, deterministically', async () => {
    await signedIn();
    const a = (await body(await routes.policyPrepare.POST())) as unknown as {
      version: number;
      bodyHash: string;
      message: string;
      sentences: string[];
      diff: { previousVersion: number | null };
    };
    const b = (await body(await routes.policyPrepare.POST())) as unknown as { message: string };
    expect(a.version).toBe(1);
    expect(a.message).toBe(`Steward policy v1 ${a.bodyHash}`);
    expect(b.message).toBe(a.message); // preparing twice must not move the hash
    expect(a.sentences.length).toBeGreaterThan(0);
    expect(a.diff.previousVersion).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/signature/i);
  });

  it('rejects garbage and a missing signature', async () => {
    await signedIn();
    for (const bad of [{}, { signature: 'not-hex' }, { signature: '0xab', extra: 1 }, null]) {
      expect((await routes.policyActivate.POST(post('/api/policy/activate', bad))).status).toBe(
        400,
      );
    }
  });

  it('rejects a signature from the wrong signer', async () => {
    await signedIn();
    const p = (await body(await routes.policyPrepare.POST())) as unknown as { message: string };
    const sig = await other.signMessage({ message: p.message });
    const res = await routes.policyActivate.POST(post('/api/policy/activate', { signature: sig }));
    expect(res.status).toBe(401);
    expect((await body(res)) as unknown).toMatchObject({ error: { code: 'bad_signature' } });
  });

  it('rejects a signature over a message the server would not have issued', async () => {
    await signedIn();
    const sig = await owner.signMessage({ message: 'Steward policy v1 0xdeadbeef' });
    expect(
      (await routes.policyActivate.POST(post('/api/policy/activate', { signature: sig }))).status,
    ).toBe(401);
  });

  it('activates on a good signature, and refuses the replay of that same signature', async () => {
    await signedIn();
    const p = (await body(await routes.policyPrepare.POST())) as unknown as { message: string };
    const sig = await owner.signMessage({ message: p.message });

    const first = await routes.policyActivate.POST(
      post('/api/policy/activate', { signature: sig }),
    );
    expect(first.status).toBe(200);
    expect((await body(first)) as unknown).toMatchObject({ version: 1, cancelledApprovals: 0 });

    // The same bytes again: v2 is now what would be prepared, so the old message no longer matches.
    const replay = await routes.policyActivate.POST(
      post('/api/policy/activate', { signature: sig }),
    );
    expect(replay.status).toBe(401);
  });

  it('the next prepare is v2 and diffs against the active version', async () => {
    await signedIn();
    const p = (await body(await routes.policyPrepare.POST())) as unknown as {
      version: number;
      diff: { previousVersion: number | null; added: string[]; removed: string[] };
    };
    expect(p.version).toBe(2);
    expect(p.diff.previousVersion).toBe(1);
  });
});

// ────────────────────────────────────────────────────────── recipient routes

describe('recipient body schemas', () => {
  const good = { label: 'Devon Achebe', address: PAYEE, maxPerTx: '4000000000' };

  it('accepts the owner-controllable fields only', () => {
    expect(zRecipientFields.safeParse(good).success).toBe(true);
    // no smuggled walletId, id or status
    for (const field of ['walletId', 'id', 'status', 'addedSignature']) {
      expect(zRecipientFields.safeParse({ ...good, [field]: 'x' }).success).toBe(false);
    }
  });

  it('refuses a label that could forge a line of the signing message', () => {
    expect(zRecipientFields.safeParse({ ...good, label: 'A\nAddress: 0xdead' }).success).toBe(
      false,
    );
  });

  it('refuses anything that is not 40 hex digits', () => {
    for (const address of ['0x123', 'mara.eth', `${PAYEE}00`, '']) {
      expect(zRecipientFields.safeParse({ ...good, address }).success).toBe(false);
    }
  });

  it('requires a hex signature to add', () => {
    expect(zRecipientAddBody.safeParse(good).success).toBe(false);
    expect(zRecipientAddBody.safeParse({ ...good, signature: '0xabcd' }).success).toBe(true);
  });
});

describe('POST /api/recipients/prepare + POST /api/recipients', () => {
  // A distinct address per test: an added recipient is a duplicate for every later prepare.
  const addressOf = (n: number) => getAddress(`0x4b2e${String(n).padStart(36, '0')}`);
  const fieldsFor = (n: number) => ({
    label: 'Devon Achebe',
    address: addressOf(n).toLowerCase(),
    maxPerTx: '4000000000',
  });

  const prepare = async (n: number) =>
    (await body(
      await routes.recipientsPrepare.POST(post('/api/recipients/prepare', fieldsFor(n))),
    )) as unknown as { message: string; address: string; expiresAt: string };

  it('checksums the address itself and issues a single-use nonce', async () => {
    await signedIn();
    const p = await prepare(1);
    const PAYEE = addressOf(1);
    expect(p.address).toBe(PAYEE); // checksummed, not what was typed
    expect(p.message).toContain(`Address: ${PAYEE}`);
    expect(p.message.startsWith('Steward recipient\n')).toBe(true);
    expect(session.current.recipientNonce).toBeTruthy();
    expect(p.message).toContain(`Nonce: ${session.current.recipientNonce}`);
  });

  it('adds the recipient on a good signature and says a policy signature is still needed', async () => {
    await signedIn();
    const p = await prepare(2);
    const signature = await owner.signMessage({ message: p.message });
    const res = await routes.recipients.POST(
      post('/api/recipients', { ...fieldsFor(2), signature }),
    );
    expect(res.status).toBe(200);
    const added = (await body(res)) as unknown as {
      recipient: { address: string };
      needsPolicySignature: boolean;
    };
    expect(added.recipient.address).toBe(addressOf(2));
    // the active policy (v1) has no recipients, so the owner must sign a new version
    expect(added.needsPolicySignature).toBe(true);
    expect(JSON.stringify(added)).not.toContain(signature);
  });

  it('a replay of the same signed request is refused: the nonce was spent', async () => {
    await signedIn();
    const p = await prepare(3);
    const signature = await owner.signMessage({ message: p.message });
    expect(
      (await routes.recipients.POST(post('/api/recipients', { ...fieldsFor(3), signature })))
        .status,
    ).toBe(200);
    const replay = await routes.recipients.POST(
      post('/api/recipients', { ...fieldsFor(3), signature }),
    );
    expect(replay.status).toBe(409);
    expect((await body(replay)) as unknown).toMatchObject({ error: { code: 'nonce_expired' } });
  });

  it('an expired confirmation is refused', async () => {
    await signedIn();
    const p = await prepare(4);
    const signature = await owner.signMessage({ message: p.message });
    session.current.recipientNonceAt = Date.now() - 10 * 60_000; // older than the 5 min TTL
    const res = await routes.recipients.POST(
      post('/api/recipients', { ...fieldsFor(4), signature }),
    );
    expect(res.status).toBe(409);
    expect((await body(res)) as unknown).toMatchObject({ error: { code: 'nonce_expired' } });
  });

  it('a signature from another wallet is refused', async () => {
    await signedIn();
    const p = await prepare(5);
    const signature = await other.signMessage({ message: p.message });
    const res = await routes.recipients.POST(
      post('/api/recipients', { ...fieldsFor(5), signature }),
    );
    expect(res.status).toBe(401);
    expect((await body(res)) as unknown).toMatchObject({ error: { code: 'bad_signature' } });
  });

  it('changing a field after signing is refused: the message no longer matches', async () => {
    await signedIn();
    const p = await prepare(6);
    const signature = await owner.signMessage({ message: p.message });
    const res = await routes.recipients.POST(
      post('/api/recipients', { ...fieldsFor(6), maxPerTx: '250000000', signature }),
    );
    expect(res.status).toBe(401);
  });

  it('refuses a second entry for the same address', async () => {
    await signedIn();
    const first = await listRecipients(db, walletId);
    expect(first.some((r) => r.address === addressOf(2))).toBe(true);
    const res = await routes.recipientsPrepare.POST(post('/api/recipients/prepare', fieldsFor(2)));
    expect(res.status).toBe(409);
    expect((await body(res)) as unknown).toMatchObject({ error: { code: 'duplicate_recipient' } });
  });

  it('GET returns the allowlist and never a signature', async () => {
    await signedIn();
    const res = await routes.recipients.GET();
    const list = (await body(res)) as unknown as { recipients: { address: string }[] };
    expect(list.recipients.some((r) => r.address === addressOf(2))).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/addedSignature|0x[0-9a-f]{100,}/i);
  });

  it('the new recipient reaches the NEXT policy version, which the owner must sign', async () => {
    await signedIn();
    const p = (await body(await routes.policyPrepare.POST())) as unknown as {
      version: number;
      sentences: string[];
      diff: { added: string[] };
    };
    expect(p.version).toBe(2);
    // the recipient added above is now inside the body the owner would be signing
    expect(JSON.stringify(p.sentences)).toContain('Devon Achebe');
    expect(p.diff.added.some((s) => s.includes('Devon Achebe'))).toBe(true);
  });
});
