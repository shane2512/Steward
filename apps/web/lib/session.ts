import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions } from 'iron-session';
import { getEnv, type FreezeAction } from '@steward/shared';

export type SessionData = {
  nonce?: string;
  nonceIssuedAt?: number;
  userId?: string;
  address?: string;
  /**
   * Single-use nonce for a recipient confirmation (API.md: sensitive routes sign a server-issued
   * message with a nonce, TTL 5 min). Kept apart from the SIWE nonce so issuing one can never
   * interfere with signing in, and cleared the moment it is spent.
   */
  recipientNonce?: string;
  recipientNonceAt?: number;
  /**
   * Single-use nonce for a freeze/unfreeze/sweep confirmation (7.8; sweep added in 8.2). The ACTION
   * is stored with it so a nonce issued for one can never be spent on another: the POST re-derives
   * the message from the stored action, not from the request body.
   */
  freezeNonce?: string;
  freezeNonceAt?: number;
  freezeAction?: FreezeAction;
};

/**
 * 8.2 — how long a signed-in session stays usable. SECURITY does not name a number, so this is the
 * shortest window that does not make the product annoying: long enough to write a mandate, review a
 * policy and sign it in one sitting; short enough that a session cookie lifted off a shared laptop
 * is worthless by the next morning (D-104).
 *
 * The blast radius of a live session is already small by construction — every money-moving or
 * security-relevant route additionally needs a signature over a message the SERVER issued seconds
 * earlier, which the cookie alone cannot produce.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function sessionOptions(): SessionOptions {
  return {
    password: getEnv().SESSION_SECRET.reveal(),
    cookieName: 'steward_session',
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      // 8.2: `strict`, not `lax`. Steward has no cross-site entry point that needs the cookie — no
      // OAuth callback, no third-party redirect back into the app; the wallet connect flow runs in
      // a popup and returns to the SAME tab, which keeps its cookie. So `strict` costs nothing and
      // it is what makes every state-changing route CSRF-proof without a token: a cross-site form
      // post or fetch arrives with no cookie at all, so `requireOwner()` 401s it (D-105).
      sameSite: 'strict',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
