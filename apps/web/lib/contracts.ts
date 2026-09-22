// Response contracts between the Steward API and the web UI. One zod schema per payload: the routes
// build their JSON to this shape and the client parses every response with it (docs/CLAUDE.md §7).
// Money is always a decimal string of base units (USDC, 6 decimals); the UI formats it with the
// shared money helpers and never with a JS `number` (I12).
import { z } from 'zod';

const amount = z.string().regex(/^\d+$/);
const iso = z.string();

export const zConfig = z.object({
  demoMode: z.boolean(),
  chainId: z.number(),
  explorerBase: z.string(),
});
export type ConfigResponse = z.infer<typeof zConfig>;

export const zMe = z.object({
  user: z.object({ id: z.string(), address: z.string(), displayName: z.string().nullable() }),
  wallet: z
    .object({
      id: z.string(),
      chainId: z.number(),
      agentWalletAddress: z.string().nullable(),
      frozen: z.boolean(),
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof zMe>;

export const zWalletState = z.object({
  wallet: z.object({
    id: z.string(),
    chainId: z.number(),
    treasuryAddress: z.string(),
    agentWalletAddress: z.string().nullable(),
    frozen: z.boolean(),
    breakerOpen: z.boolean(),
  }),
  degraded: z.boolean(),
  balances: z.object({ treasuryUsdc: amount, agentUsdc: amount }),
  spendPermission: z.object({ status: z.string().nullable(), allowanceRemaining: amount }),
  vault: z.object({ address: z.string(), shares: amount, assets: amount }).nullable(),
  maxAtRiskMicroUsd: amount,
});
export type WalletState = z.infer<typeof zWalletState>;

export const zVerdictWord = z.enum(['ALLOW', 'ESCALATE', 'DENY']);
export type VerdictWord = z.infer<typeof zVerdictWord>;

export const zDecisionItem = z.object({
  id: z.string(),
  trigger: z.string(),
  status: z.string(),
  kind: z.string().nullable(),
  /** "Paid Mara Okonjo", "Deposit to Aave USDC": built on the server from labels it owns. */
  title: z.string(),
  /** One sentence, from the deterministic explainer so it can never disagree with the verdict. */
  explanation: z.string(),
  /** Base units, when the proposal carries an amount. */
  amount: amount.nullable(),
  verdict: z
    .object({ decision: zVerdictWord, policyVersion: z.number(), evaluatedAt: iso })
    .nullable(),
  /** Rule codes that blocked or escalated, for the compact row ("R-05"). */
  flaggedRules: z.array(z.string()),
  createdAt: iso,
});
export type DecisionItem = z.infer<typeof zDecisionItem>;

export const zDecisionList = z.object({
  decisions: z.array(zDecisionItem),
  nextCursor: z.string().nullable(),
});
export type DecisionList = z.infer<typeof zDecisionList>;

export const zRuleCheck = z.object({
  code: z.string(),
  result: z.enum(['PASS', 'ESCALATE', 'DENY']),
  message: z.string().nullable(),
  lifted: z.boolean(),
  /** From `ruleSentences` in packages/policy: the same table the server uses. */
  sentence: z.string(),
});
export type RuleCheck = z.infer<typeof zRuleCheck>;

export const zDecisionDetail = z.object({
  decision: z.object({
    id: z.string(),
    trigger: z.string(),
    status: z.string(),
    title: z.string(),
    explanation: z.string(),
    proposalSource: z.string(),
    proposalKind: z.string().nullable(),
    rationale: z.string().nullable(),
    amount: amount.nullable(),
    contextHash: z.string(),
    /** Human-readable context facts: rendered by the server, never raw JSON in the UI. */
    contextFacts: z.array(z.object({ label: z.string(), value: z.string() })),
    screen: z.object({ clean: z.boolean(), note: z.string().nullable() }).nullable(),
    verifier: z.object({ agrees: z.boolean().nullable(), note: z.string().nullable() }).nullable(),
    createdAt: iso,
  }),
  verdict: z
    .object({
      decision: zVerdictWord,
      policyVersion: z.number(),
      evaluatedAt: iso,
      checks: z.array(zRuleCheck),
    })
    .nullable(),
  simulation: z
    .object({
      ok: z.boolean(),
      error: z.string().nullable(),
      deltas: z.array(z.object({ holder: z.string(), token: z.string(), delta: z.string() })),
    })
    .nullable(),
  execution: z
    .object({
      status: z.string(),
      txHash: z.string().nullable(),
      error: z.string().nullable(),
      confirmedAt: iso.nullable(),
    })
    .nullable(),
  /** Set when the verdict is a DENY: the plain-language "Why was this blocked?" text. */
  whyBlocked: z.array(z.string()),
});
export type DecisionDetail = z.infer<typeof zDecisionDetail>;

export const zDashboard = z.object({
  wallet: zWalletState.shape.wallet,
  degraded: z.boolean(),
  /** True when the worker has not ticked for this active wallet in > 10 minutes. */
  paused: z.boolean(),
  lastLoopAt: iso.nullable(),
  demoMode: z.boolean(),
  balances: zWalletState.shape.balances,
  vault: z
    .object({
      name: z.string(),
      address: z.string(),
      shares: amount,
      assets: amount,
      apyPct: z.string().nullable(),
    })
    .nullable(),
  spendPermission: z.object({
    status: z.string().nullable(),
    allowanceRemaining: amount,
    allowance: amount.nullable(),
    periodSeconds: z.number().nullable(),
  }),
  maxAtRiskMicroUsd: amount,
  policy: z
    .object({
      version: z.number(),
      runwayBufferMicroUsd: amount,
      perTxMicroUsd: amount,
      dailyMicroUsd: amount,
    })
    .nullable(),
  pendingApprovals: z.number(),
  obligations: z.array(
    z.object({ id: z.string(), recipientLabel: z.string(), amount, dueDate: z.string() }),
  ),
  recent: z.array(zDecisionItem),
  security: z.object({ blockedCount: z.number(), lastCheckAt: iso.nullable() }),
  /** RR-14: a stuck obligation parks the whole wallet. Shown, never hidden. */
  parked: z.object({ reason: z.string(), since: iso }).nullable(),
  asOf: iso,
});
export type Dashboard = z.infer<typeof zDashboard>;

export const zOnboarding = z.object({
  /** The furthest step the server state allows (1-5), or 'done' when a policy is active. */
  step: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal('done'),
  ]),
  agentWalletAddress: z.string().nullable(),
  mandate: z
    .object({
      id: z.string(),
      text: z.string(),
      template: z.string(),
      sentences: z.array(z.string()),
      assumptions: z.array(z.string()),
      questions: z.array(z.string()),
      compiled: z.boolean(),
    })
    .nullable(),
  spendPermissionStatus: z.string().nullable(),
  activePolicyVersion: z.number().nullable(),
});
export type OnboardingState = z.infer<typeof zOnboarding>;

export const zProvision = z.object({
  walletId: z.string(),
  agentWalletAddress: z.string(),
  created: z.boolean(),
});

export const zIssue = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  suggestion: z.string().nullable(),
});
export const zCompile = z.object({
  compiled: z.boolean(),
  sentences: z.array(z.string()),
  issues: z.array(zIssue),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()),
  /** 'serv' when the model compiled it, 'template' when the deterministic template path did. */
  source: z.enum(['serv', 'template']),
  mandateId: z.string().nullable(),
});
export type CompileResponse = z.infer<typeof zCompile>;

