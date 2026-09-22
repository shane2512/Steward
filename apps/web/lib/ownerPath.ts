// Server helpers for the owner control path (task 7.8, SECURITY §4): freeze, revoke, sweep.
//
// I7 — this module and every route that uses it must work with SERV, the LLM and the worker all
// down. Nothing here imports `@steward/reasoning` or `@steward/context` (enforced by
// `owner-path-no-reasoning` in .dependency-cruiser.cjs, with deliberate-violation fixtures for both
// `sweepHome` and an `/api/freeze` route).
//
// The freeze and unfreeze messages are SERVER-issued, exactly like every other Steward signature:
// `/api/freeze/prepare` mints a single-use nonce into the session, and the POST re-derives the same
// string from the SESSION's stored action and nonce — never from the request body — so a captured
// signature cannot be replayed and an unfreeze signature can never be spent on a freeze (D-90).
import { randomBytes } from 'node:crypto';
import {
  getActiveSpendPermission,
  latestExecutionOfKind,
  type Db,
  type ExecutionStatus,
  type Wallet,
} from '@steward/db';
import {
  FREEZE_CONFIRMATION_TTL_MS,
  freezeMessage,
  getEnv,
  type FreezeAction,
} from '@steward/shared';
import { isRevoked, encodeRevoke, parseSpendPermission } from '@steward/wallet';
import { getAddress, type Hex } from 'viem';
import { apiError, getPublicClient } from './server';
import { getSession } from './session';
import type { Owner } from './wallet';

/** Mint the nonce and return the literal string the owner will sign. */
export async function issueFreezeMessage(
  action: FreezeAction,
  walletId: string,
): Promise<{ message: string; expiresAt: string }> {
  const nonce = randomBytes(16).toString('hex');
  // One reading of the clock: the POST re-derives `Expires:` as issuedAt + TTL, so the two must
  // agree to the millisecond or no signature could verify (same discipline as recipient adds).
  const issuedAt = Date.now();
  const expiresAt = new Date(issuedAt + FREEZE_CONFIRMATION_TTL_MS);
  const session = await getSession();
  session.freezeNonce = nonce;
  session.freezeNonceAt = issuedAt;
  session.freezeAction = action;
  await session.save();
  return {
    message: freezeMessage({ action, walletId, nonce, expiresAt }),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Spend the nonce and verify the owner's signature over the re-derived message.
 * Returns `null` when the signature is good, or the Response to return when it is not.
 * Fails closed: a verification we could not complete is a refusal, never an acceptance (I5).
 */
export async function verifyFreezeSignature(args: {
  owner: Owner;
  walletId: string;
  action: FreezeAction;
  signature: Hex;
}): Promise<Response | null> {
  const session = await getSession();
  const nonce = session.freezeNonce;
  const issuedAt = session.freezeNonceAt;
  const action = session.freezeAction;
  // Spend it now, whatever the outcome: a request that got this far has used its one attempt.
  session.freezeNonce = undefined;
  session.freezeNonceAt = undefined;
  session.freezeAction = undefined;
  await session.save();

  if (!nonce || issuedAt === undefined || action === undefined)
    return apiError(400, 'nonce_expired', 'ask for a fresh confirmation and sign that');
  if (action !== args.action)
    return apiError(400, 'nonce_expired', 'that confirmation was issued for a different action');
  if (Date.now() - issuedAt > FREEZE_CONFIRMATION_TTL_MS)
    return apiError(400, 'nonce_expired', 'that confirmation expired; sign a fresh one');

  const message = freezeMessage({
    action,
    walletId: args.walletId,
    nonce,
    expiresAt: new Date(issuedAt + FREEZE_CONFIRMATION_TTL_MS),
  });

  let valid: boolean;
  try {
    valid = await getPublicClient().verifyMessage({
      address: args.owner.address,
      message,
      signature: args.signature,
    });
  } catch (e) {
    return apiError(502, 'verify_failed', `signature verification failed: ${String(e)}`);
  }
  if (!valid) return apiError(401, 'bad_signature', 'that signature is not from this wallet');
  return null;
}

export type RevokeStep =
  /** Nothing to revoke: the owner never granted one, or it is already gone. */
  | { state: 'none' }
  | { state: 'revoked'; at: string | null }
  /** The transaction the OWNER's own wallet sends. Steward never broadcasts this one. */
  | { state: 'todo'; to: string; data: Hex; permissionId: string };

export type SweepStep = { state: 'none' } | { state: ExecutionStatus; txHash: string | null };

export type OwnerPathStatus = {
  frozen: boolean;
  frozenAt: string | null;
  frozenReason: string | null;
  revoke: RevokeStep;
  sweep: SweepStep;
};

/**
 * What the server believes about each of S9's three steps, so a reopened (or reloaded) freeze modal
 * resumes from the real state rather than from whatever the component remembered.
 */
export async function ownerPathStatus(db: Db, wallet: Wallet): Promise<OwnerPathStatus> {
  const sweepRow = await latestExecutionOfKind(db, wallet.id, 'sweep_home');
  return {
    frozen: wallet.frozen,
    frozenAt: wallet.frozenAt?.toISOString() ?? null,
    frozenReason: wallet.frozenReason ?? null,
    revoke: await revokeStep(db, wallet.id),
    sweep: sweepRow ? { state: sweepRow.status, txHash: sweepRow.txHash } : { state: 'none' },
  };
}

async function revokeStep(db: Db, walletId: string): Promise<RevokeStep> {
  const active = await getActiveSpendPermission(db, walletId);
  if (!active) return { state: 'none' };
  const parsed = parseSpendPermission(active.permission);
  // A stored permission we cannot parse is not something we can build a revoke for; say so rather
  // than claim it is revoked.
  if (!parsed.ok) return { state: 'none' };

  const manager = getAddress(getEnv().SPEND_PERMISSION_MANAGER_ADDRESS);
  const onchain = await isRevoked(getPublicClient(), manager, parsed.value);
  if (onchain.ok && onchain.value)
    return { state: 'revoked', at: active.revokedAt?.toISOString() ?? null };

  // An unreadable chain leaves the step as "still to do": offering the revoke again is harmless
  // (the manager treats a second revoke as a no-op), whereas claiming it is done would not be.
  return {
    state: 'todo',
    to: manager,
    data: encodeRevoke(parsed.value),
    permissionId: active.id,
  };
}
