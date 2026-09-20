import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions } from 'iron-session';
import { getEnv } from '@steward/shared';

export type SessionData = {
  nonce?: string;
  nonceIssuedAt?: number;
  userId?: string;
  address?: string;
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
