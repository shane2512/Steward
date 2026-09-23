// 8.2 — session hardening and rate limiting.
//
// Three things are asserted here, each of which a future refactor could silently undo:
//   1. the session cookie's attributes (httpOnly, SameSite=strict, Secure in production, short TTL)
//      — the SameSite value is what makes every state-changing route CSRF-resistant without a token;
//   2. the rate limiter's behaviour: normal use passes, the limit returns 429 with Retry-After, the
//      window resets, and buckets/identities do not bleed into each other;
//   3. that the owner's STOP path is deliberately NOT rate limited (I7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, clientIp, rateLimit, resetRateLimits } from '../lib/rateLimit';
import { SESSION_TTL_SECONDS, sessionOptions } from '../lib/session';

afterEach(() => {
  resetRateLimits();
  vi.unstubAllEnvs();
});

const options = () => {
  vi.stubEnv('DATABASE_URL', 'postgres://steward:steward@localhost:5433/steward');
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
  return sessionOptions();
};

describe('the session cookie', () => {
  it('is httpOnly and SameSite=strict — this is the CSRF control', () => {
    const o = options();
    expect(o.cookieOptions?.httpOnly).toBe(true);
    // Not 'lax': a lax cookie is sent on a cross-site top-level navigation, and Steward has no
    // cross-site entry point that needs one.
    expect(o.cookieOptions?.sameSite).toBe('strict');
    expect(o.cookieOptions?.path).toBe('/');
  });

  it('is Secure in production and not in development (so localhost still works)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(options().cookieOptions?.secure).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(options().cookieOptions?.secure).toBe(false);
  });

  it('expires within a working day, not a week', () => {
    expect(SESSION_TTL_SECONDS).toBeLessThanOrEqual(24 * 60 * 60);
    expect(options().ttl).toBe(SESSION_TTL_SECONDS);
  });

  it('does not leak the secret through the returned options object', () => {
    // `password` has to be the raw value for iron-session, so the guarantee is that it is read from
    // the Secret at the point of use and never logged — asserted in packages/shared's redaction
    // suite. What must hold here is that it is the env value and nothing else is attached.
    expect(options().password).toBe('x'.repeat(40));
    expect(options().cookieName).toBe('steward_session');
  });
});

