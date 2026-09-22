// GET  /api/recipients — the allowlist.
// POST /api/recipients — **sensitive**: add one, with the owner's signature over the exact message
// `/api/recipients/prepare` issued (API.md, UX_FLOWS S8).
//
// This route is the ONLY way a recipient is ever added. Steward's agent has no path to it: the
// worker never makes HTTP calls into the web app, and the route requires an owner session AND a
// fresh owner signature (T3 — "the agent cannot add recipients", SECURITY §2).
//
//   DOES  re-checksum the address and re-derive the message from the session's single-use nonce, so
//         the signature only counts for the exact facts the owner was shown;
//   DOES  spend the nonce on the first attempt, whatever the outcome, so a captured request cannot
//         be replayed;
//   DOES NOT make the recipient payable on its own — the Policy Engine reads the allowlist from the
//         signed policy body, so the owner must also activate a new policy version (the response
//         says so, and /api/policy/prepare picks the new row up automatically).
import { appendAudit, getActivePolicy, insertRecipient, listRecipients } from '@steward/db';
import {
  RECIPIENT_CONFIRMATION_TTL_MS,
  recipientAddMessage,
  SYSTEM_CEILINGS,
  zPolicy,
} from '@steward/shared';
import { getAddress } from 'viem';
import { fixtureFor } from '@/lib/fixture';
import { fixtureRecipients } from '@/lib/fixtures';
import { zRecipientAddBody } from '@/lib/recipientSchemas';
import { apiError, getPublicClient } from '@/lib/server';
import { getSession } from '@/lib/session';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

// `req` is required, not optional: Next's generated route types reject `Request | undefined`, and
// an optional parameter made `pnpm typecheck` fail whenever the dev server had regenerated them.
export async function GET(req: Request) {
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixtureRecipients(fx));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const rows = await listRecipients(owner.db, wallet.id);
  return Response.json({
    // Signatures are never returned by the API (I9 / SECURITY §6).
    recipients: rows.map((r) => ({
      id: r.id,
      label: r.label,
      address: r.address,
      maxPerTx: r.maxPerTx.toString(),
      scheduleDayOfMonth: (r.schedule as { dayOfMonth?: number } | null)?.dayOfMonth ?? null,
      status: r.status,
    })),
  });
}

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zRecipientAddBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return apiError(400, 'bad_request', parsed.error.issues.map((i) => i.message).join('; '));

  let address: string;
  try {
    address = getAddress(parsed.data.address);
  } catch {
    return apiError(400, 'bad_address', 'that address is not valid');
  }
  if (parsed.data.maxPerTx > SYSTEM_CEILINGS.MAX_PER_TX_MICRO_USD)
    return apiError(400, 'invalid_terms', 'the per-payment limit is above the system ceiling');

  const session = await getSession();
  const nonce = session.recipientNonce;
  const issuedAt = session.recipientNonceAt;
  // Spend the nonce now: a request that gets this far has used its one attempt, so a replay of the
  // same bytes finds nothing to verify against (T9).
  session.recipientNonce = undefined;
  session.recipientNonceAt = undefined;
  await session.save();

  if (nonce === undefined || issuedAt === undefined)
    return apiError(409, 'nonce_expired', 'confirm the address again before signing');
  const expiresAt = new Date(issuedAt + RECIPIENT_CONFIRMATION_TTL_MS);
  if (expiresAt.getTime() <= Date.now())
    return apiError(409, 'nonce_expired', 'that confirmation expired');

  const message = recipientAddMessage({
    walletId: wallet.id,
    label: parsed.data.label,
    address,
    maxPerTxBaseUnits: parsed.data.maxPerTx,
    scheduleDayOfMonth: parsed.data.schedule?.dayOfMonth,
    nonce,
    expiresAt,
  });

  let valid: boolean;
  try {
    valid = await getPublicClient().verifyMessage({
      address: owner.address,
      message,
      signature: parsed.data.signature,
    });
  } catch (e) {
    // A verification we could not complete is NOT an addition (I5).
    return apiError(502, 'verify_failed', `signature verification failed: ${String(e)}`);
  }
  if (!valid)
    return apiError(
      401,
      'bad_signature',
      'the signature does not match this recipient; confirm the address again and sign',
    );

  const existing = await listRecipients(owner.db, wallet.id);
  const active = existing.filter((r) => r.status === 'active');
  if (active.some((r) => r.address === address))
    return apiError(409, 'duplicate_recipient', 'that address is already on your list');
  if (active.length >= SYSTEM_CEILINGS.MAX_RECIPIENTS)
    return apiError(409, 'too_many_recipients', 'your allowlist is full');

  const now = new Date();
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'RECIPIENT_ADDED',
    entityType: 'recipient',
    entityId: address,
    // The signature is stored on the row, never in the audit payload (D-16).
    payload: {
      label: parsed.data.label,
      address,
      maxPerTx: parsed.data.maxPerTx.toString(),
      signer: owner.address,
    },
    createdAt: now,
  });
  if (!audited.ok) return apiError(503, 'audit_failed', audited.error.message);

  const row = await insertRecipient(owner.db, {
    walletId: wallet.id,
    label: parsed.data.label,
    address,
    maxPerTx: parsed.data.maxPerTx,
    schedule: parsed.data.schedule
      ? {
          dayOfMonth: parsed.data.schedule.dayOfMonth,
          amountMicroUsd: parsed.data.schedule.amountMicroUsd.toString(),
        }
      : null,
    addedSignature: parsed.data.signature,
  });
  // `onConflictDoNothing`: a race lost to another insert of the same address.
  if (!row) return apiError(409, 'duplicate_recipient', 'that address is already on your list');

  const activePolicy = await getActivePolicy(owner.db, wallet.id);
  const policy = activePolicy ? zPolicy.safeParse(activePolicy.body) : undefined;
  const inPolicy = policy?.success
    ? policy.data.recipients.some((r) => r.address === address)
    : false;

  return Response.json({
    recipient: {
      id: row.id,
      label: row.label,
      address: row.address,
      maxPerTx: row.maxPerTx.toString(),
      scheduleDayOfMonth: parsed.data.schedule?.dayOfMonth ?? null,
      status: row.status,
    },
    needsPolicySignature: !inPolicy,
  });
}
