// POST /api/recipients/prepare — the literal confirmation message for adding an allowlist entry
// (UX_FLOWS S8, API.md's "server-issued message with nonce, TTL 5 min").
//
// The address is checksummed HERE and returned; the confirmation screen shows the server's string,
// not what the owner typed, so a mixed-case look-alike cannot be read as the address that will be
// stored (T3). Everything Steward will pay to is decided by exact equality with this string (I4).
import { randomBytes } from 'node:crypto';
import { listRecipients } from '@steward/db';
import {
  RECIPIENT_CONFIRMATION_TTL_MS,
  recipientAddMessage,
  SYSTEM_CEILINGS,
} from '@steward/shared';
import { getAddress } from 'viem';
import { zRecipientFields } from '@/lib/recipientSchemas';
import { apiError } from '@/lib/server';
import { getSession } from '@/lib/session';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const parsed = zRecipientFields.safeParse(await req.json().catch(() => null));
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

  const existing = await listRecipients(owner.db, wallet.id);
  const active = existing.filter((r) => r.status === 'active');
  if (active.some((r) => r.address === address))
    return apiError(409, 'duplicate_recipient', 'that address is already on your list');
  if (active.length >= SYSTEM_CEILINGS.MAX_RECIPIENTS)
    return apiError(409, 'too_many_recipients', 'your allowlist is full');

  const nonce = randomBytes(16).toString('hex');
  // One reading of the clock: POST re-derives `Expires:` as issuedAt + TTL, so the two must agree
  // to the millisecond or the re-derived message would differ and no signature could verify.
  const issuedAt = Date.now();
  const expiresAt = new Date(issuedAt + RECIPIENT_CONFIRMATION_TTL_MS);
  const session = await getSession();
  session.recipientNonce = nonce;
  session.recipientNonceAt = issuedAt;
  await session.save();

  return Response.json({
    message: recipientAddMessage({
      walletId: wallet.id,
      label: parsed.data.label,
      address,
      maxPerTxBaseUnits: parsed.data.maxPerTx,
      scheduleDayOfMonth: parsed.data.schedule?.dayOfMonth,
      nonce,
      expiresAt,
    }),
    address,
    expiresAt: expiresAt.toISOString(),
  });
}