describe('the rate limiter', () => {
  const bucket = 'mandate.compile';
  const { limit, windowMs } = RATE_LIMITS[bucket];

  it('lets normal use through', () => {
    for (let i = 0; i < limit; i += 1) expect(rateLimit(bucket, 'alice', 1000)).toBeNull();
  });

  it('returns 429 with a Retry-After once the limit is passed', async () => {
    for (let i = 0; i < limit; i += 1) rateLimit(bucket, 'alice', 1000);
    const res = rateLimit(bucket, 'alice', 1000);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await res!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('resets when the window has passed', () => {
    for (let i = 0; i < limit + 3; i += 1) rateLimit(bucket, 'alice', 1000);
    expect(rateLimit(bucket, 'alice', 1000)).not.toBeNull();
    expect(rateLimit(bucket, 'alice', 1000 + windowMs)).toBeNull();
    expect(rateLimit(bucket, 'alice', 1000 + windowMs + 1)).toBeNull();
  });

  it('counts each identity separately', () => {
    for (let i = 0; i < limit + 1; i += 1) rateLimit(bucket, 'alice', 1000);
    expect(rateLimit(bucket, 'alice', 1000)).not.toBeNull();
    expect(rateLimit(bucket, 'bob', 1000)).toBeNull();
  });

  it('counts each bucket separately, so one expensive route cannot starve another', () => {
    for (let i = 0; i < limit + 1; i += 1) rateLimit(bucket, 'alice', 1000);
    expect(rateLimit(bucket, 'alice', 1000)).not.toBeNull();
    expect(rateLimit('agent.run', 'alice', 1000)).toBeNull();
  });

  it('has no bucket for the owner stop path (I7: freezing is never refused)', () => {
    // If someone adds one, this fails and they have to justify it against I7 first.
    expect(Object.keys(RATE_LIMITS)).not.toContain('freeze');
    expect(Object.keys(RATE_LIMITS)).not.toContain('freeze.prepare');
    expect(Object.keys(RATE_LIMITS)).not.toContain('spend-permission.revoked');
  });

  it('gives every bucket a positive limit and a real window', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowMs, name).toBeGreaterThanOrEqual(60_000);
    }
  });

  // ── 8.7 red-team RT-3 ─────────────────────────────────────────────────────────────────────────
  // "Can the per-user / per-IP keying be bypassed to still exhaust a resource?" Two halves, and the
  // answers are different. Both are pinned here so the trust boundary is a test, not a comment.

  it('RT-3: an authenticated bucket is keyed by userId, so headers cannot widen it', () => {
    // Every expensive bucket that costs Steward money or gas (mandate.compile, agent.run, sweep,
    // unfreeze) is keyed by the session userId. A caller controls their headers but not their
    // userId, so rotating IPs, proxies or user agents buys nothing.
    for (const b of ['mandate.compile', 'agent.run', 'sweep', 'unfreeze'] as const) {
      const { limit } = RATE_LIMITS[b];
      for (let i = 0; i < limit; i += 1) expect(rateLimit(b, 'user-1', 1000)).toBeNull();
      expect(rateLimit(b, 'user-1', 1000)).not.toBeNull();
      // A second identity is untouched — that is the point of keying, not a bypass.
      expect(rateLimit(b, 'user-2', 1000)).toBeNull();
    }
  });

  it('RT-3: the UNAUTHENTICATED buckets follow x-forwarded-for — a known, deployment-level bound', () => {
    // KNOWN AND ACCEPTED (8.7 finding RT-3, LOW). `clientIp` trusts the first hop of
    // x-forwarded-for, which is correct behind exactly one proxy that sets it (Vercel overwrites the
    // header at its edge) and forged-able if the app is ever exposed directly. A forger cannot
    // borrow somebody else's allowance — but they can mint fresh ones for themselves, so the SIWE
    // handshake limit is a cost control, never a security control. Nothing behind it moves funds:
    // /api/auth/nonce writes a cookie, /api/auth/verify does one ecrecover or eth_call.
    const { limit } = RATE_LIMITS['auth.nonce'];
    for (let i = 0; i < limit; i += 1)
      expect(rateLimit('auth.nonce', '198.51.100.1', 1000)).toBeNull();
    expect(rateLimit('auth.nonce', '198.51.100.1', 1000)).not.toBeNull();
    // Rotating the claimed address gets a fresh window. This test exists to record that fact.
    expect(rateLimit('auth.nonce', '198.51.100.2', 1000)).toBeNull();
  });
});

// End-to-end: an actual route handler, not just the limiter in isolation. `/api/auth/nonce` is the
// cheapest one to drive — it needs no session and no database.
describe('GET /api/auth/nonce is really limited', () => {
  it('serves nonces then 429s the same IP, without touching another IP', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://steward:steward@localhost:5433/steward');
    vi.stubEnv('SESSION_SECRET', 'x'.repeat(40));
    const saved: Record<string, unknown> = {};
    vi.doMock('../lib/session', () => ({
      getSession: async () => Object.assign(saved, { save: async () => undefined }),
    }));
    const route = await import('../app/api/auth/nonce/route');
    const from = (ip: string) =>
      route.GET(
        new Request('http://localhost:3000/api/auth/nonce', { headers: { 'x-forwarded-for': ip } }),
      );

    const { limit } = RATE_LIMITS['auth.nonce'];
    for (let i = 0; i < limit; i += 1) expect((await from('203.0.113.9')).status).toBe(200);
    expect((await from('203.0.113.9')).status).toBe(429);
    expect((await from('203.0.113.10')).status).toBe(200);
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/auth/nonce', { headers });

  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(req({}))).toBe('unknown');
  });

  it('does not let a blank forwarded header swallow the real one', () => {
    expect(clientIp(req({ 'x-forwarded-for': '  ', 'x-real-ip': '198.51.100.2' }))).toBe(
      '198.51.100.2',
    );
  });
});
