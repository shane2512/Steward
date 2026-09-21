// Pure derivations from server data to what the shell shows: the status pill and the banners.
// These pick WORDS for what the server already decided; they never decide anything about funds.
import type { Dashboard } from './contracts';

export type PillState = 'active' | 'waiting' | 'frozen' | 'breaker' | 'safe' | 'paused';

export const PILL: Record<PillState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  active: { label: 'Active', tone: 'ok' },
  waiting: { label: 'Waiting for approval', tone: 'warn' },
  frozen: { label: 'Frozen', tone: 'bad' },
  breaker: { label: 'Breaker tripped', tone: 'bad' },
  safe: { label: 'Safe mode', tone: 'warn' },
  paused: { label: 'Paused', tone: 'warn' },
};

type StatusInput = Pick<Dashboard, 'degraded' | 'paused' | 'pendingApprovals'> & {
  wallet: Pick<Dashboard['wallet'], 'frozen' | 'breakerOpen'>;
};

/** Precedence mirrors the server's own: frozen beats everything, then the breaker, then service state. */
export function pillState(d: StatusInput): PillState {
  if (d.wallet.frozen) return 'frozen';
  if (d.wallet.breakerOpen) return 'breaker';
  if (d.paused) return 'paused';
  if (d.degraded) return 'safe';
  if (d.pendingApprovals > 0) return 'waiting';
  return 'active';
}

export function pillLabel(state: PillState, pending = 0): string {
  return state === 'waiting' ? `${PILL.waiting.label} (${pending})` : PILL[state].label;
}

export type Banner = {
  id: 'demo' | 'frozen' | 'safe' | 'paused' | 'stale' | 'breaker';
  tone: 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  /** assertive for anything that needs the owner or means money is stopped */
  live: 'polite' | 'assertive';
};

export const STALE_AFTER_MS = 30_000;

type BannerInput = {
  demoMode: boolean;
  data:
    | (Pick<Dashboard, 'degraded' | 'paused'> & {
        wallet: Pick<Dashboard['wallet'], 'frozen' | 'breakerOpen'>;
      })
    | undefined;
  /** epoch ms of the last successful refresh, or undefined before the first one */
  updatedAt: number | undefined;
  now: number;
  /** the last refresh failed but we still hold older data */
  refreshFailed?: boolean;
};

/** Which banners the shell shows, in order. Copy follows UX_FLOWS "Global states". */
export function banners(i: BannerInput): Banner[] {
  const out: Banner[] = [];
  if (i.demoMode)
    out.push({
      id: 'demo',
      tone: 'warn',
      title: 'Demo data',
      body: 'Mocked prices and rates, Base Sepolia only.',
      live: 'polite',
    });
  if (i.data?.wallet.frozen)
    out.push({
      id: 'frozen',
      tone: 'bad',
      title: 'Frozen',
      body: 'Steward is stopped. Nothing will move until you unfreeze.',
      live: 'assertive',
    });
  else if (i.data?.wallet.breakerOpen)
    out.push({
      id: 'breaker',
      tone: 'bad',
      title: 'Breaker tripped',
      body: 'Steward stopped itself after repeated failures. Nothing is moving. Freeze still works.',
      live: 'assertive',
    });
  if (i.data?.paused)
    out.push({
      id: 'paused',
      tone: 'warn',
      title: 'Steward is paused',
      body: 'Steward is paused (service issue). Your funds are safe; nothing will move.',
      live: 'polite',
    });
  if (i.data?.degraded)
    out.push({
      id: 'safe',
      tone: 'warn',
      title: 'Safe mode',
      body: 'Running in safe mode: scheduled payments and risk exits only. Freeze still works.',
      live: 'polite',
    });
  const stale =
    i.refreshFailed === true || (i.updatedAt !== undefined && i.now - i.updatedAt > STALE_AFTER_MS);
  if (stale && i.updatedAt !== undefined)
    out.push({
      id: 'stale',
      tone: 'info',
      title: 'Showing older data',
      body: 'Steward could not refresh just now. What you see is the last reading. Nothing has been moved because of this.',
      live: 'polite',
    });
  return out;
}

export function isStale(updatedAt: number | undefined, now: number): boolean {
  return updatedAt !== undefined && now - updatedAt > STALE_AFTER_MS;
}

/** RR-14: turn the worker's NOOP reason into a sentence the owner can act on. */
export function parkedFromAudit(
  row: { event: string; payload: unknown; createdAt: Date } | undefined,
): { reason: string; since: string } | null {
  if (!row || row.event !== 'NOOP') return null;
  const reason = (row.payload as { reason?: unknown } | null)?.reason;
  if (typeof reason !== 'string') return null;
  if (/no way to fund it/.test(reason))
    return {
      reason:
        'A payment is due but Steward has no way to fund it inside your limits. It is holding everything else until that is fixed. Add funds or raise the allowance.',
      since: row.createdAt.toISOString(),
    };
  if (/already decided in the last 24h/.test(reason))
    return {
      reason:
        'Steward already tried the only action open to it and your rules refused it. It is waiting for the 24-hour window to roll or for you to change the policy.',
      since: row.createdAt.toISOString(),
    };
  return null;
}
