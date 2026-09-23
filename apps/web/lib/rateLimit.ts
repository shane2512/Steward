// 8.2 — rate limiting on the API.
//
// A fixed-window counter in process memory. No dependency, no Redis, no extra table: the web app is
// one instance for the MVP, the same stance ARCHITECTURE §7 already takes for the worker. When
// Steward runs behind more than one web instance this becomes per-instance (so the effective limit
// is N x the number written here) and must move to Postgres or Redis.
// ponytail: in-process fixed window, single instance only — move the counters to a table keyed by
// (bucket, identity, window) if the web app is ever scaled out.
//
// WHAT IS NOT LIMITED, on purpose (I7 — the owner always wins):
//   `/api/freeze`, `/api/freeze/prepare` and `/api/spend-permission/revoked`. A limiter that could
//   refuse a freeze, or refuse the message an owner needs in order to sign one, would turn a safety
//   feature into a denial of the one control that stops the agent. The revoke report is only ever
//   polled toward a SAFER state (and is capped by how fast the chain confirms), so it is exempt too.
//
// Everything limited here is either expensive (a SERV call, a loop iteration, an on-chain sweep) or
// unauthenticated (the SIWE handshake), and none of it is a stop button.
import { apiError } from './server';

export type RateLimitRule = { limit: number; windowMs: number };

const MINUTE = 60_000;

export const RATE_LIMITS = {
  /** Each call is a real, paid SERV request (flagged as an open risk at the end of Phase 7). */
  'mandate.compile': { limit: 10, windowMs: 10 * MINUTE },
  /** Unauthenticated: per IP. */
  'auth.nonce': { limit: 30, windowMs: 5 * MINUTE },
  /** Unauthenticated, and a smart-wallet signature check is an RPC call. Per IP. */
  'auth.verify': { limit: 20, windowMs: 5 * MINUTE },
  /** Enqueues a whole decision iteration: context reads, SERV, simulation. */
  'agent.run': { limit: 20, windowMs: 5 * MINUTE },
  /** A real on-chain transaction. */
  sweep: { limit: 10, windowMs: 10 * MINUTE },
  /** Unfreezing is the UNSAFE direction, so limiting it costs no safety (freezing is exempt). */
  unfreeze: { limit: 10, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Window = { count: number; resetAt: number };
/** Survives hot reloads in dev, where module state would otherwise be discarded each edit. */
const g = globalThis as unknown as { __rateLimit?: Map<string, Window> };
const windows = (g.__rateLimit ??= new Map<string, Window>());

/**
 * Count one request. Returns a 429 `Response` when the caller is over the limit for this bucket, or
 * `null` to carry on.
 *
 * `identity` must be something the caller cannot trivially rotate for the thing being protected: a
 * session `userId` for authenticated routes, the client IP for the SIWE handshake.
 */
export function rateLimit(
  bucket: RateLimitBucket,
  identity: string,
  now: number = Date.now(),
): Response | null {
  const rule = RATE_LIMITS[bucket];
  const key = `${bucket}:${identity}`;
  prune(now);

  const open = windows.get(key);
  if (!open || now >= open.resetAt) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }

  open.count += 1;
  if (open.count <= rule.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((open.resetAt - now) / 1000));
  const res = apiError(
    429,
    'rate_limited',
    `too many requests; try again in ${retryAfter}s (limit ${rule.limit} per ${Math.round(rule.windowMs / MINUTE)} min)`,
  );
  res.headers.set('retry-after', String(retryAfter));
  return res;
}

/**
 * The client address for an unauthenticated route. Trusts `x-forwarded-for`'s first hop, which is
 * correct behind exactly one proxy (Vercel) and is the best available here; a spoofed value only
 * ever splits an attacker's own bucket, it cannot borrow someone else's allowance.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || 'unknown';
}

/** Drop finished windows so the map cannot grow without bound. O(n) — fine at this scale. */
function prune(now: number): void {
  if (windows.size < 1000) return;
  for (const [key, w] of windows) if (now >= w.resetAt) windows.delete(key);
}

/** Test seam only. */
export function resetRateLimits(): void {
  windows.clear();
}
