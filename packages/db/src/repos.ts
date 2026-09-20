// Thin typed repositories. More are added by the phase that needs them.
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { users, wallets } from './schema';

export type User = typeof users.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;

/** Create the user on first login, else bump last_login_at. ownerAddress must already be checksummed. */
export async function upsertUserByAddress(db: Db, ownerAddress: string, now: Date): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ ownerAddress, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.ownerAddress, set: { lastLoginAt: now } })
    .returning();
  if (!row) throw new Error('upsertUserByAddress: no row returned');
  return row;
}

export async function getUserById(db: Db, id: string): Promise<User | undefined> {
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
}

export async function getWalletByUserId(db: Db, userId: string): Promise<Wallet | undefined> {
  return (await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1))[0];
}
