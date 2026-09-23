// Route tests for the Phase 7 read/compile APIs: auth required, zod rejects garbage, fixtures are
// fenced, no secrets in output. No database: the session and wallet helpers are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  zConfig,
  zDashboard,
  zDecisionDetail,
  zDecisionList,
  zMe,
  zOnboarding,
} from '../lib/contracts';
import { decisionsQuery } from '../lib/decisionQuery';
import { FIXTURE_SCENARIOS } from '../lib/fixtureGate';
import {
  fixtureDashboard,
  fixtureDecisionDetail,
  fixtureDecisions,
  fixtureMe,
  fixtureOnboarding,
} from '../lib/fixtures';
import { compilerUnavailable, MANDATE_MAX_CHARS, zCompileBody } from '../lib/mandateApi';

// the routes pull in the wallet/db packages; loading them cold can be slow
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const session = vi.hoisted(() => ({ current: {} as { userId?: string; address?: string } }));
vi.mock('../lib/session', () => ({ getSession: async () => session.current }));

const BASE_ENV = {
  DATABASE_URL: 'postgres://steward:steward@localhost:5433/steward',
  SESSION_SECRET: 'x'.repeat(40),
  CHAIN_ID: '84532',
  NODE_ENV: 'test',
};

async function load(demo: boolean) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv('DEMO_MODE', demo ? 'true' : 'false');
  return {
    dashboard: await import('../app/api/dashboard/route'),
    onboarding: await import('../app/api/onboarding/route'),
    decisions: await import('../app/api/decisions/route'),
    decision: await import('../app/api/decisions/[id]/route'),
    me: await import('../app/api/me/route'),
    config: await import('../app/api/config/route'),
  };
}

const get = (path: string) => new Request(`http://localhost:3000${path}`);

beforeEach(() => {
  session.current = {};
});
afterEach(() => vi.unstubAllEnvs());

describe('fixtures satisfy the response contracts (the UI parses every response with these)', () => {
  for (const s of FIXTURE_SCENARIOS) {
    it(`scenario ${s}`, () => {
      expect(zDashboard.safeParse(fixtureDashboard(s)).success).toBe(true);
      expect(zMe.safeParse(fixtureMe(s)).success).toBe(true);
      expect(zOnboarding.safeParse(fixtureOnboarding(s)).success).toBe(true);
      expect(zDecisionList.safeParse(fixtureDecisions(s)).success).toBe(true);
      expect(zDecisionList.safeParse(fixtureDecisions(s, new Date().toISOString())).success).toBe(
        true,
      );
    });
  }
  it('every fixture decision has a valid detail, and a DENY explains why', () => {
    for (const d of fixtureDecisions('1').decisions) {
      const detail = fixtureDecisionDetail(d.id);
      expect(zDecisionDetail.safeParse(detail).success).toBe(true);
      if (d.verdict?.decision === 'DENY') expect(detail?.whyBlocked.length).toBeGreaterThan(1);
    }
    expect(fixtureDecisionDetail('nope')).toBeNull();
  });
  it('no fixture leaks a secret-shaped field', () => {
    const all = JSON.stringify([
      fixtureDashboard('1'),
      fixtureDecisions('1'),
      fixtureDecisionDetail('fx-3'),
    ]);
    expect(all).not.toMatch(/"(signature|secret|apiKey|privateKey|mac|receipt)"/i);
  });
});

describe('auth is required (no session, no data)', () => {
  it('401 on every owner-scoped read', async () => {
    const r = await load(false);
    for (const res of [
      await r.dashboard.GET(get('/api/dashboard')),
      await r.onboarding.GET(get('/api/onboarding')),
      await r.decisions.GET(get('/api/decisions')),
      await r.decision.GET(get('/api/decisions/abc'), { params: Promise.resolve({ id: 'abc' }) }),
      await r.me.GET(get('/api/me')),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'unauthorized', message: expect.any(String) },
      });
    }
  });

  it('a fixture request is refused (still 401) unless DEMO_MODE is on', async () => {
    const r = await load(false);
    const res = await r.dashboard.GET(get('/api/dashboard?fixture=1'));
    expect(res.status).toBe(401);
  });

  it('a fixture request never works for a made-up scenario', async () => {
    const r = await load(true);
    expect((await r.dashboard.GET(get('/api/dashboard?fixture=admin'))).status).toBe(401);
  });
});

