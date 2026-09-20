# POLICY ENGINE — Steward

Package: `packages/policy`. **Pure, deterministic, synchronous.** This is the security core.
Model for any change to this package: **Opus**.

## 1. Public API

```ts
// packages/policy/src/index.ts
export function validatePolicyDraft(draft: unknown, ceilings: SystemCeilings): Result<Policy, PolicyIssue[]>;
export function evaluate(input: EvaluationInput): Verdict;
export function signReceipt(v: AllowVerdict, key: Uint8Array, now: Date, nonce: string): AllowReceipt; // HMAC via @noble/hashes (pure)
export function verifyReceipt(r: AllowReceipt, proposalHash: Hex, key: Uint8Array, now: Date): Result<true, ReceiptError>;
export function hashProposal(p: Proposal): Hex;          // sha256 of canonical JSON
export function renderPolicyAsSentences(p: Policy): string[]; // for UI review
```
Only `@noble/hashes` and `packages/shared` may be imported. No clocks: `now` is always passed in.

## 2. Policy schema (zod, in `packages/shared/src/schemas/policy.ts`)

```ts
Policy = {
  version: number,                    // monotonically increasing per wallet
  walletId: string,
  chainId: 84532 | 8453,
  treasuryAddress: Address,           // sweep_home destination (owner)
  tokens: [{ symbol: 'USDC', address: Address, decimals: 6 }],       // MVP: USDC only
  vaults: [{ id: string, name: string, address: Address, asset: Address,
             kind: 'erc4626', maxAllocationBps: number }],           // share of managed funds
  recipients: [{ id: string, label: string, address: Address,
                 maxPerTxMicroUsd: bigint, schedule?: { dayOfMonth: 1..28, amountMicroUsd: bigint } }],
  limits: {
    perTxMicroUsd: bigint,
    dailyMicroUsd: bigint,            // rolling 24h: vault_deposit + pay_recipient
    maxActionsPerHour: number,
  },
  runwayBufferMicroUsd: bigint,       // min liquid USDC (treasury + agent wallet) after any action
  approvalThresholdMicroUsd: bigint,  // >= this ⇒ ESCALATE (default for all kinds)
  approvalThresholdByKind?: Partial<Record<ProposalKind, bigint>>, // e.g. vault_deposit: 60k (moving to allowlisted vault is lower risk)
  depegThresholdBps: number,          // e.g. 50 = 0.5%
  vaultDrawdownBps: number,           // e.g. 100 = share price -1% ⇒ risk_exit
  autonomousKinds: ProposalKind[],    // kinds allowed without approval
  x402?: { dailyBudgetMicroUsd: bigint, allowedHosts: string[] },     // stretch
  createdAt: string, signedBy: Address, signature: Hex
}
```

## 3. Proposal schema

```ts
ProposalKind = 'pull_allowance' | 'vault_deposit' | 'vault_withdraw' | 'pay_recipient'
             | 'sweep_home' | 'risk_exit' | 'noop'
Proposal = {
  kind: ProposalKind,
  params: {                          // discriminated by kind
    pull_allowance: { amount: bigint }
    vault_deposit:  { vaultId: string, amount: bigint }
    vault_withdraw: { vaultId: string, amount: bigint }        // asset amount
    pay_recipient:  { recipientId: string, amount: bigint, obligationId?: string }
    sweep_home:     { }                                        // owner-initiated only
    risk_exit:      { vaultId: string, trigger: 'vault_drawdown'|'asset_depeg' }
  },
  expectedDeltas: [{ token: Address, holder: 'agent'|'treasury'|'recipient', delta: bigint }],
  rationale: string (≤ 600 chars),
  citedFactIds: string[],
  confidence: number (0..1),
  source: 'serv' | 'deterministic' | 'owner'
}
```
Note: proposals reference **IDs** (vaultId, recipientId), never raw addresses. The engine resolves
IDs to addresses from the Policy. This is the core anti-poisoning design: the LLM cannot introduce an address.

## 4. Evaluation input

```ts
EvaluationInput = {
  policy: Policy, proposal: Proposal, now: Date,
  state: { frozen: boolean, breakerOpen: boolean,
           agentUsdc: bigint, treasuryUsdc: bigint, allowanceRemaining: bigint,
           vaultPositions: Record<vaultId, bigint>,   // asset-denominated
           prices: Record<Address, { microUsd: bigint, publishedAt: Date }>,
           contractHasCode: Record<Address, boolean>,
           riskTriggers: { vaultId: string, trigger: 'vault_drawdown'|'asset_depeg', observed: string }[] },
  ledger: { outflowsLast24hMicroUsd: bigint, actionsLastHour: number,
            recentProposalHashes: Hex[] },
  simulation: { ok: boolean, deltas: Delta[], error?: string } | null,
  verifier: { verdict: 'AGREE'|'DISAGREE'|'UNSURE', reasons: string[] } | null,
  screen: { injectionSuspected: boolean, signals: string[] },
  contextFactIds: string[],
  ownerApproval: { signer: Address, proposalHash: Hex, expiresAt: Date } | null,
}
```

## 5. System ceilings (constants, not user-editable)

| Constant | MVP value | Meaning |
|---|---|---|
| `MAX_PER_TX_MICRO_USD` | 250,000 USDC | Hard cap per action |
| `MAX_DAILY_MICRO_USD` | 1,000,000 USDC | Hard cap per 24h |
| `MAX_ACTIONS_PER_HOUR` | 20 | Loop guard |
| `MIN_APPROVAL_THRESHOLD_BPS_OF_DAILY` | ≤ 100% | threshold ≤ daily limit |
| `MAX_VAULTS` / `MAX_RECIPIENTS` | 5 / 50 | |
| `PRICE_MAX_AGE_SEC` | 60 | freshness |
| `RECEIPT_TTL_SEC` | 120 | |
| `MIN_CONFIDENCE_AUTONOMOUS` | 0.6 | below ⇒ ESCALATE |

