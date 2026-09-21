# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: **Phase 4 complete (Opus)**, awaiting human "continue"; Phase 3 complete 2026-09-21
Required model: Phase 5 = Opus
Last updated: 2026-09-21

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| 0 | Verification spike & repo bootstrap | Sonnet | ✅ | 2026-09-20 | V-10 partial (no real Smart Wallet), V-13 false->MockPriceFeed, V-09 fallback; human approved carrying V-10 to Phase 1.8/7.6 | | |
| 1 | Monorepo foundation, DB, auth | Sonnet (+Opus 1.9) | ✅ | 2026-09-20 | Gate green: typecheck 9/9, lint clean, check:arch 53 modules/63 deps 0 violations, test 7 files/43 tests |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9, lint clean, check:arch 86 modules/152 deps 0 violations, test 16 files/164 tests, contracts:test 16/16. Mocks live on 84532; live spend + revoke done through product code |
| 3 | Policy Engine & mandate validator | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9, lint clean, check:arch 129 modules/278 deps 0 violations + both violation fixtures fire, test 24 files/508 tests, `packages/policy` **100% branches (411/411)** enforced in its own vitest config |
| 4 | SERV reasoning & injection defenses | Opus | ☐ | | |
| 5 | Risk gate, executor, confirmer | Opus | ☐ | | |
| 6 | Decision loop, scheduler, obligations, risk exits | Opus | ☐ | | |
| 7 | Web app UX | Sonnet (+Opus sub-tasks) | ☐ | | |
| 8 | Owner controls, notifications, hardening, security review | Opus (+Sonnet sub-tasks) | ☐ | | |
| 9 | Demo, deployment, docs, submission | Sonnet (+Opus gate) | ☐ | | |

## Phase 3 — tasks (all done 2026-09-21)
- [x] 3.1 zod schemas finalised in `packages/shared`: `zPolicy` + `zPolicyDraft`, `zProposal`
  (discriminated union, strict params), `zEvaluationInput`, `zVerdict`, `zAllowReceipt`.
  `zAmount` is now **non-negative by construction** and `Hex` is exported from shared so pure
  packages need no viem.
- [x] 3.2 `SYSTEM_CEILINGS` (shared, single source of truth) + `validatePolicyDraft` returning
  `PolicyIssue[]` (`path`, `code`, `message`, `suggestion`) — 25 distinct checks, rejects, never clamps.
- [x] 3.3 R00–R21 as individual pure `(input) => RuleResult` functions in
  `packages/policy/src/rules/Rxx.ts`, registered in the static ordered array `RULES`. All 22 run on
  every evaluation; no short circuit (asserted by a test).
- [x] 3.4 `evaluate()` — precedence DENY > ESCALATE > ALLOW, owner-approval lifting
  (`APPROVAL_LIFTABLE` = R02, R08, R09, R10, R15, R16, R19, R20; DENY never lifted), R20's documented
  override of R02, and a fail-closed wrapper that never throws.
- [x] 3.5 `units.ts`: `baseUnitsToMicroUsd` / `microUsdToBaseUnits` / `valueInput` — bigint only,
  oracle price always, `$1.00` assumed only via the explicitly-passed DEMO fallback on chain 84532.
- [x] 3.6 `hashProposal`, `signReceipt`, `verifyReceipt` (HMAC-SHA256 via `@noble/hashes`,
  constant-time digest compare, TTL / issued-in-future / proposalHash / policyVersion / walletId /
  callsHash checks).
- [x] 3.7 `renderPolicyAsSentences(policy)` + `ruleSentences` (23 codes incl. `ENGINE`).
- [x] 3.8 Mandate templates `startup` (the DEMO.md values), `dao`, `creator` — JSON-safe presets that
  carry **no addresses**; `policyDraftFromTemplate` validates the result.
- [x] 3.9 `explainVerdict(verdict)` deterministic fallback text.
- [x] Purity enforcement: depcruise rules scoped to `packages/policy/src` (only `@steward/shared` +
  `@noble/hashes`), new eslint rules for that path (`Date.now`, `new Date()`, `Math.random`,
  `process`/`process.env`, `fetch`, `crypto`, `globalThis`, `setTimeout`, `await`), and a second
  deliberate-violation fixture (`scripts/fixtures/lint/...`) wired into `pnpm check:arch`.

## Phase 3 Exit Gate result (2026-09-21)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks + `scripts/live` tsconfig |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style!" |
| `pnpm check:arch` | ✅ 0 violations (**129 modules, 278 dependencies**); arch fixture detected (`policy-only-shared`); purity fixture detected **10 problems** (5 `no-restricted-syntax`, 5 `no-restricted-globals`) |
| `pnpm test` | ✅ **24 files / 508 tests passed**, 1 file / 4 skipped (the opt-in Phase 2 fork suite) |
| `pnpm test:policy` (coverage, part of `pnpm test`) | ✅ 8 files / **344 tests**; **Statements 100% (562/562) · Branches 100% (411/411) · Functions 100% (105/105) · Lines 100% (465/465)** |
| coverage is *enforced* | ✅ `packages/policy/vitest.config.ts` thresholds 100/100/100/100 — it failed the run at 95.88% branches during development and only passed once the last branch was covered |

Test breakdown (`packages/policy/test`): `rules.test.ts` 122 (positive **and** negative per rule),
`evaluate.test.ts` 32 (precedence, lifting, fail-closed, hard-rule mutation flips),
`property.test.ts` 15 (P1–P6 + monotonicity + 2,000 garbage inputs), `receipt.test.ts` 32,
`golden.test.ts` 10 (the DEMO.md table), `mandate.test.ts` 48, `units.test.ts` 18,
`adversarial.test.ts` 47.

## Phase 3 — Opus review gate: threat matrix (SECURITY §2, T1–T17)

Every threat maps to deterministic code. **No threat is left resting on the LLM layer**; the three
residual risks at the bottom are outside the engine's reach, not delegated to reasoning.

