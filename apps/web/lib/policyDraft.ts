// Server-side: build the exact policy body that `POST /api/policy/prepare` shows the owner and
// `POST /api/policy/activate` stores (task 7.6).
//
// Both routes call `nextPolicyBody` and get a byte-identical result from the same rows, which is what
// lets activation verify a signature over a message it re-derives rather than one the client sends
// back. If anything changed in between (the mandate was recompiled, a recipient was added), the hash
// changes, the message changes, and the old signature simply stops verifying — fail closed (I5).
import {
  getActivePolicy,
  getLatestMandate,
  latestPolicyVersion,
  listRecipients,
  type Db,
  type RecipientRow,
} from '@steward/db';
import {
  renderPolicyAsSentences,
  validatePolicyDraft,
  type TemplateBinding,
} from '@steward/policy';
import {
  canonicalJson,
  hashCanonical,
  policyActivationMessage,
  zPolicy,
  type Address,
} from '@steward/shared';
import { getAddress } from 'viem';
import { z } from 'zod';

const zSchedule = z.object({ dayOfMonth: z.number().int(), amountMicroUsd: z.string() });

/**
 * Allowlist rows as the policy carries them. Shared with `/api/mandate/compile` so a recipient is
 * described identically whether it goes into a template binding or into a policy body.
 */
export function recipientBindings(rows: readonly RecipientRow[]): TemplateBinding['recipients'] {
  return rows
    .filter((r) => r.status === 'active')
    .map((r) => {
      const sched = zSchedule.safeParse(r.schedule);
      return {
        id: r.id,
        label: r.label,
        address: getAddress(r.address),
        // Decimal strings (I12): `zAmount` parses them back to bigint on the way in.
        maxPerTxMicroUsd: r.maxPerTx.toString(),
        ...(sched.success ? { schedule: sched.data } : {}),
      };
    });
}

export type NextPolicy = {
  version: number;
  /** The body WITHOUT `signature`: that is what `bodyHash` covers and what the message pins. */
  unsigned: Record<string, unknown>;
  bodyHash: string;
  message: string;
  sentences: string[];
  mandateId: string | null;
  previous: { version: number; sentences: string[] } | null;
};

export type NextPolicyError = 'no_wallet' | 'no_draft';

/**
 * The next version this wallet would activate. Deterministic: every input is a stored row, and
 * `createdAt` is taken from the mandate rather than the clock so preparing twice yields one hash.
 */
export async function nextPolicyBody(
  db: Db,
  input: { walletId: string; chainId: number; treasuryAddress: string; owner: Address },
): Promise<{ ok: true; value: NextPolicy } | { ok: false; error: NextPolicyError }> {
  const mandate = await getLatestMandate(db, input.walletId);
  if (!mandate || mandate.compiledDraft == null) return { ok: false, error: 'no_draft' };
  const draft = validatePolicyDraft(mandate.compiledDraft);
  if (!draft.ok) return { ok: false, error: 'no_draft' };

  // The allowlist is read fresh, not taken from the draft: a recipient the owner signed for since
  // the mandate was compiled belongs in the version they are about to activate (API.md — adding a
  // recipient triggers a new policy version).
  const recipientRows = await listRecipients(db, input.walletId);

  const version = (await latestPolicyVersion(db, input.walletId)) + 1;
  const unsigned = JSON.parse(
    canonicalJson({
      ...draft.value,
      version,
      walletId: input.walletId,
      chainId: input.chainId,
      treasuryAddress: getAddress(input.treasuryAddress),
      recipients: recipientBindings(recipientRows),
      createdAt: mandate.createdAt.toISOString(),
      signedBy: input.owner,
      signature: undefined,
    }),
  ) as Record<string, unknown>;

  const bodyHash = hashCanonical(unsigned);
  const active = await getActivePolicy(db, input.walletId);
  const activeParsed = active ? zPolicy.safeParse(active.body) : undefined;

  // Sentences are rendered from the body that will be stored, never from the draft, so what the
  // owner reads is what the engine will run.
  const asDraft = validatePolicyDraft({ ...unsigned, signature: '0x' });

  return {
    ok: true,
    value: {
      version,
      unsigned,
      bodyHash,
      message: policyActivationMessage({ version, bodyHash }),
      sentences: asDraft.ok ? renderPolicyAsSentences(asDraft.value) : [],
      mandateId: mandate.id,
      previous:
        active && activeParsed?.success
          ? { version: active.version, sentences: renderPolicyAsSentences(activeParsed.data) }
          : null,
    },
  };
}

/** Sentence-level diff for the S7 re-activation view. Order-insensitive, duplicates preserved. */
export function diffSentences(
  previous: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const remaining = [...previous];
  const added: string[] = [];
  for (const s of next) {
    const at = remaining.indexOf(s);
    if (at === -1) added.push(s);
    else remaining.splice(at, 1);
  }
  return { added, removed: remaining };
}
