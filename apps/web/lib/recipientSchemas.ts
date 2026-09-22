// Request bodies for the recipient routes (task 7.6, UX_FLOWS S8). Kept out of the route files so
// they can be unit tested directly.
//
// T3 (address poisoning) is what shapes these: the address is accepted only as 40 hex digits, the
// SERVER checksums it, and the label is refused if it contains anything that could break the
// one-fact-per-line signing message. Nothing here is a similarity check — Steward matches the
// allowlist by exact checksummed equality (I4) and the UI's look-alike warning is advisory only.
import { z } from 'zod';
import { zAmount, zHex } from '@steward/shared';

/** Printable, single-line, trimmed. A label is shown next to money, so it must not lie by layout. */
const zLabel = z
  .string()
  .trim()
  .min(1, 'give this recipient a name')
  .max(80, 'keep the name under 80 characters')
  .refine(
    (s) =>
      Array.from(s).every((ch) => (ch.codePointAt(0) ?? 0) >= 0x20 && ch.codePointAt(0) !== 0x7f),
    'the name cannot contain line breaks or control characters',
  );

export const zRecipientFields = z
  .object({
    label: zLabel,
    /** 40 hex digits. The server applies `getAddress` and stores only the checksummed form. */
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'that is not an Ethereum address'),
    /** Base units of USDC (I12). */
    maxPerTx: zAmount,
    schedule: z
      .object({ dayOfMonth: z.number().int().min(1).max(28), amountMicroUsd: zAmount })
      .strict()
      .optional(),
  })
  .strict();
export type RecipientFields = z.infer<typeof zRecipientFields>;

export const zRecipientAddBody = zRecipientFields.extend({ signature: zHex }).strict();
