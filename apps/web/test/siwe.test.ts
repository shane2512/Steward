import { describe, expect, it } from 'vitest';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { NONCE_TTL_MS, verifySiwe, type SignatureVerifier } from '../lib/siwe';

// Test key is generated per run; never a real secret. EOA-only (smart wallets untested, see PROGRESS D-5).
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const now = new Date('2026-09-20T12:00:00Z');
const nonce = 'abcdef123456';
const domain = 'localhost:3000';
// EOA verification via local ecrecover; prod uses publicClient.verifyMessage.
const verify: SignatureVerifier = (a) => verifyMessage(a);

const msg = (over: { nonce?: string; domain?: string; chainId?: number } = {}) =>
  createSiweMessage({
    address: account.address,
    chainId: over.chainId ?? 84532,
    domain: over.domain ?? domain,
    nonce: over.nonce ?? nonce,
    uri: `http://${domain}`,
    version: '1',
    issuedAt: now,
  });

const base = {
  expectedNonce: nonce,
  nonceIssuedAt: now.getTime(),
  domain,
  chainId: 84532,
  now,
  verify,
};

describe('SIWE', () => {
  it('happy path returns the checksummed signer address', async () => {
    const message = msg();
    const signature = await account.signMessage({ message });
    expect(await verifySiwe({ ...base, message, signature })).toEqual({
      ok: true,
      value: account.address,
    });
  });

  it('rejects a signature from a different key', async () => {
    const message = msg();
    const signature = await other.signMessage({ message });
    const r = await verifySiwe({ ...base, message, signature });
    expect(r).toEqual({ ok: false, error: 'invalid signature' });
  });

  it('rejects an expired nonce', async () => {
    const message = msg();
    const signature = await account.signMessage({ message });
    const later = new Date(now.getTime() + NONCE_TTL_MS + 1);
    const r = await verifySiwe({ ...base, message, signature, now: later });
    expect(r).toEqual({ ok: false, error: 'nonce expired' });
  });

  it('rejects wrong nonce, wrong domain, wrong chain, and missing session nonce', async () => {
    const sign = async (message: string) => account.signMessage({ message });
    let m = msg({ nonce: 'otherNonce99' });
    expect((await verifySiwe({ ...base, message: m, signature: await sign(m) })).ok).toBe(false);
    m = msg({ domain: 'evil.example' });
    expect((await verifySiwe({ ...base, message: m, signature: await sign(m) })).ok).toBe(false);
    m = msg({ chainId: 8453 });
    expect((await verifySiwe({ ...base, message: m, signature: await sign(m) })).ok).toBe(false);
    m = msg();
    const s = await sign(m);
    expect(
      (await verifySiwe({ ...base, message: m, signature: s, expectedNonce: undefined })).ok,
    ).toBe(false);
  });
});
