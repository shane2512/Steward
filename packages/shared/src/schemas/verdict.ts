// Verdict + AllowReceipt schemas per POLICY_ENGINE.md §6-7. Stubs: shape only, logic lives in packages/policy.
import { z } from 'zod';
import { zHash, zHex } from './primitives';

export const zRuleResult = z.object({
  code: z.string(), // R00..R21
  result: z.enum(['PASS', 'ESCALATE', 'DENY']),
  message: z.string().optional(),
});
export type RuleResult = z.infer<typeof zRuleResult>;

// Precedence DENY > ESCALATE > ALLOW (I5).
export const zVerdict = z.object({
  decision: z.enum(['ALLOW', 'ESCALATE', 'DENY']),
  results: z.array(zRuleResult),
  proposalHash: zHash,
  policyVersion: z.number().int().positive(),
  evaluatedAt: z.string(),
});
export type Verdict = z.infer<typeof zVerdict>;

export const zAllowReceipt = z.object({
  proposalHash: zHash,
  policyVersion: z.number().int().positive(),
  walletId: z.string(),
  nonce: z.string().uuid(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  mac: zHex,
});
export type AllowReceipt = z.infer<typeof zAllowReceipt>;
