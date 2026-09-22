// POST /api/mandate/compile: plain-English mandate -> compiled draft + sentences (API.md, task 7.3).
//
// SERV proposes, deterministic code disposes: `compileMandate` asks the model for numbers only, then
// `validatePolicyDraft` decides whether that draft may exist. Addresses come from the owner's own
// rows, never from the model or the request. The draft is stored as a mandate row and grants
// NOTHING: it becomes a policy only after the owner signs it (task 7.6, not built here).
//
// This route imports `reasoning` (read/compile only) and `policy` (pure). It does not import the
// wallet executor and is not on the owner path, so `check:arch` stays green.
import { appendAudit, insertMandate, listRecipients, listVaultRows } from '@steward/db';
import {
  policyDraftFromTemplate,
  renderPolicyAsSentences,
  type TemplateBinding,
} from '@steward/policy';
import { compileMandate, LiveServClient } from '@steward/reasoning';
import { canonicalJson, getEnv, type PolicyDraft } from '@steward/shared';
import { getAddress } from 'viem';
import type { CompileResponse } from '@/lib/contracts';
import { compilerUnavailable, issuesForUi, zCompileBody } from '@/lib/mandateApi';
import { recipientBindings } from '@/lib/policyDraft';
import { apiError } from '@/lib/server';
import { isResponse, requireOwner, requireProvisioned, requireWallet } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (isResponse(owner)) return owner;
  const wallet = await requireWallet(owner);
  if (isResponse(wallet)) return wallet;
  const agent = requireProvisioned(wallet);
  if (isResponse(agent)) return agent;

  const body = zCompileBody.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return apiError(
      400,
      'bad_request',
      'Write your mandate in 1 to 2000 characters and pick a template.',
    );

  const env = getEnv();
  if (wallet.chainId !== 84532 && wallet.chainId !== 8453)
    return apiError(400, 'bad_chain', 'unsupported chain');
  const [vaultRows, recipientRows] = await Promise.all([
    listVaultRows(owner.db, wallet.id),
    listRecipients(owner.db, wallet.id),
  ]);
  const binding: TemplateBinding = {
    chainId: wallet.chainId,
    treasuryAddress: getAddress(wallet.treasuryAddress),
    usdcAddress: getAddress(env.USDC_ADDRESS),
    vaults: vaultRows.map((v) => ({
      id: v.id,
      name: v.name,
      address: getAddress(v.address),
      maxAllocationBps: v.maxAllocationBps,
    })),
    // Same mapping the policy body uses (lib/policyDraft.ts), so a recipient is described
    // identically whether it reaches the compiler or the signed policy.
    recipients: recipientBindings(recipientRows),
  };

  let draft: PolicyDraft | undefined;
  let sentences: string[] = [];
  let issues: CompileResponse['issues'] = [];
  let assumptions: string[] = [];
  let questions: string[] = [];
  let source: CompileResponse['source'] = 'serv';
  let needTemplate = true;

  if (env.SERV_API_KEY) {
    const out = await compileMandate({
      client: new LiveServClient({ apiKey: env.SERV_API_KEY, baseURL: env.SERV_BASE_URL }),
      model: env.SERV_MODEL_PROPOSER,
      mandateText: body.data.text,
      binding,
    });
    // A real validation failure is shown as-is; only "the compiler is down" falls back to a template.
    if (!compilerUnavailable(out.issues)) {
      needTemplate = false;
      draft = out.draft;
      sentences = out.sentences;
      issues = issuesForUi(out.issues);
      assumptions = out.assumptions;
      questions = out.questions;
    }
  }

  if (needTemplate) {
    source = 'template';
    if (body.data.template === 'custom') {
      issues = [
        {
          path: '',
          code: 'MISSING',
          message:
            'The mandate compiler is unavailable right now, so a custom mandate cannot be compiled.',
          suggestion: 'Pick a template above and edit the numbers later, or try again in a minute.',
        },
      ];
    } else {
      // The template result still goes through `validatePolicyDraft` inside `policyDraftFromTemplate`.
      const t = policyDraftFromTemplate(body.data.template, binding);
      if (t.ok) {
        draft = t.value;
        sentences = renderPolicyAsSentences(t.value);
        assumptions = [
          `The mandate compiler was unavailable, so Steward used the ${body.data.template} template instead of your text.`,
        ];
      } else {
        issues = issuesForUi(t.error);
      }
    }
  }

  const mandate = await insertMandate(owner.db, {
    walletId: wallet.id,
    text: body.data.text,
    template: body.data.template,
    // Canonical JSON turns bigint micro-USD into decimal strings (I12) so the jsonb round-trips.
    compiledDraft: draft ? (JSON.parse(canonicalJson(draft)) as unknown) : null,
    assumptions,
    questions,
  });
  const audited = await appendAudit(owner.db, {
    walletId: wallet.id,
    actor: 'owner',
    event: 'MANDATE_COMPILED',
    entityType: 'mandate',
    entityId: mandate.id,
    payload: { source, compiled: draft !== undefined, issues: issues.length },
  });
  if (!audited.ok) return apiError(500, 'audit_failed', audited.error.code);

  const res: CompileResponse = {
    compiled: draft !== undefined && issues.length === 0,
    sentences,
    issues,
    assumptions,
    questions,
    source,
    mandateId: mandate.id,
  };
  return Response.json(res);
}
