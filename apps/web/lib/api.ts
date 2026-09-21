// Typed fetch for the Steward API. Every response is parsed with a zod schema from contracts.ts, so a
// malformed or unexpected payload becomes a plain-language error instead of a crash (CLAUDE.md §7).
import type { ZodType } from 'zod';
import { zApiError } from './contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FIXTURE_KEY = 'steward.fixture';

/**
 * Dev-only fixture switch (docs: apps/web/lib/fixtureGate.ts). `?fixture=frozen` on any page is
 * remembered for the tab and forwarded to the API; `?fixture=0` clears it. The SERVER decides whether
 * to honour it (never in production, only with DEMO_MODE on Base Sepolia), so in a real deployment
 * this parameter is inert.
 */
export function captureFixtureFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const v = new URLSearchParams(window.location.search).get('fixture');
    if (v === '0') window.sessionStorage.removeItem(FIXTURE_KEY);
    else if (v) window.sessionStorage.setItem(FIXTURE_KEY, v);
  } catch {
    /* storage can be blocked; the switch just stays off */
  }
}

export function fixtureParam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(FIXTURE_KEY);
  } catch {
    return null;
  }
}

export function withFixture(path: string): string {
  const f = fixtureParam();
  if (!f) return path;
  return `${path}${path.includes('?') ? '&' : '?'}fixture=${encodeURIComponent(f)}`;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withFixture(path), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'Steward could not reach the server.');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = zApiError.safeParse(json);
    throw new ApiError(
      res.status,
      e.success ? e.data.error.code : 'error',
      e.success ? e.data.error.message : `The server answered ${res.status}.`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new ApiError(
      res.status,
      'bad_response',
      'Steward sent a response the app did not expect.',
    );
  return parsed.data;
}

export const apiGet = <T>(path: string, schema: ZodType<T>) => apiRequest('GET', path, schema);
export const apiPost = <T>(path: string, schema: ZodType<T>, body?: unknown) =>
  apiRequest('POST', path, schema, body);