| ID | Threat | Rule(s) / mechanism that mitigate it | Test evidence (file › name) |
|---|---|---|---|
| T1 | Prompt injection | **R16** (flagged ⇒ DENY for every value-out kind, ESCALATE for sweep, PASS for noop/risk_exit — and R16's DENY is *not* liftable), backed by R05/R04 allowlists, R19 grounding, R15 verifier | `adversarial` › "A16 … a flagged proposal cannot move value even when everything else is perfect"; `golden` › "t=1:30 — the attack memo can never move value"; `rules` › R16 ×5 |
| T2 | Excessive agency | **R02** (autonomousKinds), **R10** (approval threshold), R06/R07/R08/R14 caps | `adversarial` › "A12 … a kind outside autonomousKinds escalates instead of executing", "… an empty autonomousKinds list cannot be bypassed by claiming source=owner"; `rules` › R02, R10 |
| T3 | Address poisoning | **R05** (id → Policy address, exact match, no ENS/fuzzy), R04 for vaults; templates contain no addresses; `validatePolicyDraft` rejects duplicate recipient addresses and the treasury as a payee | `adversarial` › "A03 … cannot be paid: ids resolve through the Policy, never through an address" (6 lookalikes incl. zero-width and Cyrillic "е"); `property` › "P1 … holds when a poisoned lookalike is present in state and simulation"; `mandate` › duplicate-address checks |
| T4 | Malicious contract | **R04** (allowlist + `contractHasCode` + asset is a policy token), **R11** (simulation parity, both directions), R18 | `adversarial` › "A13 … a vault that is not in the policy is denied even with a perfect simulation"; `rules` › R04 ×7, R11 ×11 |
| T5 | Unlimited approvals | **R18** (≤1 approval, exact amount, only to *this* deposit's allowlisted vault, only on a policy token; any approval on any other kind is a DENY) | `adversarial` › "A17 … cannot smuggle an unlimited approval into a legitimate deposit"; `rules` › R18 ×8 incl. `2^256-1` |
| T6 | Agent wallet key compromise | Bound, not prevented: **R13** (≤ on-chain allowance), **R01** (freeze/breaker), and the executor cannot act without a valid `AllowReceipt` | `rules` › R13, R01; `receipt` › "refuses a different secret". Residual **RR-2** below |
| T7 | Owner session hijack | `ownerApproval` is only honoured when `signer == policy.signedBy`, the hash matches the *evaluated* proposal and it has not expired; it can never lift a DENY | `evaluate` › "ignores an approval signed by somebody else", "ignores an approval for a different proposal", "ignores an expired approval"; `property` › P5 ×2. Residual **RR-1** (signature verification is the caller's job) |
| T8 | SERV wrong / hallucinated reasoning | **R19** (every cited fact must exist; low confidence ⇒ ESCALATE), **R15** (DISAGREE ⇒ DENY, UNSURE/absent ⇒ ESCALATE), **R11** (the simulation, not the rationale, decides what moved) | `adversarial` › "A17 … cannot invent facts", "… cannot understate the deltas of its own transfer", "… cannot claim a confidence above 1 or below 0"; `rules` › R19 ×3, R15 ×7 |
| T9 | Replay / duplicate execution | **R17** (`hashProposal` over the *action*, so rewording the rationale does not mint a new hash) + receipt `nonce`/TTL/`proposalHash`/`callsHash` | `adversarial` › "A08 … the same action twice in 24h is denied the second time", "… rewording the rationale does not produce a new hash"; `receipt` › callsHash binding, P6 |
| T10 | Execution loop | **R14** (`min(policy, MAX_ACTIONS_PER_HOUR)`) | `adversarial` › "A18 — the loop"; `rules` › R14 ×3 |
| T11 | Stale / manipulated prices | **R12** (age ≤ 60 s, future-dated ⇒ DENY, depeg ⇒ DENY for every price-sized kind) + `valueInput` refuses a zero price | `adversarial` › "A05 — stale price at the boundary" (59/60/61 s), "… refuses a quote from the future", "A11 — price scaling" ×2; `units` › valueInput failures |
| T12 | Depeg / vault exploit | **R20** (pre-authorised exit, only with a real trigger, funds only vault→agent), **R04** (no deposits into a flagged vault), R12/R16 exemptions so the exit is never blocked | `golden` › "t=2:25 — a 3% vault drawdown exits autonomously via R20"; `adversarial` › "A13 … a deposit into a vault that is already flagged is denied", "A16 … but a flagged risk exit still runs" |
| T13 | Secrets leak via logs/prompts | The engine has no env, no logger, no network and no clock: enforced by `check:arch` (imports) **and** the new eslint purity rules (ambient globals), both with violation fixtures. The receipt key arrives as a `Uint8Array` argument and is never stored, logged or serialised | `pnpm check:arch` output above (both fixtures fire). Residual **RR-2** |
| T14 | Audit tampering | Out of the engine (Phase 1 hash chain), but the engine makes an audited decision *reproducible*: identical input ⇒ byte-identical verdict, and it never mutates its input | `property` › "P4 … produces byte-identical verdicts for the same input, 1000 times", "does not mutate its input" |
| T15 | Demo override abuse | The $1.00 parity fallback needs an explicit caller flag **and** chainId 84532, and never overrides a real quote; R21 re-checks the chain and refuses mainnet without `allowMainnet` | `units` › "uses the fenced DEMO parity fallback only on Base Sepolia", "never overrides a real quote with the fallback"; `rules` › R12 demo ×2, R21 ×4 |
| T16 | Malicious owner instruction | `validatePolicyDraft` rejects (never clamps) anything above a ceiling, and the rules re-check the **system** ceilings themselves, so a policy row that somehow got past the validator still cannot raise a limit | `mandate` › 16-case rejection table + ceiling tests; `rules` › R06 "denies above the system ceiling even if the policy allowed it", R07 "… system daily ceiling", R14 "… system ceiling even if the policy asked for more" |
| T17 | Permission escalation via received assets | No rule grants authority from a holding. Tokens, vaults and recipients exist only in the Policy; an airdropped token has no policy entry, so it cannot be valued (R06/R12), cannot be a target (R04/R05) and cannot be approved (R18). A phantom vault position is ignored when computing managed funds | `property` › P1 "poisoned lookalike … in state"; `adversarial` › "A13 … a phantom position in state cannot inflate managed funds"; `units` › "ignores positions in vaults the policy does not allowlist" |

**Adjustments made *because* of this review** (both found by the adversarial pass, both now rules):
1. **R12's depeg check was widened** from "inflows only" to *every kind that is sized from the price*
   (all but `risk_exit`, `sweep_home`, `noop`). A 1 micro-USD quote made a 50,000 USDC payment read as
   $0.05 and slid under the per-tx, daily and approval-threshold caps — every limit in the engine is
   denominated in micro-USD, so a broken quote is a broken cap, not merely a wobbly token (D-29).
2. **R09 now counts only allowlisted vault positions** as managed funds, so a stray `vaultPositions`
   entry cannot inflate the denominator and hide a concentrated deposit (D-30).

**Residual risks (recorded, not delegated to the LLM):**
- **RR-1 — the engine trusts that `ownerApproval.signer` was cryptographically verified.** It checks
  the signer equals `policy.signedBy`, that the hash is for *this* proposal and that it has not
  expired, but it cannot verify an EIP-191/ERC-1271 signature without I/O. Phase 6.4 / 7.6 must
  verify the signature **before** building the `EvaluationInput`.
- **RR-2 — key material lives outside the engine.** A compromised backend holding the HMAC receipt
  key can mint receipts for proposals the engine allowed. Bounded by the on-chain spend permission
  (SECURITY §3 L2) and by freeze/revoke; the engine's contribution is that a receipt is useless for a
  different proposal, policy version, wallet, call set or time window.
- **RR-3 — `proposal.source` is data, not proof.** R15 skips the verifier for
  `source ∈ {deterministic, owner}` (per spec) and R03 requires `source='owner'` for a sweep. A
  compromised proposer that forges `source='owner'` therefore skips R15 — but it still faces every
  hard rule, and R02 deliberately does **not** exempt owner-sourced proposals (D-26), so such a
  proposal escalates to the human instead of executing. Phases 4/6 must set `source` in code, never
  from model output.

## Phase 2 — tasks (all done 2026-09-21)
- [x] 2.1 `contracts/` Foundry project: MockVault (OZ ERC-4626 over real USDC), MockPriceFeed, 16 tests, deployed to Base Sepolia
- [x] 2.2 `packages/wallet/src/agentkit.ts`: `buildAgentKit`, action-name drift assertion, D-1 unhandledRejection logger, I8 network guard
- [x] 2.3 `provisionAgentWallet(userId)`: idempotent, stores address + ref, audits `WALLET_PROVISIONED`
- [x] 2.4 `spendPermission.ts`: pure encoders / typed data / hash / validation, D-5 EOA rejection, `ensureApprovedOnchain`, `readAllowanceRemaining`, `isRevoked`, `buildSpendCall`
- [x] 2.5 `actionRegistry.ts`: `buildCalls` for every ProposalKind + `callsHash`, exact-amount approvals, Policy-only address resolution
- [x] 2.6 Read models: `getBalances`, `getVaultPosition`, `getSharePrice`, `getMockPrice`, `maxAtRisk`
- [x] 2.7 API: `/api/wallet/provision`, `/api/wallet`, `/api/spend-permission/prepare`, `/api/spend-permission` (GET/POST)
- [x] 2.8 [SHOULD] anvil fork harness (`packages/wallet/test/fork/`), opt-in via `STEWARD_FORK=1`

## Phase 2 Exit Gate result (2026-09-21)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks + `scripts/live` tsconfig |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style!" |
| `pnpm check:arch` | ✅ no dependency violations (86 modules, 152 dependencies cruised) |
| `pnpm test` | ✅ 16 files / **164 tests passed**; 1 file / 4 tests skipped (the opt-in fork suite) in 30.3 s |
| `pnpm contracts:test` | ✅ `forge test --root contracts` — 2 suites, **16 passed, 0 failed** (incl. a 256-run share-price fuzz) |
| fork suite (opt-in) | ✅ `STEWARD_FORK=1 … vitest run packages/wallet/test/fork` — **4/4 passed**: deposit / withdraw / sweep calldata executed against the real deployed MockVault on an anvil fork of Base Sepolia |
| contracts deployed + verified on-chain | ✅ all 7 on-chain checks OK (below) |
| live spend-permission flow | ✅ below |

### Contracts on Base Sepolia (84532)
| Contract | Address | Deploy tx |
|---|---|---|
| MockVault | `0x3741f0da6dFFfFD8Be2353e326a49E41a3396485` | `0xf140e9d80d907038118d5d4e4dd3a0538d43ef1e81b7bc5f054afaa1b8c151bb` |
| MockPriceFeed | `0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69` | `0x2eddcedbf196f5289dbe1266bf67d8d75e0c8f52f057946a0567d8d028754ff5` |
| Demo admin (owner of both) | `0xC388F1602dF570289825ac907a1C3D80A2916924` | CDP account `steward-demo-admin`, no key on disk |

On-chain verification printed by `pnpm contracts:deploy`, all OK: MockVault has code (5241 bytes),
MockPriceFeed has code (1112 bytes), `vault.owner()` == demo admin, `vault.asset()` == USDC,
`vault.decimals()` == 6 == USDC decimals, `feed.owner()` == demo admin, feed price == $1.00.
Basescan source verification was not done (optional in 2.1).

### Live end-to-end on Base Sepolia through the new product code (2026-09-21)
`STEWARD_LIVE=1 pnpm live:spend-permission` → `scripts/live/spend-permission-e2e.ts`.
Agent wallet `0xE967db385aF313Cc6CA006a745fc929A201F58A2`, owner treasury (Coinbase Smart Wallet)
`0xE72B889052382487604b7A92E8F7fB1a5937F242`, permission hash
`0x41b2e2830546d1f824f1068170b1f017fe61dcb2668cc8449108bcae6a2ed52f`.

| Step | Result | Tx |
|---|---|---|
| owner smart wallet deployed | ok | `0x1f94ccc92e9d7e6380a992bd04199753f8855086734a6ab78b15e4ce35eb16b6` |
| manager added as wallet owner | ok, `isOwnerAddress` verified true | `0x4abb2524f1a145090d19b246f3a84d16f9e163e9c886313335f6f17b50333b17` |
| D-5 owner-account check | `deployed-contract` (signature 450 hex chars ⇒ ERC-1271, not a 132-char EOA sig) | — |
| `ensureApprovedOnchain` | `approved`, userOp complete | `0x0d40906f6d42532f4cb0a315cf28bc62ddc20534ff3c7e04bf6ec885c286dacc` |
| `ensureApprovedOnchain` again | `already-approved`, **no second transaction** (idempotent) | — |
| `buildCalls(pull_allowance)` → spend 1 USDC | treasury 1 → 0 USDC, agent 1 → 2 USDC; allowance remaining 4 USDC | `0x83abf077dd8038ccb8e1220320eaee47cb43a08991552b83298c03ea32e4d6cb` |
| owner revoke (`execute` → `revoke(permission)`) | `isRevoked` == true | `0xee8b42e745306a2e3cd86fbd0b15f91520a255868c6ee060554a66ad9b1bb206` |
| post-revoke spend (the same calls) | **rejected** — userOp gas estimation reverts; agent USDC unchanged at 2 | — |
| `ensureApprovedOnchain` on the revoked permission | refused: "permission is revoked on-chain" | — |

**Owner-wallet caveat (carried from V-10):** the human has no passkey Coinbase Smart Wallet, so the
live script builds a real Coinbase Smart Wallet via viem `toCoinbaseSmartAccount` whose owner is an
**ephemeral key generated in memory for that run** — never written to disk, never logged, testnet
only. The path exercised (EIP-712 → ERC-1271 → `approveWithSignature` → `spend` → `revoke`) is
identical to a passkey wallet's. Only the passkey **popup UX** stays untested; that is Phase 7.6.

## Phase 2 — Opus review gate (evidence)

**Q1 — Can any code path produce a call to an address not from Policy / treasury / vault / USDC /
SpendPermissionManager? → NO.**
`buildCalls` is the only producer of `Call[]`. Every address is resolved from the active Policy
(`policy.tokens`, `policy.vaults[].address`, `policy.recipients[].address`, `policy.treasuryAddress`)
plus `ctx.spendPermissionManagerAddress`; proposals carry **IDs only** (I4 / T3). Before returning,
`assertAllowedTargets` re-checks every call against `allowedTargets(policy, ctx)` and rejects anything
else with `DISALLOWED_TARGET`, plus any non-zero `value`.
Evidence — `packages/wallet/test/actionRegistry.test.ts` (28 tests): "the allowlist is exactly
{tokens, vaults, recipients, treasury, SpendPermissionManager}"; "no kind can produce a call outside
the allowlist, and none carries native value" (loops all 7 kinds); "an address that appears only in
proposal-adjacent state never becomes a target" (poisoned `recipientId` → `UNKNOWN_RECIPIENT`).

**Q2 — Are approvals ever > exact amount? Any `maxUint256`? → NO.**
The only `approve` any kind emits is `vault_deposit`'s, for exactly the deposited amount, to a Policy
vault. `grep -rniE "maxuint|ffffffffffffffff|type\(uint256\)\.max|increaseAllowance"` over
`packages/*/src apps/*/app apps/*/lib contracts/src` returns **two comment lines only**
(`abi.ts:104`, `actionRegistry.ts:163`) — no code. `ERC20_ABI` deliberately omits `increaseAllowance`.
Evidence — actionRegistry.test.ts: "the only approve in any kind is for exactly the deposited amount"
(collects every approve across all kinds → `[{spender: VAULT, value: 1_000_000n}]`) and "no call
encodes the unbounded value …" for `maxUint256` and `2^160−1`. The fork test additionally asserts the
**residual on-chain allowance is 0** after a real deposit.

**Q3 — Are CDP secrets ever logged or serialized? → NO.**
`grep -rn "reveal()"` over product code returns 4 hits: the `Secret` class itself, `session.ts`
(SESSION_SECRET → iron-session), and two in `apps/web/lib/wallet.ts` where the CDP client is built.
`packages/wallet/src` contains **zero** `reveal()` calls and never touches `process.env`.
Evidence — `packages/wallet/test/secrets.test.ts` (9 tests): a static scan of every file in
`packages/wallet/src` for `.reveal()`, for logging/stringifying a credential, for `process.env[`, and
for an LLM-framework import; plus runtime checks that `Secret` redacts through `toString`,
`JSON.stringify` and `canonicalJson`, that the parsed env exposes CDP credentials only as `Secret`,
and that pino redacts `apiKey`/`secret`/`signature` (asserting the raw value never appears in output).
Signatures are never returned by the API and never enter an audit payload (D-16): the grant audit
stores the permission, its hash and the account kind only.

**Q4 — Mainnet guard tested? → YES.**
`assertChainAllowed` refuses 8453 without `STEWARD_ALLOW_MAINNET`, **and still refuses it with the flag
set**, because `MAINNET_GATE_SIGNED_OFF === false` (D-17). Unknown chain ids are refused too.
Tests: `chain.test.ts` (incl. 6 unsupported chain ids), `actionRegistry.test.ts` "refuses mainnet even
with allowMainnet set…", `provision.test.ts` "refuses mainnet (I8) **before touching CDP**" (asserts
zero CDP calls were made).

### Every function that can broadcast a transaction (Phase 2)
| Function | What it can emit | Why it is safe | Reachable from anything LLM-facing? |
|---|---|---|---|
| `ensureApprovedOnchain` (`packages/wallet/src/spendPermission.ts`) | exactly one `approveWithSignature(permission, ownerSignature)` to the SpendPermissionManager, value 0 | Registers the **owner's own** grant; moves no funds. Refuses if the sender is not the permission's spender, if the permission is revoked, or if it is already approved (idempotent). Fails closed on any RPC error. | No |
| `scripts/live/deploy-contracts.ts` | CREATE2 deploys of the two mocks via the canonical proxy | Manual, gated behind `STEWARD_LIVE=1`, testnet only, imported by no product module | No |
| `scripts/live/spend-permission-e2e.ts` | the live flow above | Same gate, manual only | No |
| `provisionAgentWallet` | **nothing** — `getOrCreateSmartAccount` registers a counterfactual account, deployed by its first user operation | — | No |
| `buildCalls` / all of `actionRegistry.ts` | **nothing** — returns `Call[]` | Pure | n/a |

`grep -rn "sendTransaction\|sendUserOperation"` over `packages/*/src` + `apps/web` returns exactly two
lines, both in `spendPermission.ts`: the `TxSender` type declaration and the single call inside
`ensureApprovedOnchain`. **`executor.ts` does not exist yet** (Phase 5), and no "execute arbitrary
calls" function was written (PHASES "Do not").
Nothing LLM-facing exists in this phase: `packages/reasoning` is still an empty stub, `check:arch`
forbids `wallet → reasoning`, and no AgentKit LLM adapter (`agentkit-langchain`,
`agentkit-vercel-ai-sdk`) is installed anywhere in the workspace (asserted by `secrets.test.ts`).

## Current phase plan (Phase 1)
- [x] 1.1 workspace+turbo+tsconfig/eslint/prettier/vitest
- [x] 1.2 root scripts
- [x] 1.3 dependency-cruiser + violation fixture
- [x] 1.4 packages/shared
- [x] 1.5 docker-compose + packages/db (all tables)
- [x] 1.6 constraints/indexes
- [x] 1.7 apps/web + apps/worker skeleton
- [x] 1.8 SIWE auth
- [x] 1.9 (Opus) audit log hash chain
- [x] 1.10 CI

## Phase 1 Exit Gate result (2026-09-20)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style" |
| `pnpm check:arch` | ✅ no dependency violations (53 modules, 63 dependencies cruised) |
| `pnpm test` | ✅ 7 files / 43 tests passed in 4.27 s (9 of them `packages/db/test/audit.test.ts`) |
| audit tamper test | ✅ `verifyChain` returns the exact tampered row id + `row_hash_mismatch` |
| fresh-DB migrations | ✅ `freshTestDb()` drops/creates `steward_test` and applies 0000+0001 on every DB test file; `pnpm db:migrate` also applied 0001 to the dev DB (both triggers present in `\dS+ audit_log`) |
| `pnpm dev` (web :3000 + worker health job) | ✅ verified in the 1.7/1.8 session; **not re-run** in the 1.9 session |

## Opus self-review — audit design vs I6/I7 (1.9)
- **I6 (append-only)** — DB-level `audit_log_no_mutation` trigger covers UPDATE, DELETE and (statement-level) TRUNCATE; `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC` added. Tested for all three. `appendAudit` is the only writer and computes the chain under a per-chain advisory lock, so parallel writers cannot fork it (50-way test: gapless ids, 50 distinct `prev_hash`).
- **I6 residual risks:** (a) a superuser/table owner can `ALTER TABLE … DISABLE TRIGGER` — exactly what the tamper test does; detection (not prevention) is the control, hence the hash chain. In production the app role must NOT own the table (see D-15). (b) **Tail truncation is undetectable by a pure hash chain** — see Known issues; `verifyChain` returns `head` so an external anchor is a one-line addition later. (c) `id` gaps are possible after a rolled-back transaction (bigserial), so `verifyChain` deliberately checks chain linkage only, not id contiguity.
- **I5 (fail closed)** — `appendAudit` never throws; every failure (secret in payload, DB error, empty insert) returns `Err` and the caller must abort. Nothing is written when a payload is refused (asserted in the test).
- **I7 (owner always wins)** — `packages/db/src/audit.ts` imports only `drizzle-orm` + `@steward/shared`; no reasoning/wallet/network imports, so freeze/revoke/sweep can audit with SERV or the worker down (`check:arch` green). **Open design note for Phase 8:** on owner paths, a failed audit write must not silently swallow the owner action — freeze must still apply and the failure must be surfaced/retried, otherwise a broken DB would let I5 override I7. Decide it explicitly in 8.1.
- **I12 / determinism** — payload is normalized through `canonicalJson` before insert (bigint → decimal string, Date → ISO), so the stored jsonb reads back identical to what was hashed; `created_at` is generated in app code (injectable clock) and hashed as the stored ISO value, so no JS/Postgres precision mismatch.
- Remaining nit: a payload containing a non-integer float could in principle be renormalized by jsonb; money is bigint (I12) so this cannot affect amounts. Not worth guarding today.

## Verification log (Phase 0)
| ID | Result | Evidence (link/file) | Date |
|---|---|---|---|
| V-01 | VERIFIED | `spikes/serv-smoke.ts`: chat.completions works at https://inference-api.openserv.ai/v1 with Bearer key. Quirks: `/models` is NOT OpenAI-shaped (`{items:[{modelId,...}]}` so `openai.models.list()` returns []); requests need a system/developer message. Docs: https://docs.openserv.ai/serv-reasoning/api/chat-completions | 2026-09-20 |
| V-02 | VERIFIED | `gpt-5.4-mini` works. Catalog also has serv-mini/nano/standard/swift/pro/ultra, gpt-5.4/5.5, claude-*, gemini-* (raw `GET /v1/models`) | 2026-09-20 |
| V-08 | VERIFIED | `response_format: json_schema` (strict) honored; returned `{"kind":"NOOP","reason":"smoke"}`. SERV request id `chatcmpl-EQEWzVgkVIRZVZjdbwp9ADCg1pbbe` (no x-request-id header; use body `id`) | 2026-09-20 |
| V-03 | VERIFIED | @coinbase/agentkit 0.10.4 `CdpSmartWalletProvider.configureWithWallet({apiKeyId,apiKeySecret,walletSecret,networkId,owner,smartAccountName,address,paymasterUrl,rpcUrl})`. Reload = pass `owner` + `smartAccountName` (or `address`). It cannot create a NAMED wallet: create via `cdp.evm.getOrCreateAccount({name})` + `getOrCreateSmartAccount({name,owner})` then pass `owner`. Spike wallet `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14` | 2026-09-20 |
| V-04 | VERIFIED | Gasless on base-sepolia with 0 ETH and no paymasterUrl set: 0-value self-transfer userOp `0xcf17df480a9d61122a19c476520e44d18e9d1452a8f60345ee7023598b162dd4` -> tx `0x7e84b2c28692f2c4b98062899137ab263e9863be8af9c5694e1d0649d94d0a4a`, status complete | 2026-09-20 |
| V-07 | VERIFIED (with caveat) | 14 real action names in `docs/agentkit-actions.json`. `MorphoActionProvider_deposit/withdraw` accept any `vaultAddress`, but take decimal-string whole units (float-ish, I12) and are Morpho-specific. See Decision D-2 | 2026-09-20 |
| V-05 | VERIFIED (CDP-owned treasury AND a real Coinbase Smart Wallet signing path; passkey popup UX untested) | Smart-Wallet run (`spikes/spend-permission-sw.ts`): wallet `0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C`; needs deploy via factory + `addOwnerAddress(manager)` first (the popup does this); approveWithSignature tx `0xa403d31bb0c3164106d0e1c3cc69f79e01b67cd1392636f38aa61c2c9906dd6c`, agent spend 1 USDC tx `0xb832ce0a2af4457bbbb3dff3191b23adb53eee15f8f5a86c4f2abe275981386c`. An ERC-6492 approve works while undeployed, but spend fails until the wallet is deployed and the manager is an owner. CDP-owned run:  `spikes/spend-permission-cdp.ts` on 84532: treasury smart acct `0x96E06701D4b606D27efE683fE5F46731E45008a4` (must be created with `enableSpendPermissions:true`, else API error "Smart account must have two owners") -> agent `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14`. createSpendPermission tx `0x4fc2d8f67aa47244cf85bd802dec929aadc0daeb73ff8684a7f082ff47871a84`; agent spend 1 USDC tx `0xe6d744046b6c3efc3e11b6e7ef0fb056adbd31e5ec7ff0f4a34c926f20e33bd0`; owner revoke tx `0x57caacd5d5f71499a8e3239f2af8745d23a0d0bff526f5542d197f073d13bc92`; then `isRevoked=true`, `isValid=false`, post-revoke spend reverted. Manager `0xf85210B21cC50302F477BA56686d2019dC9b67Ad`; ABI has approveWithSignature/spend/revoke/revokeAsSpender/getCurrentPeriod/isRevoked/isApproved/isValid; EIP-712 domain "Spend Permission Manager" v1. Faucet gives only 1 USDC per request to CDP accounts | 2026-09-20 |
| V-06 | VERIFIED | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on 84532: symbol USDC, 6 decimals; owner wallet holds 20 USDC from faucet | 2026-09-20 |
| V-13 | FALSE -> fallback | AgentKit Pyth action: `fetch_price_feed` HTTP 400, `fetch_price` 401 (Hermes `updates/price/latest` returns "unauthorized" without key). Fallback: MockPriceFeed in DEMO_MODE (chain 84532 only, I11); revisit Pyth with a keyed endpoint for mainnet | 2026-09-20 |
| V-14 | VERIFIED (docs) | wagmi `coinbaseWallet({ appName, preference: 'smartWalletOnly' })` https://wagmi.sh/core/api/connectors/coinbaseWallet ; `@coinbase/wallet-sdk` `createCoinbaseWalletSDK({preference:{options:'smartWalletOnly'}})` used in spike | 2026-09-20 |
| V-11 | VERIFIED (provider exists) | `x402ActionProvider` in AgentKit 0.10.4; supports base-sepolia; actions discover_x402_services, make_http_request, retry | 2026-09-20 |
| V-10 | VERIFIED (with a viem-built Coinbase Smart Wallet; passkey popup UX still untested) | `spikes/spend-permission-sw.ts`: viem `toCoinbaseSmartAccount` (owner = ephemeral local key) signed the SpendPermission. `publicClient.verifyTypedData` returned true for both the undeployed wallet (ERC-6492 wrapped) and the deployed wallet (ERC-1271, 450 hex chars vs 132 for an EOA). Human could not create a passkey wallet (keys.coinbase.com only offered email login to an old account); Coinbase Wallet extension / phone app are EOAs | 2026-09-20 |
| V-09 | NOT CONFIRMED -> fallback | PromptGuard / Shadow Agents / decision trails appear in OpenServ marketing/console (https://console.openserv.ai/, https://docs.openserv.ai/what-is-serv) but no API parameter or response field is documented in the chat-completions reference. Fallback: own screen + verifier (already designed); Phase 4.11 skipped | 2026-09-20 |
| V-12 | VERIFIED | https://www.openserv.ai/hackathon : AgentKit track; hackathon Sep 14-28 2026; submissions close **Sep 28 00:00 UTC**; submission = public X post tagging @openservai (name, concept, images, GitHub/demo links) + submission form; project must be new, functional, demonstrable; judged on creativity, user-readiness, revenue potential; human must enable data collection at console.openserv.ai/settings/organization (prompts shared with OpenServ -> keep secrets/PII out, NFR-5). No explicit OpenServ agent registration requirement found | 2026-09-20 |

## Decisions (ADR-lite)
| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| D-1 | 2026-09-20 | AgentKit fires an un-awaited telemetry POST (wallet address, network) to cca-lite.coinbase.com at wallet-provider init; a non-2xx becomes an unhandledRejection that crashes Node 22. Worker installs a process-level `unhandledRejection` logger; no opt-out flag exists in 0.10.4. Only public data is sent. | Crash found in spike | Patch package (rejected) |
| D-2 | 2026-09-20 | APPROVED by human 2026-09-20: vault deposit/withdraw built as exact-bigint encoded ERC-4626 calls via `walletProvider.sendTransaction` in `actionRegistry.ts`, not AgentKit Morpho actions | Morpho actions take decimal strings and are Morpho-specific; MockVault is plain ERC-4626; I12 | Morpho action for real Morpho vaults later |
| D-3 | 2026-09-20 | APPROVED by human 2026-09-20: `provisionAgentWallet` uses CDP client getOrCreate (named owner + named smart account keyed by userId), then passes `owner` into `CdpSmartWalletProvider` | Provider cannot create named wallets; idempotency | none |
| D-4 | 2026-09-20 | APPROVED by human 2026-09-20 (spec fix): SERV `models.list()` unusable; validate model via raw `GET /v1/models` (`items[].modelId`); system message required | V-01 finding | none |
| D-5 | 2026-09-20 | APPROVED by human 2026-09-20: a wallet that signs via plain ECDSA (EOA / Coinbase Wallet app) cannot grant spend permissions. Onboarding must require a Coinbase Smart Wallet (`smartWalletOnly`) and reject EOAs (detect via signature/1271 path or `getCode`+connector) | Found during V-05 live test | none |
| D-6 | 2026-09-20 | pnpm 11.25 used instead of pnpm 9 (`packageManager: pnpm@11.25.0`). pnpm 11 blocks dependency build scripts: approved only `esbuild` and `sharp` via `allowBuilds` in pnpm-workspace.yaml (pnpm 11 key; `onlyBuiltDependencies` is the pnpm 9/10 name) | Installed locally; spec version is stale | Install pnpm 9 |
| D-7 | 2026-09-20 | Deps added (Phase 1): turbo (task runner), typescript, vitest + fast-check (tests/property tests), eslint + typescript-eslint + @eslint/js (lint), prettier, dependency-cruiser (I1/I2/I3 boundaries), zod (boundaries), pino (redacting logs), viem (checksums, SIWE, chain client), @noble/hashes (sha256 canonical hash; policy-pure), drizzle-orm + drizzle-kit + pg (schema/migrations; pg over postgres.js for pg-boss/drizzle parity), pg-boss (queue, no extra infra), next + react + react-dom + tailwindcss + @tailwindcss/postcss + postcss (web skeleton), iron-session (session cookie), clsx + tailwind-merge (shadcn `cn` helper), tsx (run TS in worker/migrate), @types/* | Each per ARCHITECTURE §3 / PHASES 1.x | - |
| D-8 | 2026-09-20 | SIWE uses viem/siwe (parse/validate/nonce) + injected `publicClient.verifyMessage` verifier; the `siwe` npm package (ethers peer) is NOT added. Nonce lives in the iron-session cookie (5 min TTL, cleared on success), so no nonce table. Domain is taken from the request host, chainId must equal CHAIN_ID. Only EOA-tested (V-10 partial); D-5 EOA rejection NOT implemented (TODO in apps/web/lib/siwe.ts) | Fewer deps, no schema drift from DATA_MODEL | `siwe` package; DB nonce table |
| D-9 | 2026-09-20 | audit_log columns follow DATA_MODEL exactly (`id` bigserial, `prev_hash`, `row_hash`, `created_at`, ...); no separate `seq`/`hash` columns: `id` is the chain order. Trigger and writer are task 1.9 | Spec is source of truth | Add seq column |
| D-10 | 2026-09-20 | Local Postgres host port is 5433 (5432 taken by a local Postgres). DB tests use database `steward_test` on the same server, dropped/recreated per test file; they FAIL (never skip) if Postgres is unreachable | Port conflict; no silent passes | - |
| D-11 | 2026-09-20 | UUID PKs use gen_random_uuid() (v4); Postgres 16 has no native v7. Order by created_at | No extension needed | uuid-ossp / app-side v7 |
| D-12 | 2026-09-20 | env parsing: empty string treated as unset; SESSION_SECRET >= 32 chars; CHAIN_ID 8453 needs STEWARD_ALLOW_MAINNET (I8); DEMO_MODE only on 84532 (I11). Lookup that changed code: zod 4 `.default()` on a transformed enum takes the OUTPUT type (`.default(false)`) | I8/I11 fail-closed | - |
| D-13 | 2026-09-20 | Stray CLAUDE.md that appeared at repo root is git-ignored (`/CLAUDE.md`); docs/CLAUDE.md is canonical | Avoid duplicate manual | - |
| D-14 | 2026-09-20 | Audit rows with no `wallet_id` go on a single **system chain** (`wallet_id IS NULL`, advisory-lock key `'audit:system'`), as DATA_MODEL already states ("global chain for null wallet"). Rejected a sentinel UUID: it would need a fake `wallets` row or break the (deliberately absent) FK, and `IS NULL` indexes fine on `audit_log_wallet_id_idx`. `AUDIT_GENESIS_PREV_HASH` = `0x` + 64 zeros for every chain | One chain per wallet must stay independent so a wallet's chain can be verified/exported alone | Sentinel UUID; one global chain for everything (would serialize all wallets) |
| D-15 | 2026-09-20 | `row_hash` = sha256(canonicalJson of the **whole row content** — walletId, actor, event, entityType, entityId, payload, createdAt, prevHash) rather than SECURITY §7's `sha256(prev_hash ‖ canonical_json(payload))`: the §7 form leaves actor/event/entity/timestamp mutable without detection. Strict superset, same primitives (`hashCanonical`). Advisory lock uses the two-int form `pg_advisory_xact_lock(0x41554454, hashtext(chainKey))` so it can never collide with the Phase 6 per-wallet loop lock. DB role: the app role should hold only `INSERT, SELECT` on `audit_log` and must not own the table; only `REVOKE … FROM PUBLIC` is in the migration, because in dev/test the app role IS the owner and a GRANT-based setup would break `freshTestDb()` | §7 wording is weaker than I6 intends; docs conflict rule says choose the safer option and record it | Keep §7 exactly (rejected); add roles to the migration (rejected: breaks test setup) |
| D-16 | 2026-09-20 | `appendAudit` **refuses** (Err `SECRET_IN_PAYLOAD`) payloads whose keys match `private key / secret / mnemonic / seed phrase / passphrase / password / api key / signature / authorization / cookie` instead of scrubbing them; `token` is deliberately NOT in the pattern (USDC token fields are everywhere). Consequence for Phase 5+: log signature **hashes**, never signatures | Fail closed (I5) and fix the call site; a scrubbed row hides that a secret was nearly persisted | Scrub to `[REDACTED]` |

| D-17 | 2026-09-21 | `MAINNET_GATE_SIGNED_OFF = false` constant in `packages/wallet/src/chain.ts`: I8 needs BOTH `STEWARD_ALLOW_MAINNET=true` AND the Phase 9 gate, so mainnet is refused today even with the env var set. Flipping it is a deliberate one-line code change belonging to the Phase 9 sign-off commit | An env var alone is one typo away from mainnet | Env-var-only guard (rejected) |
| D-18 | 2026-09-21 | The SpendPermissionManager ABI is **hand-vendored** into `packages/wallet/src/abi.ts` (only the 9 functions we call), because `@coinbase/cdp-sdk` does not export it publicly and the spikes had to reach into `_cjs/spend-permissions/constants.js`. `test/abi.test.ts` compares every vendored fragment against the SDK's copy, so an upstream change breaks the build instead of producing wrong calldata | Reaching into package internals from product code breaks on any patch release | Import the internal path (rejected); fetch the ABI on-chain (overkill) |
| D-19 | 2026-09-21 | Deps added (Phase 2): `@coinbase/agentkit` + `@coinbase/cdp-sdk` (required by the track; provisioning and user operations), `drizzle-orm`/`pg` in wallet (wallet rows + audit), `tsx`/`viem`/`cdp-sdk` at the root (live scripts), Foundry libs `openzeppelin-contracts@v5.5.0` and `forge-std@v1.11.0` as pinned git submodules. AgentKit's transitive native build scripts (`keccak`, `secp256k1`, `bufferutil`, `utf-8-validate`, `bigint-buffer`, `@coinbase/x402`, `opensea-js`, `@opensea/seaport-js`) are explicitly **not** run (`allowBuilds: <name>: false`) — all are optional accelerations with pure-JS fallbacks, so less arbitrary code runs at install time. The live flow works on the fallbacks (runs print `bigint: Failed to load bindings, pure JS will be used`) | Each per PHASES 2.x | Approving the build scripts (rejected: unnecessary native code) |
| D-20 | 2026-09-21 | Contracts deploy through the **canonical CREATE2 proxy** `0x4e59b448…4956C`, not as raw creation transactions. Lookup that changed code: CDP's `sendTransaction` rejects a contract-creation tx with `malformed_transaction` / "Malformed unsigned EIP-1559 transaction" in **both** accepted forms (the `TransactionRequestEIP1559` object, which requires `to`, and a self-serialized RLP payload). A proxy call is an ordinary `to`-bearing transaction, so CDP signs it, no private key is ever created locally, addresses are deterministic and redeploys are no-ops | 2.1 requires deploying with no private key on disk | Local key + `forge create` (rejected: holds a key); `cast` with a keystore (same problem) |
| D-21 | 2026-09-21 | `SYSTEM_CEILINGS` now lives in `packages/shared/src/ceilings.ts` with the POLICY_ENGINE §5 values **plus** four spend-permission bounds (allowance ≤ 1,000,000 USDC per period, period 1 h – 30 d, horizon ≤ 365 d, 300 s clock skew). **Phase 3 owns the final list** and `validatePolicyDraft`; it may tighten these, and must record a decision to loosen any of them | 2.7 needs ceilings before Phase 3 exists | Hardcode them in the route (rejected: untestable, duplicated) |
| D-22 | 2026-09-21 | `sweep_home` transfers `agentUsdcBalance + Σ redeemableAssets` read just before building. If the share price **falls** between read and execution the transfer reverts and the sweep fails loudly (never a partial or wrong send); if it **rises**, a few base units of dust stay in the agent wallet. Phase 5 may re-read and retry | Fail closed beats sending an amount we cannot back | Sweep in two transactions (rejected for MVP: two receipts, more failure modes) |

| D-23 | 2026-09-21 | **`packages/shared/src/ceilings.ts` is the single source of truth for every ceiling.** Phase 3 kept all eight POLICY_ENGINE §5 values and all five spend-permission bounds Phase 2 added (D-21) **unchanged — nothing was loosened** — and added three risk-parameter bounds (`MAX_DEPEG_THRESHOLD_BPS` 500, `MAX_VAULT_DRAWDOWN_BPS` 2000, `MIN_RISK_THRESHOLD_BPS` 1). `packages/policy` (validator + R06/R07/R14/R19) and `packages/wallet` (`validateSpendPermission`) both read that one file; neither re-declares a limit. It stays in `shared` rather than moving to `policy` because `wallet` must not import `policy` (check:arch) | One list, one place; wallet needed a subset before policy existed | Duplicate the numbers in each package (rejected: they would drift) |
| D-24 | 2026-09-21 | `validatePolicyDraft` returns `Result<PolicyDraft, PolicyIssue[]>`, not `Result<Policy, …>` as POLICY_ENGINE §1 writes it: a *draft* is by definition unsigned, so `version`, `walletId`, `createdAt`, `signedBy` and `signature` are optional in `zPolicyDraft` and required in `zPolicy`. `evaluate()` only ever accepts a full, signed `Policy` | Templates and `compileMandate` (Phase 4) must produce something validatable before anyone signs it; a placeholder signature in a template would be a lie | Fake signature fields in templates (rejected) |
| D-25 | 2026-09-21 | **`hashProposal` hashes the action, not the prose**: `{kind, params, expectedDeltas, source}`, deliberately excluding `rationale`, `citedFactIds` and `confidence`. Otherwise an attacker replays an identical transfer past R17 by rewording the rationale. `expectedDeltas` is included because it is the only thing that distinguishes two `sweep_home` proposals (which carry no params) | R17/I10 are only as strong as what the hash covers | Hash the whole proposal (rejected: R17 becomes trivially bypassable) |
| D-26 | 2026-09-21 | **R02 exempts only `noop` and `sweep_home`** (the latter is already hard-gated to `source='owner'` by R03). An owner-sourced *payment* still needs to be an autonomous kind or get an approval. Spec is silent; this is the safer reading and it bounds RR-3 (a forged `source='owner'` escalates instead of executing) | SECURITY > POLICY_ENGINE conflict rule: choose the safer option | Exempt every `source='owner'` proposal (rejected) |
| D-27 | 2026-09-21 | **`AllowReceipt` carries an optional `callsHash`**, and `verifyReceipt` takes an expectation object (`{proposalHash, policyVersion?, walletId?, callsHash?}`) instead of a bare hash. POLICY_ENGINE §7 lists neither, but a `sweep_home` proposal hashes the same whatever the balances were when the calls were built, so without binding the calls a receipt for one sweep authorises another. Phase 5's executor must pass `callsHash` | The receipt is the executor's only gate; bind it to the exact bytes | Bare-hash signature (rejected: leaves the sweep hole) |
| D-28 | 2026-09-21 | `EvaluationInput` gains four fields POLICY_ENGINE §4 does not list: `chainId` and `allowMainnet` (R21 explicitly requires the flag), `demoStableParity` (I11 fallback, fenced to 84532), and `simulation.approvals` (R18 cannot check approvals it cannot see; the risk gate extracts them from the calls it simulated). `Verdict` gains `walletId` (a receipt needs it and the verdict is what gets signed) and `RuleResult` gains `lifted` (audit trail for owner approvals) | Each is required by a rule the spec mandates | Infer them from context (rejected: guessing is not fail-closed) |
| D-29 | 2026-09-21 | **R12's depeg check applies to every kind sized from the price**, not just inflows: `pull_allowance`, `vault_deposit`, `vault_withdraw`, `pay_recipient`. Only `risk_exit`, `sweep_home` and `noop` are exempt (they are the *response* to a depeg and move whole positions, not price-sized amounts). Found by adversarial case A11: at a 1 micro-USD quote, 50,000 USDC reads as $0.05 and passes every cap | Every limit is in micro-USD, so a broken quote is a broken limit | Spec-literal "inflows only" (rejected: leaves the hole) |
| D-30 | 2026-09-21 | **R09 counts only allowlisted vault positions** towards managed funds (`policy.vaults` drives the sum, not `Object.values(state.vaultPositions)`), so a phantom entry cannot inflate the denominator. All bps maths is `position * 10_000 > bps * managed` in bigint — no division, no rounding window (I12) | Adversarial case A13 | Sum the whole state map (rejected) |
| D-31 | 2026-09-21 | The size rules share one `valueInput(input)` valuation (amount, liquid, managed, per-vault position) computed from a **single** price lookup. Previously each rule converted separately, which produced branches like "the amount converted but the balance did not" that cannot happen and cannot be tested — and 100% branch coverage is a gate, so untestable code is a defect, not a safety margin | One failure mode, all of it tested | Per-rule conversions with `/* v8 ignore */` (rejected: ignoring coverage hides real gaps) |
| D-32 | 2026-09-21 | Dep added: `@vitest/coverage-v8` (dev, root) — the only way to enforce TESTING.md's 100%-branch gate for `packages/policy`; thresholds live in `packages/policy/vitest.config.ts` and **fail** the run. `pnpm test` now runs the normal suite and then that coverage run. Also: `pnpm check:arch` now additionally runs both deliberate-violation fixtures (imports **and** purity lint), so the enforcement itself is checked on every gate | The engine is the security core; an unexercised rule path is an unknown rule path | Report coverage without thresholds (rejected: advisory gates are not gates) |

## Known issues / risks
### Phase 3
- **The engine cannot verify a signature** (RR-1). `ownerApproval` is trusted to have been verified by
  the caller; Phase 6.4 must do that before calling `evaluate`, and Phase 7.6 owns the signing UX.
- **`proposal.source` is data** (RR-3). Phases 4/6 must set it in code — never from model output.
- **`simulation.approvals` must actually be populated** by Phase 5's risk gate from the `Call[]` it
  simulated, otherwise R18 sees an empty list and passes. The rule is correct; the plumbing is a
  Phase 5 obligation, and `buildCalls` already emits exactly one exact-amount approve per deposit.
- **R11 needs a simulation for every non-`noop` kind** (`simulation: null` ⇒ DENY). The decision loop
  must simulate before evaluating, including for deterministic and owner-sourced proposals.
- **`evaluate` does not run `validatePolicyDraft`** on the policy it is handed; it assumes the stored
  policy was validated at activation. The rules independently re-check the *system* ceilings (T16), so
  a bad stored policy cannot raise a limit, but it could still be internally inconsistent.
- `packages/wallet`'s `GET /api/wallet` still reads its vault position from `MOCK_VAULT_ADDRESS` in
  env (carried from Phase 2). Phase 4+ should read the vault list from the active Policy.
- The `x402` block in `Policy` is parsed but no rule reads it yet (X01–X03 are the Phase 8.8 stretch).
- Rolling-window inputs (`outflowsLast24hMicroUsd`, `actionsLastHour`, `recentProposalHashes`) are
  supplied by the caller; their correctness is a Phase 5/6 DB concern. R07/R14/R17 are only as good as
  those numbers, and the ledger query must use the same 24h/1h windows the rules assume.

### Phase 2
- **RPC read-after-write lag is real and bites.** The load-balanced Base Sepolia endpoint answered `getCode` / `isOwnerAddress` / `isRevoked` from a node a block behind, three separate times. Once it was not cosmetic: `addOwnerAddress` was gas-estimated against a node that still saw an EOA (~22,414 gas) and the transaction **reverted out of gas while still producing a receipt**. `scripts/live/lib.ts` now has `waitForCode` and `confirm` (which throws on a reverted receipt), and every post-write read in the live script is polled. **Phase 5's confirmer must assume the same**: a receipt is not success, and one read is not state.
- **D-5's EOA rejection is a heuristic, by design.** It proves "smart contract account" (`verifyTypedData` via ERC-1271/6492 plus code present, or a 6492-wrapped signature when counterfactual), not "Coinbase Smart Wallet". Another ERC-1271 wallet passes and would fail later at `spend` — loudly and at zero cost, since the agent pulls nothing. An EIP-7702-delegated EOA has code and passes, which is the correct answer rather than a hole. Documented in the function's docblock.
- **A spend only works if the owner wallet has the SpendPermissionManager in its owner set.** `approveWithSignature` succeeds without it and `spend` then reverts with `Unauthorized()` (`0x82b42900`). The passkey popup does this for real users; the live script does it explicitly and verifies `isOwnerAddress`. Phase 7.6 must confirm the popup path and surface this as a distinct failure in the UI.
- `GET /api/wallet` reads its vault position from `MOCK_VAULT_ADDRESS` in env. **Phase 3 must replace that with the vault list from the active Policy.**
- Basescan source verification of the two mocks was not performed (optional in 2.1); the on-chain property checks stand in for it.
- The fork suite is **opt-in** (`STEWARD_FORK=1`) so `pnpm test` reports it as 1 file / 4 tests skipped. It was run and passed 4/4 for this gate.
- No unit test covers `buildAgentKit` itself (it needs live CDP credentials); the live script exercises the same provisioning path, and `assertActionsExist` is unit-tested.
- `simulateYield` needs the demo admin to hold USDC and to have approved MockVault; `simulateLoss` sends the slice back to the admin, so it can be re-donated. Phase 9's demo scripts must fund the admin from the faucet first.

### Audit log (1.9) limitations
- **Tail truncation is undetectable.** Deleting the last N rows of a chain (with the trigger disabled by a superuser) leaves a chain that still verifies. Mitigation, deferred: `verifyChain` already returns `head` (last `row_hash`) and `rows`; periodically persist `(walletId, rows, head, at)` somewhere the app role cannot rewrite — an anchor row in a separate table owned by another role, a notification/Telegram message, or on-chain — and compare on verify. Cheapest version belongs with `/api/audit/verify` in Phase 8.4.
- **The trigger only stops the app role, not the DB owner/superuser.** `ALTER TABLE audit_log DISABLE TRIGGER` defeats it (that is exactly how the tamper test works); the hash chain is the detection layer. Production setup (not applied in the migration because dev/test run as the owner): create a separate owner role, and `GRANT INSERT, SELECT ON audit_log TO <app_role>` only — no UPDATE/DELETE/TRUNCATE, no ownership.
- No retention/rotation and no pagination in `verifyChain` (whole chain is loaded); fine at hackathon volume.
- A failed audit write currently aborts the caller (I5). Phase 8.1 must decide the owner-path exception so a DB problem cannot block freeze/revoke/sweep (I7).
- SIWE only tested with EOAs; ERC-1271/6492 path via publicClient.verifyMessage untested with a real Smart Wallet (V-10 partial, D-5 open).
- `pnpm dev` runs `docker compose up -d --wait` then migrates; needs Docker Desktop running. First `docker pull postgres:16` was flaky (EOF), retried OK.
- CI workflow (.github/workflows/ci.yml) written but not run remotely.
- shadcn/ui: minimal init only (components.json, lib/utils.ts, empty components/ui); no components generated yet.
- Local pnpm is 11.25 (spec says 9); Node 22.13.1, Docker 29.6.2, Foundry 1.5.1 present.
- Repo root contains duplicate copies of the spec .md files, `steward-claude-code-specs/` and the .zip; `docs/` is canonical. Zip and unpacked folder are git-ignored; root duplicates left untouched pending human OK to delete.
- No `.env.local` present yet; credentials needed for spikes.

## Next step
- **Phase 3 is complete; waiting for the human to say "continue". Phase 4 (SERV reasoning & injection
  defenses) requires Opus (`/model opus`).**
- Do not start Phase 4 before that.

### Public API of `packages/policy` (what Phases 4–6 call)
```ts
// evaluation
evaluate(input: EvaluationInput): Verdict                      // never throws, never defaults to ALLOW
runRules(input: ParsedEvaluationInput, rules?): RuleResult[]    // exported for testing the catalogue
RULES: readonly Rule[]                                          // R00..R21, static order
APPROVAL_LIFTABLE: readonly RuleCode[]                          // R02,R08,R09,R10,R15,R16,R19,R20

// hashing + receipts
hashProposal(p: Proposal): Hex                                  // sha256 of {kind,params,expectedDeltas,source}
hashProposalSafe(p: unknown): Hex                               // never throws; ZERO_HASH on garbage
signReceipt(v: Verdict, key: Uint8Array, now: Date, nonce: string,
            opts?: { callsHash?: Hex; ttlSeconds?: number }): Result<AllowReceipt, ReceiptError>
verifyReceipt(r: unknown, expected: ReceiptExpectation, key: Uint8Array, now: Date): Result<true, ReceiptError>
type ReceiptExpectation = { proposalHash: Hex; policyVersion?: number; walletId?: string; callsHash?: Hex }
constantTimeEqual(a: string, b: string): boolean

// mandate
validatePolicyDraft(draft: unknown, ceilings?: SystemCeilings): Result<PolicyDraft, PolicyIssue[]>
type PolicyIssue = { path: string; code: PolicyIssueCode; message: string; suggestion: string }
MANDATE_TEMPLATES / MANDATE_TEMPLATE_NAMES                      // 'startup' | 'dao' | 'creator'
policyDraftFromTemplate(name, binding: TemplateBinding): Result<PolicyDraft, PolicyIssue[]>

// explanation (UI + Phase 4's explain fallback)
renderPolicyAsSentences(p: PolicyDraft): string[]
ruleSentences: Record<RuleCode, string>
explainVerdict(v: Verdict): string

// money (bigint only)
valueInput(input): Result<Valuation, string>                    // amount/liquid/managed/position in micro-USD
baseUnitsToMicroUsd(amount, decimals, quote) / microUsdToBaseUnits(micro, decimals, quote)
proposalAmountBaseUnits(p) / priceOf(input, token) / depegBps(quote) / quoteAgeSeconds(quote, now)
usdcToken(policy) / byAddress(record, address) / ONE_USD_MICRO
```
New in `@steward/shared`: `zPolicyDraft`/`PolicyDraft`, `zEvaluationInput`/`EvaluationInput`,
`zDelta`, `zPriceQuote`, `zRiskTrigger`, `zSimulatedApproval`, `RULE_CODES`/`RuleCode`, `zSignedAmount`,
`Hex`, and three new ceilings (D-23). `Verdict` now carries `walletId`; `RuleResult` carries `lifted`;
`AllowReceipt` carries an optional `callsHash` (D-27).

### Interfaces Phase 3+ builds on (exported from `@steward/wallet`)
```ts
// action registry (pure) — the single source of calls for both simulation and execution
buildCalls(proposal: Proposal, policy: Policy, ctx: BuildContext): Result<Call[], BuildError>
allowedTargets(policy: Policy, ctx: BuildContext): Set<Address>
callsHash(calls: readonly Call[]): Hex
type Call = { to: Address; data: Hex; value: bigint }        // value is always 0n
type BuildContext = { agentWalletAddress; spendPermissionManagerAddress; spendPermission?;
                      agentUsdcBalance: bigint; vaultPositions: Record<string, VaultPosition>;
                      allowMainnet: boolean }
type VaultPosition = { shares: bigint; redeemableAssets: bigint }
type BuildErrorCode = 'CHAIN_REFUSED' | 'UNKNOWN_KIND' | 'UNKNOWN_VAULT' | 'UNKNOWN_RECIPIENT'
                    | 'UNKNOWN_TOKEN' | 'MISSING_PERMISSION' | 'PERMISSION_MISMATCH'
                    | 'INVALID_AMOUNT' | 'NOTHING_TO_DO' | 'DISALLOWED_TARGET'

// provisioning
provisionAgentWallet(deps: ProvisionDeps, userId): Promise<Result<ProvisionResult, ProvisionError>>
cdpAccountNames(userId): Result<{ owner: string; smartAccount: string }>

// spend permissions — pure
buildSpendPermission(input): SpendPermission
prepareTypedData(p, chainId, manager): SpendPermissionTypedData
spendPermissionHash(p, chainId, manager): Hex                // == manager.getHash(p), no RPC
validateSpendPermission(p, constraints): Result<SpendPermission, SpendPermissionIssue[]>
serializeSpendPermission(p) / parseSpendPermission(unknown): Result<SpendPermission>
buildSpendCall(p, amount, manager): Result<Call>
encodeSpend / encodeApproveWithSignature / encodeRevoke / encodeRevokeAsSpender

// spend permissions — I/O
assertSmartWalletAccount(pc, { typedData, signature }): Promise<Result<OwnerAccountKind>>   // D-5
readAllowanceRemaining(pc, manager, p): Promise<Result<bigint>>        // F_ALLOWANCE_REMAINING
readCurrentPeriod / isRevoked / isApproved / isValid
ensureApprovedOnchain({ publicClient, sender: TxSender, manager, permission, signature })   // BROADCASTS

// read models
getBalances(pc, { usdc, treasuryAddress, agentWalletAddress }): Promise<Result<Balances>>
getVaultPosition(pc, { vault, holder }): Promise<Result<{ shares, assets, redeemableAssets }>>
getSharePrice(pc, vault): Promise<Result<{ sharePrice, shareDecimals, totalAssets }>>
getMockPrice(pc, feed): Promise<Result<{ microUsd, updatedAt }>>       // DEMO_MODE only (I11)
maxAtRisk({ agentUsdc, vaultAssets, allowanceRemaining }): bigint

// chain / I8
assertChainAllowed({ chainId, allowMainnet }): Result<number>
MAINNET_GATE_SIGNED_OFF: false          // flip only in the Phase 9 sign-off commit

// AgentKit
buildAgentKit(input): Promise<Result<AgentKitBundle>>   // never hand the bundle to an LLM (I3)
installUnhandledRejectionLogger(): void                  // D-1; call in every wallet-using process
```
Also new in `@steward/shared`: `SYSTEM_CEILINGS` (D-21).
New in `@steward/db`: `getActiveSpendPermission`, `listSpendPermissions`, `insertSpendPermission`,
`markSpendPermissionApproved`, `markSpendPermissionRevoked`.
Phase 5's `executor.ts` will be the **only** module allowed to send proposal calls; it must re-check
`callsHash` against what the RiskGate simulated.
- Audit writer API for later phases: `appendAudit(db, { walletId?, actor, event, entityType?, entityId?, payload, createdAt? }) => Promise<Result<AuditRow, AuditError>>` and `verifyChain(db, walletId | null) => Promise<Result<{rows, head}, {rowId, reason, expected, actual}>>`, exported from `@steward/db`. Never insert into `audit_log` directly. Payload must contain no secret-looking keys (D-16).
- Hackathon deadline Sep 28 00:00 UTC (8 days): keep MUST scope tight.
