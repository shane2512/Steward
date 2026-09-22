// Phase 7 addendum — POST /api/auth/verify against a REAL Postgres and a REAL SIWE signature.
//
// The one thing that must never go wrong: the treasury an EOA owner is given is a derived Coinbase
// Smart Wallet, it is NOT the EOA, and it is the SAME address on every subsequent sign-in. A second
// answer would strand whatever the owner had already sent to the first.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
  getAddress,
  keccak256,
  verifyMessage,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const owner = privateKeyToAccount(`0x${'31'.repeat(32)}` as Hex);
const smartWalletOwner = privateKeyToAccount(`0x${'32'.repeat(32)}` as Hex);

const session = vi.hoisted(() => ({
  current: {} as { nonce?: string; nonceIssuedAt?: number; userId?: string; address?: string },
}));
vi.mock('../lib/session', () => ({
  getSession: async () => ({
    get nonce() {
      return session.current.nonce;
    },
    set nonce(v: string | undefined) {
      session.current.nonce = v;
    },
    get nonceIssuedAt() {
      return session.current.nonceIssuedAt;
    },
    set nonceIssuedAt(v: number | undefined) {
      session.current.nonceIssuedAt = v;
    },
    set userId(v: string | undefined) {
      session.current.userId = v;
    },
    set address(v: string | undefined) {
      session.current.address = v;
    },
    save: async () => {},
  }),
}));

/** The signer's on-chain code, swapped per test: '0x' is an EOA, real code is a contract wallet. */
const chain = vi.hoisted(() => ({ code: '0x' as Hex }));

vi.mock('../lib/server', async (orig) => {
  const real = await orig<typeof import('../lib/server')>();
  // A real viem client (so the factory read in the derivation runs through real plumbing) with a
  // transport that answers eth_call deterministically, plus a local ecrecover for SIWE.
  const base = createPublicClient({
    chain: baseSepolia,
    transport: custom({
      request: async ({ method, params }) => {
        if (method !== 'eth_call') throw new Error(`unexpected RPC: ${method}`);
        return keccak256((params as [{ data: Hex }])[0].data);
      },
    }),
  });
  const client = {
    ...base,
    getCode: async () => chain.code,
    verifyMessage: (a: { address: `0x${string}`; message: string; signature: Hex }) =>
      verifyMessage(a),
  };
  return { ...real, getPublicClient: () => client };
});

import { freshTestDb, testDbUrl } from '../../../packages/db/test/helpers';
import { getWalletByUserId, type Db } from '@steward/db';

let db: Db;
let pool: { end: () => Promise<void> };
let route: typeof import('../app/api/auth/verify/route');

const NONCE = 'abcdef123456';
const DOMAIN = 'localhost:3000';

async function signIn(account: typeof owner): Promise<Response> {
  session.current = { nonce: NONCE, nonceIssuedAt: Date.now() };
  const message = createSiweMessage({
    address: account.address,
    chainId: 84532,
    domain: DOMAIN,
    nonce: NONCE,
    uri: `http://${DOMAIN}`,
    version: '1',
    issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });
  return route.POST(
    new Request(`http://${DOMAIN}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    }),
  );
}

const treasuryOf = async (address: string): Promise<string> => {
  const userId = session.current.userId;
  expect(userId).toBeTruthy();
  const wallet = await getWalletByUserId(db, userId!);
  expect(wallet).toBeTruthy();
  expect(getAddress(session.current.address!)).toBe(getAddress(address));
  return getAddress(wallet!.treasuryAddress);
};

beforeAll(async () => {
  const fresh = await freshTestDb();
  db = fresh.db;
  pool = fresh.pool;
  vi.stubEnv('DATABASE_URL', testDbUrl());
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
  vi.stubEnv('CHAIN_ID', '84532');
  vi.stubEnv('NODE_ENV', 'test');
  route = await import('../app/api/auth/verify/route');
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  chain.code = '0x';
});

describe('POST /api/auth/verify — treasury assignment', () => {
  it('gives an EOA owner a derived companion treasury, not its own address', async () => {
    const res = await signIn(owner);
    expect(res.status).toBe(200);
    const treasury = await treasuryOf(owner.address);
    expect(treasury).not.toBe(getAddress(owner.address));
  });

  it('resolves the same EOA to the SAME treasury on every later sign-in (idempotent)', async () => {
    const first = await treasuryOf(owner.address);
    for (let i = 0; i < 3; i++) {
      const res = await signIn(owner);
      expect(res.status).toBe(200);
      expect(await treasuryOf(owner.address)).toBe(first);
    }
  });

  it('keeps the raw address as the treasury for a real smart wallet (existing behaviour)', async () => {
    chain.code = '0x60806040'; // deployed contract wallet
    const res = await signIn(smartWalletOwner);
    expect(res.status).toBe(200);
    expect(await treasuryOf(smartWalletOwner.address)).toBe(
      getAddress(smartWalletOwner.address),
    );
  });

  it('the sign-in identity stays the EOA — only the treasury differs', async () => {
    await signIn(owner);
    expect(getAddress(session.current.address!)).toBe(getAddress(owner.address));
  });
});