`validatePolicyDraft` rejects drafts above ceilings (does not silently clamp; returns issues for UI).

## 6. Rule catalogue

Each rule returns `PASS`, `ESCALATE(code)`, or `DENY(code)`. **All rules are evaluated** (no short
circuit) so the audit shows every reason. Final verdict = most severe.

| Code | Rule | Result on fail | Approval can lift? |
|---|---|---|---|
| R00 | Proposal parses against schema; kind known | DENY | no |
| R01 | Wallet not frozen, breaker closed (except `sweep_home` with `source='owner'`) | DENY | no |
| R02 | `kind ∈ policy.autonomousKinds` | ESCALATE | yes |
| R03 | `sweep_home` only with `source='owner'` | DENY | no |
| R04 | vaultId resolves to policy vault; vault address has code; vault.asset ∈ tokens; for `vault_deposit` the vault is not flagged by a risk trigger | DENY | no |
| R05 | recipientId resolves to policy recipient (address from policy only) | DENY | no |
| R06 | `0 < amount ≤ perTxMicroUsd` (converted) and ≤ `MAX_PER_TX` and ≤ recipient.maxPerTx | DENY | no |
| R07 | `outflowsLast24h + amount ≤ dailyMicroUsd`, where outflows = `vault_deposit` + `pay_recipient` amounts in the rolling 24h (`pull_allowance` is bounded separately by R13 + the on-chain allowance) | DENY | no |
| R08 | post-action liquid USDC (agent+treasury) ≥ `runwayBufferMicroUsd` (deposits, payments) | DENY (payments: ESCALATE) | payments only |
| R09 | post-deposit vault position ≤ `maxAllocationBps` of managed funds | ESCALATE | yes |
| R10 | amount ≥ `approvalThresholdByKind[kind] ?? approvalThresholdMicroUsd` | ESCALATE | yes |
| R11 | simulation ok AND deltas match `expectedDeltas` (exact for transfers, ±50 bps for vault ops) | DENY | no |
| R12 | prices for involved tokens fresh (≤ 60 s); for inflows token within depeg threshold | DENY | no |
| R13 | `pull_allowance.amount ≤ allowanceRemaining` | DENY | no |
| R14 | `actionsLastHour < maxActionsPerHour` | DENY (+ breaker signal) | no |
| R15 | verifier AGREE (DISAGREE ⇒ DENY, UNSURE/null ⇒ ESCALATE); skipped for `source∈{deterministic,owner}` | DENY/ESCALATE | UNSURE only |
| R16 | if `screen.injectionSuspected` and kind moves value to a non-treasury holder ⇒ DENY; else ESCALATE | DENY/ESCALATE | ESCALATE part only |
| R17 | proposal hash not in `recentProposalHashes` (24h) | DENY | no |
| R18 | any approval in simulation is exact-amount to an allowlisted vault | DENY | no |
| R19 | all `citedFactIds ⊆ contextFactIds`; `confidence ≥ MIN_CONFIDENCE_AUTONOMOUS` else ESCALATE | DENY (unknown IDs) / ESCALATE (low conf) | low conf only |
| R20 | `risk_exit` allowed autonomously even if not in autonomousKinds **iff** a risk trigger is present in state (vault share price dropped ≥ `vaultDrawdownBps` since last snapshot, OR vault asset price < $1 − depegThreshold) and funds only move vault → agent wallet | PASS override of R02 | n/a |
| R21 | chainId matches policy; mainnet requires `allowMainnet` flag in input | DENY | no |

Verdict object:
```ts
Verdict = { decision: 'ALLOW'|'ESCALATE'|'DENY', results: RuleResult[], proposalHash: Hex,
            policyVersion: number, evaluatedAt: string }
```
With `ownerApproval` present and valid (signer == policy owner, hash matches, not expired): rules
whose "Approval can lift" is yes are converted to PASS. DENY rules are never lifted.

## 7. AllowReceipt

```ts
AllowReceipt = { proposalHash: Hex, policyVersion: number, walletId: string,
                 nonce: string /*uuid v4 generated by caller*/, issuedAt: string, expiresAt: string,
                 mac: Hex /* HMAC-SHA256(key, canonical_json(all fields except mac)) */ }
```
Executor checks: MAC valid (constant-time compare), not expired, `proposalHash` equals hash of the
proposal being executed, policyVersion == active version, nonce not previously used (DB unique insert
**before** sending), wallet not frozen.

## 8. Canonical JSON

Sorted keys, bigint serialized as decimal string with `n` suffix removed and field typed in schema,
no whitespace. Same function used for proposal hash, receipts and audit hash chain (`packages/shared/canonical.ts`).

## 9. Testing requirements (Phase 3 gate)

- 100% branch coverage of `packages/policy`.
- One positive + one negative unit test per rule code.
- Property tests (fast-check):
  - P1: no input with an address not in policy ever yields ALLOW.
  - P2: if `frozen` then decision ≠ ALLOW unless `sweep_home` + owner source.
  - P3: ALLOW ⇒ amount ≤ min(perTx, MAX_PER_TX, daily − outflows).
  - P4: evaluate is deterministic (same input ⇒ identical output, 1000 runs).
  - P5: ownerApproval never flips a DENY-class rule.
  - P6: tampering any receipt field ⇒ verifyReceipt fails.
- Golden tests: the 5 scenarios in `DEMO.md` produce the documented verdicts.