export const zApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** GET /api/audit/verify (task 7.7): OK with a row count, or the exact failing row. Never silent. */
export const zAuditVerify = z.union([
  z.object({ ok: z.literal(true), rows: z.number(), head: z.string() }),
  z.object({
    ok: z.literal(false),
    break: z.object({
      rowId: z.number(),
      reason: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  }),
]);
export type AuditVerify = z.infer<typeof zAuditVerify>;

/* ------------------------------------------------------------------ signing (task 7.6)
 * Every payload the owner signs is produced by a SERVER route and parsed here as opaque data. The
 * client renders it verbatim and hands it to the wallet; it never composes or edits one. That is why
 * these schemas describe shapes, not semantics — there is nothing for the UI to recompute.
 */

/** EIP-712 payload from POST /api/spend-permission/prepare, exactly as `eth_signTypedData_v4` wants it. */
export const zSpendPermissionPrepare = z.object({
  typedData: z.object({
    domain: z.object({
      name: z.string(),
      version: z.string(),
      chainId: z.number(),
      verifyingContract: z.string(),
    }),
    types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
    primaryType: z.string(),
    /** Decimal strings and numbers only (I12): posted back byte-identically. */
    message: z.object({
      account: z.string(),
      spender: z.string(),
      token: z.string(),
      allowance: amount,
      period: z.number(),
      start: z.number(),
      end: z.number(),
      salt: z.string(),
      extraData: z.string(),
    }),
  }),
  permissionHash: z.string(),
});
export type SpendPermissionPrepare = z.infer<typeof zSpendPermissionPrepare>;

export const zSpendPermissionStored = z.object({
  id: z.string(),
  permissionHash: z.string(),
  status: z.string(),
  accountKind: z.string(),
});

/** POST /api/policy/prepare — the literal activation message plus what it commits to. */
export const zPolicyPrepare = z.object({
  version: z.number(),
  bodyHash: z.string(),
  /** EIP-191 text, verbatim. */
  message: z.string(),
  sentences: z.array(z.string()),
  /** Empty on a first activation; otherwise the change from the active version (S7). */
  diff: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    previousVersion: z.number().nullable(),
  }),
});
export type PolicyPrepare = z.infer<typeof zPolicyPrepare>;

