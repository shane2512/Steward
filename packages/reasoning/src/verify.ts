import type { Context } from '@steward/context';
import { formatUnits, type Proposal } from '@steward/shared';
import { callJson, type CallMeta } from './call';
import { buildVerifierPrompt } from './prompts';
import { SERV_SCHEMAS, zServVerification } from './schemas';
import type { ServClient } from './serv/client';

export type VerifyOutcome = {
  /** What R15 consumes. Anything we could not establish is UNSURE, which escalates to a human. */
  verifier: { verdict: 'AGREE' | 'DISAGREE' | 'UNSURE'; reasons: string[] };
  checkedFactIds: string[];
  meta?: CallMeta;
};

export type VerifyInput = {
  client: ServClient;
  /** Optionally a different model family for diversity (SERV_MODEL_VERIFIER). */
  model: string;
  ctx: Context;
  proposal: Proposal;
  decimals: number;
};

/**
 * Task 4.7. An independent pass with its own prompt and (optionally) its own model. The proposer's
 * rationale is passed separately and explicitly labelled as a claim, so the verifier forms its view
 * from the facts before it reads the story (SERV_REASONING §4.3).
 */
export async function verify(input: VerifyInput): Promise<VerifyOutcome> {
  const res = await callJson({
    client: input.client,
    task: 'verify',
    model: input.model,
    prompt: buildVerifierPrompt(
      input.ctx,
      describeAction(input.proposal, input.decimals),
      input.proposal.rationale,
    ),
    schema: SERV_SCHEMAS.verify,
    parser: zServVerification,
  });

  if (!res.ok) {
    return {
      verifier: {
        verdict: 'UNSURE',
        reasons: [`verifier unavailable (${res.error.error.code})`],
      },
      checkedFactIds: [],
      meta: res.error.meta,
    };
  }
  const v = res.value.value;
  return {
    verifier: { verdict: v.verdict, reasons: v.reasons },
    checkedFactIds: v.checkedFactIds,
    meta: res.value.meta,
  };
}

/** The action, in ids and whole USDC — never addresses, never calldata. */
export function describeAction(p: Proposal, decimals: number): Record<string, unknown> {
  const params = p.params as Record<string, unknown>;
  const out: Record<string, unknown> = { kind: p.kind, confidence: p.confidence };
  if (typeof params['vaultId'] === 'string') out['vaultId'] = params['vaultId'];
  if (typeof params['recipientId'] === 'string') out['recipientId'] = params['recipientId'];
  if (typeof params['obligationId'] === 'string') out['obligationId'] = params['obligationId'];
  if (typeof params['trigger'] === 'string') out['trigger'] = params['trigger'];
  if (typeof params['amount'] === 'bigint')
    out['amountUsdc'] = formatUnits(params['amount'], decimals);
  out['expectedDeltas'] = p.expectedDeltas.map((d) => ({
    holder: d.holder,
    amountUsdc: formatUnits(d.delta, decimals),
  }));
  out['citedFactIds'] = p.citedFactIds;
  return out;
}