describe('the dev-only fixture switch serves canned data only in DEMO_MODE', () => {
  it('dashboard, decisions, detail, me and onboarding answer without a session', async () => {
    const r = await load(true);
    const dash = await r.dashboard.GET(get('/api/dashboard?fixture=frozen'));
    expect(dash.status).toBe(200);
    const parsed = zDashboard.parse(await dash.json());
    expect(parsed.wallet.frozen).toBe(true);
    expect(parsed.wallet.id).toBe('fx-wallet'); // canned, not a real wallet

    const list = zDecisionList.parse(
      await (await r.decisions.GET(get('/api/decisions?fixture=1'))).json(),
    );
    expect(list.decisions.length).toBeGreaterThan(0);
    const detail = await r.decision.GET(get('/api/decisions/fx-3?fixture=1'), {
      params: Promise.resolve({ id: 'fx-3' }),
    });
    expect(zDecisionDetail.parse(await detail.json()).verdict?.decision).toBe('DENY');
    expect(zMe.safeParse(await (await r.me.GET(get('/api/me?fixture=1'))).json()).success).toBe(
      true,
    );
    expect(
      zOnboarding.parse(
        await (await r.onboarding.GET(get('/api/onboarding?fixture=onboarding'))).json(),
      ).step,
    ).toBe(2);
  });
});

describe('GET /api/config', () => {
  it('is public and reports demo mode only when it is really on (I11)', async () => {
    const off = zConfig.parse(await (await (await load(false)).config.GET()).json());
    expect(off).toMatchObject({ demoMode: false, chainId: 84532 });
    const on = zConfig.parse(await (await (await load(true)).config.GET()).json());
    expect(on.demoMode).toBe(true);
    expect(on.explorerBase).toBe('https://sepolia.basescan.org');
  });
  it('exposes nothing but the known flags', async () => {
    const body = await (await (await load(true)).config.GET()).json();
    expect(Object.keys(body).sort()).toEqual([
      'chainId',
      'demoMode',
      'explorerBase',
      'telegramEnabled',
    ]);
  });
});

describe('request validation', () => {
  it('compile body: accepts words + a template, rejects everything else', () => {
    expect(
      zCompileBody.safeParse({ text: ' Keep 1 USDC liquid. ', template: 'startup' }).success,
    ).toBe(true);
    const garbage: unknown[] = [
      null,
      'text',
      {},
      { text: '', template: 'startup' },
      { text: '   ', template: 'startup' },
      { text: 'x'.repeat(MANDATE_MAX_CHARS + 1), template: 'startup' },
      { text: 'ok', template: 'hacker' },
      { text: 'ok', template: 'startup', address: '0x3333333333333333333333333333333333333333' },
      { text: 'ok', template: 'startup', walletId: 'someone-elses' },
      { text: 42, template: 'startup' },
    ];
    for (const g of garbage) expect(zCompileBody.safeParse(g).success).toBe(false);
  });

  it('decisions query: cursor must be a timestamp, limit 1..100', () => {
    expect(decisionsQuery.safeParse({}).success).toBe(true);
    expect(
      decisionsQuery.safeParse({ cursor: '2026-09-22T10:00:00.000Z', limit: '25' }).success,
    ).toBe(true);
    for (const bad of [{ cursor: 'yesterday' }, { limit: '0' }, { limit: '101' }, { limit: 'x' }])
      expect(decisionsQuery.safeParse(bad).success).toBe(false);
  });

  it('a compiler outage is told apart from a validation failure', () => {
    const down = [
      {
        path: '',
        code: 'MISSING' as const,
        message: 'The mandate compiler is unavailable (timeout).',
        suggestion: 's',
      },
    ];
    expect(compilerUnavailable(down)).toBe(true);
    expect(
      compilerUnavailable([
        { path: 'limits', code: 'ABOVE_CEILING', message: 'too high', suggestion: 's' },
      ]),
    ).toBe(false);
    expect(compilerUnavailable([])).toBe(false);
  });
});

describe('POST /api/mandate/compile', () => {
  const walletMock = (owner: 'ok' | 'none') => {
    vi.resetModules();
    vi.doMock('../lib/wallet', () => ({
      isResponse: (v: unknown) => v instanceof Response,
      requireOwner: async () =>
        owner === 'none'
          ? Response.json(
              { error: { code: 'unauthorized', message: 'sign in required' } },
              { status: 401 },
            )
          : { userId: 'u', address: '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C', db: {} },
      requireWallet: async () => ({
        id: 'w',
        chainId: 84532,
        treasuryAddress: '0x0',
        agentWalletAddress: '0x0',
      }),
      requireProvisioned: () => '0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C',
    }));
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
  };
  const post = (body: unknown) =>
    new Request('http://localhost:3000/api/mandate/compile', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  afterEach(() => vi.doUnmock('../lib/wallet'));

  it('requires a session', async () => {
    walletMock('none');
    const { POST } = await import('../app/api/mandate/compile/route');
    expect((await POST(post({ text: 'x', template: 'startup' }))).status).toBe(401);
  });

  it('rejects garbage with a plain 400 before touching anything else', async () => {
    walletMock('ok');
    const { POST } = await import('../app/api/mandate/compile/route');
    for (const body of [
      'not json',
      {},
      { text: '', template: 'startup' },
      { text: 'ok', template: 'startup', address: '0x1' },
    ]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('bad_request');
      expect(JSON.stringify(json)).not.toMatch(/secret|apiKey|SESSION/i);
    }
  });
});
