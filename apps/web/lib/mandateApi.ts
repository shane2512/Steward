// Request/response plumbing for POST /api/mandate/compile, kept out of the route file so it can be unit
// tested (Next route modules may only export handlers). Nothing here decides anything about funds:
// the compiled draft is validated by `validatePolicyDraft` inside `compileMandate`, and it grants
// nothing until the owner signs it (task 7.6).
import type { PolicyIssue } from '@steward/policy';
import { z } from 'zod';
import type { CompileResponse } from './contracts';

export const MANDATE_MAX_CHARS = 2000;

/** `.strict()`: the client picks the words and a template chip, never addresses or ids. */
export const zCompileBody = z
  .object({
    text: z.string().trim().min(1).max(MANDATE_MAX_CHARS),
    template: z.enum(['startup', 'dao', 'creator', 'custom']),
  })
  .strict();

export const issuesForUi = (issues: readonly PolicyIssue[]): CompileResponse['issues'] =>
  issues.map((i) => ({
    path: i.path,
    code: i.code,
    message: i.message,
    suggestion: i.suggestion ?? null,
  }));

/** The compiler being down is not a validation failure: it triggers the template fallback. */
export const compilerUnavailable = (issues: readonly PolicyIssue[]): boolean =>
  issues.length === 1 && /mandate compiler is unavailable/i.test(issues[0]?.message ?? '');