export const zPolicyActivated = z.object({
  version: z.number(),
  cancelledApprovals: z.number(),
});

export const zRecipient = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  maxPerTx: amount,
  scheduleDayOfMonth: z.number().nullable(),
  status: z.string(),
});
export type Recipient = z.infer<typeof zRecipient>;

export const zRecipientList = z.object({ recipients: z.array(zRecipient) });
export type RecipientList = z.infer<typeof zRecipientList>;

/** POST /api/recipients/prepare — the literal confirmation message (nonce-bound, 5 min TTL). */
export const zRecipientPrepare = z.object({
  message: z.string(),
  /** Checksummed by the SERVER (I4). The confirmation screen shows this, not the typed input. */
  address: z.string(),
  expiresAt: iso,
});
export type RecipientPrepare = z.infer<typeof zRecipientPrepare>;

export const zRecipientAdded = z.object({
  recipient: zRecipient,
  /** True while the active policy does not yet list this recipient (it needs a new policy version). */
  needsPolicySignature: z.boolean(),
});

export const zApproval = z.object({
  id: z.string(),
  decisionId: z.string(),
  proposalHash: z.string(),
  status: z.string(),
  /** The literal EIP-191 text to sign (SECURITY §5). Never rebuilt by the client. */
  message: z.string(),
  expiresAt: iso,
  decidedAt: iso.nullable(),
  proposal: z.unknown().nullable(),
  rationale: z.string().nullable(),
});
export type Approval = z.infer<typeof zApproval>;

export const zApprovalList = z.object({ approvals: z.array(zApproval) });
export type ApprovalList = z.infer<typeof zApprovalList>;

/** GET /api/policy — the ACTIVE policy, for S7's read-only sentences + JSON views. `body` is the
 * stored policy row rendered as plain JSON (no signature: I9) for the opt-in, clearly-secondary
 * JSON toggle; `sentences` is what renders by default. Null fields mean no policy is active yet. */
export const zPolicyView = z.object({
  version: z.number().nullable(),
  sentences: z.array(z.string()),
  body: z.record(z.string(), z.unknown()).nullable(),
});
export type PolicyView = z.infer<typeof zPolicyView>;

export const zApprovalDecided = z.object({
  approval: z.object({ id: z.string(), status: z.string() }),
  enqueued: z.boolean().optional(),
});

// ── Owner control path (S9 freeze flow, S10 unfreeze; task 7.8) ─────────────────────────────────
// Every step of S9 is described by the SERVER, so a reopened modal resumes from these three fields
// rather than from anything the component remembered (I7: the owner path never depends on the
// worker, the LLM or SERV being alive).

/** The revoke step. `todo` carries the calldata the OWNER's own wallet sends; Steward never does. */
export const zRevokeStep = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('revoked'), at: iso.nullable() }),
  z.object({
    state: z.literal('todo'),
    to: z.string(),
    data: z.string().regex(/^0x[0-9a-fA-F]*$/),
    permissionId: z.string(),
  }),
]);
export type RevokeStep = z.infer<typeof zRevokeStep>;

/** The sweep step: `none`, or the latest `sweep_home` execution's own status. */
export const zSweepStep = z.object({
  state: z.enum(['none', 'pending', 'submitted', 'confirmed', 'failed', 'timeout', 'cancelled']),
  txHash: z.string().nullable().optional(),
});
export type SweepStep = z.infer<typeof zSweepStep>;

export const zOwnerPath = z.object({
  frozen: z.boolean(),
  frozenAt: iso.nullable(),
  frozenReason: z.string().nullable(),
  revoke: zRevokeStep,
  sweep: zSweepStep,
});
export type OwnerPath = z.infer<typeof zOwnerPath>;

export const zFreezePrepare = z.object({ message: z.string(), expiresAt: iso });
export const zFreezeResult = zOwnerPath.extend({
  alreadyFrozen: z.boolean(),
  cancelledApprovals: z.number(),
});
export const zUnfreezeResult = zOwnerPath.extend({ alreadyRunning: z.boolean() });
export const zRevokeReported = z.object({ revoked: z.boolean(), alreadyRevoked: z.boolean() });
export const zSweepResult = zSweepStep.extend({
  verdict: z.enum(['ALLOW', 'ESCALATE', 'DENY']).optional(),
  nothingToSweep: z.boolean().optional(),
});
export type SweepResult = z.infer<typeof zSweepResult>;
