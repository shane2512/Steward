// Server-side view builders for the timeline: they turn stored decision rows (proposal, verdict,
// snapshot) into the plain-language shapes in contracts.ts. Everything here is presentation of data
// the Policy Engine already produced; nothing decides. Rule sentences come from the SAME table the
// engine's own explainer uses (`ruleSentences`), not a copy.
import { ruleSentences } from '@steward/policy';
import { formatUnits } from '@steward/shared';
import { z } from 'zod';
import type { DecisionItem, RuleCheck } from './contracts';

const zProposalLoose = z
  .object({
    kind: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().optional(),
  })
  .passthrough();

const zResults = z.array(
  z.object({
    code: z.string(),
    result: z.enum(['PASS', 'ESCALATE', 'DENY']),
    message: z.string().optional(),
    lifted: z.boolean().optional(),
  }),
);

export type Labels = { recipients: Map<string, string>; vaults: Map<string, string> };

export function parseProposal(raw: unknown) {
  const p = zProposalLoose.safeParse(raw);
  return p.success ? p.data : null;
}

export function proposalAmount(raw: unknown): string | null {
  const a = parseProposal(raw)?.params?.['amount'];
  return typeof a === 'string' && /^\d+$/.test(a) ? a : null;
}

export function decisionTitle(raw: unknown, labels: Labels, status: string): string {
  const p = parseProposal(raw);
  if (!p)
    return status === 'reasoning_invalid'
      ? 'Steward could not form a valid action'
      : 'Steward checked in';
  const params = p.params ?? {};
  const rec = labels.recipients.get(String(params['recipientId'] ?? ''));
  const vault = labels.vaults.get(String(params['vaultId'] ?? ''));
  switch (p.kind) {
    case 'pay_recipient':
      return rec ? `Pay ${rec}` : 'Pay an unlisted recipient';
    case 'vault_deposit':
      return `Deposit to ${vault ?? 'a vault'}`;
    case 'vault_withdraw':
      return `Withdraw from ${vault ?? 'a vault'}`;
    case 'pull_allowance':
      return 'Pull from your allowance';
    case 'sweep_home':
      return 'Sweep funds home';
    case 'risk_exit':
      return `Exit ${vault ?? 'a vault'} on a risk trigger`;
    case 'noop':
      return 'Steward decided to wait';
    default:
      return 'Unrecognised action';
  }
}

export function checksFrom(rawResults: unknown): RuleCheck[] {
  const parsed = zResults.safeParse(rawResults);
  if (!parsed.success) return [];
  return parsed.data.map((r) => ({
    code: r.code,
    result: r.result,
    message: r.message ?? null,
    lifted: r.lifted === true,
    sentence: (ruleSentences as Record<string, string>)[r.code] ?? 'A safety check ran.',
  }));
}

/** One line for the row: the first thing that blocked or escalated, else "all checks passed". */
export function oneLine(
  decision: 'ALLOW' | 'ESCALATE' | 'DENY' | null,
  checks: RuleCheck[],
  status: string,
): string {
  if (!decision) {
    if (status === 'noop') return 'Nothing to do inside your limits.';
    if (status === 'reasoning_invalid')
      return 'Steward proposed something unusable, so nothing happened.';
    return 'Waiting for a verdict.';
  }
  const bad =
    checks.find((c) => c.result === 'DENY') ?? checks.find((c) => c.result === 'ESCALATE');
  if (decision === 'ALLOW') return `Allowed. All ${checks.length} checks passed.`;
  if (!bad) return decision === 'DENY' ? 'Blocked by your mandate.' : 'Needs your approval.';
  return `${decision === 'DENY' ? 'Blocked' : 'Needs you'}: ${bad.sentence}`;
}

export const flagged = (checks: RuleCheck[]): string[] =>
  checks.filter((c) => c.result !== 'PASS').map((c) => c.code);

export type DecisionRowInput = {
  id: string;
  trigger: string;
  status: string;
  proposal: unknown;
  createdAt: Date;
  verdict: {
    decision: 'ALLOW' | 'ESCALATE' | 'DENY';
    policyVersion: number;
    evaluatedAt: Date;
    results: unknown;
  } | null;
};

export function toDecisionItem(row: DecisionRowInput, labels: Labels): DecisionItem {
  const checks = checksFrom(row.verdict?.results);
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    kind: parseProposal(row.proposal)?.kind ?? null,
    title: decisionTitle(row.proposal, labels, row.status),
    explanation: oneLine(row.verdict?.decision ?? null, checks, row.status),
    amount: proposalAmount(row.proposal),
    verdict: row.verdict
      ? {
          decision: row.verdict.decision,
          policyVersion: row.verdict.policyVersion,
          evaluatedAt: row.verdict.evaluatedAt.toISOString(),
        }
      : null,
    flaggedRules: flagged(checks),
    createdAt: row.createdAt.toISOString(),
  };
}

const zFact = z
  .object({ id: z.string(), value: z.string(), unit: z.string().optional() })
  .passthrough();

/** The context the agent saw, as label/value rows. Facts only: untrusted text is never echoed. */
export function contextFacts(snapshot: unknown): { label: string; value: string }[] {
  const facts = z.object({ facts: z.array(zFact) }).safeParse(snapshot);
  if (!facts.success) return [];
  return facts.data.facts.slice(0, 24).map((f) => ({
    label: f.id.replace(/[._-]+/g, ' '),
    value: f.unit ? `${f.value} ${f.unit}` : f.value,
  }));
}

export function screenView(raw: unknown): { clean: boolean; note: string | null } | null {
  const s = z
    .object({ injectionSuspected: z.boolean().optional(), signals: z.array(z.string()).optional() })
    .safeParse(raw);
  if (!s.success || raw == null) return null;
  const suspected = s.data.injectionSuspected === true;
  return {
    clean: !suspected,
    note: suspected
      ? 'Text from outside your team looked like an attempt to instruct Steward. It was fenced off and ignored.'
      : 'No instructions hidden in outside text were found.',
  };
}

export function verifierView(raw: unknown): { agrees: boolean | null; note: string | null } | null {
  const v = z
    .object({ verdict: z.string().optional(), reasons: z.array(z.string()).optional() })
    .safeParse(raw);
  if (!v.success || raw == null) return null;
  return {
    agrees: v.data.verdict === 'AGREE' ? true : v.data.verdict === 'DISAGREE' ? false : null,
    note: v.data.reasons?.[0] ?? null,
  };
}

/** The "Why was this blocked?" text for a DENY: one sentence per blocking rule, plus the safety line. */
export function whyBlocked(decision: string | null, checks: RuleCheck[]): string[] {
  if (decision !== 'DENY') return [];
  const lines = checks.filter((c) => c.result === 'DENY').map((c) => `${c.code}: ${c.sentence}`);
  lines.push('Nothing moved. The action was stopped before it reached your wallet.');
  return lines;
}

export const simDeltas = (raw: unknown): { holder: string; token: string; delta: string }[] => {
  const arr = z
    .array(
      z.object({ holder: z.string(), token: z.string(), delta: z.union([z.string(), z.number()]) }),
    )
    .safeParse(raw);
  if (!arr.success) return [];
  return arr.data.map((d) => {
    const s = String(d.delta);
    const neg = s.startsWith('-');
    const digits = neg ? s.slice(1) : s;
    return {
      holder: d.holder,
      token: d.token,
      delta: /^\d+$/.test(digits) ? `${neg ? '-' : '+'}${formatUnits(BigInt(digits), 6)} USDC` : s,
    };
  });
};
