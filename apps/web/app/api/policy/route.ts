// GET /api/policy — the ACTIVE policy, for S7 (task 7.7): the default sentences view and the
// opt-in, clearly-secondary JSON view. Read-only; activating a new version is still only
// /api/policy/prepare + /api/policy/activate (task 7.6), never this route.
import { getActivePolicy } from '@steward/db';
import { renderPolicyAsSentences, validatePolicyDraft } from '@steward/policy';
import type { PolicyView } from '@/lib/contracts';
import { fixtureFor } from '@/lib/fixture';
import { fixturePolicyView } from '@/lib/fixtures';
import { isResponse, requireOwner, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const fx = fixtureFor(req);
  if (fx) return Response.json(fixturePolicyView(fx));

  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;

  const active = await getActivePolicy(owner.db, wallet.id);
  if (!active) {
    const empty: PolicyView = { version: null, sentences: [], body: null };
    return Response.json(empty);
  }
  const validated = validatePolicyDraft(active.body);
  const res: PolicyView = {
    version: active.version,
    sentences: validated.ok ? renderPolicyAsSentences(validated.value) : [],
    // The stored body minus the signature (I9 — never echo it back, even though it is the owner's own).
    body:
      active.body && typeof active.body === 'object'
        ? Object.fromEntries(
            Object.entries(active.body as Record<string, unknown>).filter(
              ([k]) => k !== 'signature',
            ),
          )
        : null,
  };
  return Response.json(res);
}
