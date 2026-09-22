import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions } from 'iron-session';
import { getEnv } from '@steward/shared';

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
   * Single-use nonce for a freeze/unfreeze confirmation (task 7.8). The ACTION is stored with it so
   * a nonce issued for an unfreeze can never be spent on a freeze: the POST re-derives the message
   * from the stored action, not from the request body.
   */
  freezeNonce?: string;
  freezeNonceAt?: number;
  freezeAction?: 'freeze' | 'unfreeze';
};

export function sessionOptions(): SessionOptions {
  return {
    password: getEnv().SESSION_SECRET.reveal(),
    cookieName: 'steward_session',
    ttl: 60 * 60 * 24 * 7,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
