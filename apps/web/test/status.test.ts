import { describe, expect, it } from 'vitest';
import {
  banners,
  isStale,
  parkedFromAudit,
  pillLabel,
  pillState,
  STALE_AFTER_MS,
} from '../lib/status';

const base = {
  degraded: false,
  paused: false,
  pendingApprovals: 0,
  wallet: { frozen: false, breakerOpen: false },
};

describe('pillState precedence', () => {
  it('is Active when nothing is wrong', () => expect(pillState(base)).toBe('active'));
  it('frozen beats everything', () =>
    expect(
      pillState({
        ...base,
        degraded: true,
        paused: true,
        pendingApprovals: 3,
        wallet: { frozen: true, breakerOpen: true },
      }),
    ).toBe('frozen'));
  it('breaker beats paused, safe mode and waiting', () =>
    expect(
      pillState({
        ...base,
        paused: true,
        degraded: true,
        wallet: { frozen: false, breakerOpen: true },
      }),
    ).toBe('breaker'));
  it('paused beats safe mode', () =>
    expect(pillState({ ...base, paused: true, degraded: true })).toBe('paused'));
  it('safe mode beats waiting', () =>
    expect(pillState({ ...base, degraded: true, pendingApprovals: 2 })).toBe('safe'));
  it('waiting for approval shows the count in its label', () => {
    const s = pillState({ ...base, pendingApprovals: 2 });
    expect(s).toBe('waiting');
    expect(pillLabel(s, 2)).toBe('Waiting for approval (2)');
  });
  it('every state has a plain word label', () => {
    for (const s of ['active', 'waiting', 'frozen', 'breaker', 'safe', 'paused'] as const)
      expect(pillLabel(s, 1).length).toBeGreaterThan(3);
  });
});

describe('banners', () => {
  const NOW = 1_000_000;
  const ids = (b: ReturnType<typeof banners>) => b.map((x) => x.id);

  it('shows nothing for a healthy, fresh, non-demo app', () =>
    expect(banners({ demoMode: false, data: base, updatedAt: NOW - 1000, now: NOW })).toEqual([]));

  it('DEMO DATA is shown whenever demo mode is on, even before data loads (I11)', () =>
    expect(
      ids(banners({ demoMode: true, data: undefined, updatedAt: undefined, now: NOW })),
    ).toEqual(['demo']));

  it('safe mode names what still works', () => {
    const b = banners({
      demoMode: false,
      data: { ...base, degraded: true },
      updatedAt: NOW,
      now: NOW,
    });
    expect(ids(b)).toEqual(['safe']);
    expect(b[0]?.body).toMatch(/scheduled payments and risk exits only/);
  });

  it('paused says funds are safe and nothing will move', () => {
    const b = banners({
      demoMode: false,
      data: { ...base, paused: true },
      updatedAt: NOW,
      now: NOW,
    });
    expect(b[0]?.body).toMatch(/funds are safe; nothing will move/);
  });

  it('frozen is announced assertively and is not shown as a breaker too', () => {
    const b = banners({
      demoMode: false,
      data: { ...base, wallet: { frozen: true, breakerOpen: true } },
      updatedAt: NOW,
      now: NOW,
    });
    expect(ids(b)).toEqual(['frozen']);
    expect(b[0]?.live).toBe('assertive');
  });

  it('marks data stale after the threshold, and keeps showing what it has', () => {
    const fresh = banners({
      demoMode: false,
      data: base,
      updatedAt: NOW - STALE_AFTER_MS,
      now: NOW,
    });
    const stale = banners({
      demoMode: false,
      data: base,
      updatedAt: NOW - STALE_AFTER_MS - 1,
      now: NOW,
    });
    expect(ids(fresh)).toEqual([]);
    expect(ids(stale)).toEqual(['stale']);
    expect(stale[0]?.body).toMatch(/Nothing has been moved/);
  });

  it('a failed refresh with older data is stale even if recent', () =>
    expect(
      ids(banners({ demoMode: false, data: base, updatedAt: NOW, now: NOW, refreshFailed: true })),
    ).toEqual(['stale']));

  it('never claims stale before the first successful read', () =>
    expect(
      ids(
        banners({
          demoMode: false,
          data: undefined,
          updatedAt: undefined,
          now: NOW,
          refreshFailed: true,
        }),
      ),
    ).toEqual([]));

  it('isStale mirrors the threshold', () => {
    expect(isStale(undefined, NOW)).toBe(false);
    expect(isStale(NOW - STALE_AFTER_MS - 1, NOW)).toBe(true);
  });
});

describe('parkedFromAudit (RR-14)', () => {
  const at = new Date('2026-09-22T10:00:00Z');
  it('surfaces a stuck obligation in plain words', () => {
    const p = parkedFromAudit({
      event: 'NOOP',
      payload: { reason: 'obligation x needs 5 more base units and there is no way to fund it' },
      createdAt: at,
    });
    expect(p?.reason).toMatch(/holding everything else/);
    expect(p?.since).toBe(at.toISOString());
  });
  it('surfaces the R17 window case', () =>
    expect(
      parkedFromAudit({
        event: 'NOOP',
        payload: {
          reason: 'the only available action (x) was already decided in the last 24h; R17',
        },
        createdAt: at,
      })?.reason,
    ).toMatch(/24-hour window/));
  it('ignores an ordinary quiet tick and other events', () => {
    expect(
      parkedFromAudit({
        event: 'NOOP',
        payload: { reason: 'nothing idle above the buffer' },
        createdAt: at,
      }),
    ).toBeNull();
    expect(parkedFromAudit({ event: 'EXECUTED', payload: {}, createdAt: at })).toBeNull();
    expect(parkedFromAudit(undefined)).toBeNull();
    expect(parkedFromAudit({ event: 'NOOP', payload: null, createdAt: at })).toBeNull();
  });
});
