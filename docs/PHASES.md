# PHASES — Steward build plan (Phase 0 → 9)

This is the **only** build plan. Complete phases strictly in order. Each phase ends with an
**Exit Gate**; do not start the next phase until the gate passes and the human says "continue".

## Model assignment

| Phase | Title | Model | Why |
|---|---|---|---|
| 0 | Verification spike & repo bootstrap | **Sonnet** | Research/scaffolding; nothing touches funds |
| 1 | Monorepo foundation, DB, auth | **Sonnet** (Opus sub-task 1.9) | Boilerplate; audit hash chain is critical |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | **Opus** | Key handling, custody, on-chain authority |
| 3 | Policy Engine & mandate validator | **Opus** | The security core |
| 4 | SERV reasoning & injection defenses | **Opus** | LLM trust boundary |
| 5 | Risk gate, executor, confirmer | **Opus** | Sends transactions; idempotency |
| 6 | Decision loop, scheduler, obligations, risk exits | **Opus** | Orchestrates money movement end to end |
| 7 | Web app UX | **Sonnet** (Opus sub-tasks 7.6, 7.8) | UI; signing flows are critical |
| 8 | Owner controls, notifications, hardening, security review | **Opus** (Sonnet sub-tasks 8.5, 8.6) | Freeze/recovery + red-team review |
| 9 | Demo, deployment, docs, submission | **Sonnet** (Opus gate 9.8) | Scripts/docs; final release review is critical |

How to switch in Claude Code: `/model opus` or `/model sonnet`. If the active model doesn't match,
stop and ask the human to switch (see `CLAUDE.md` §4).

Legend: **[MUST]** required for gate · **[SHOULD]** do if time allows within the phase · **[FUTURE]** don't build now.

---

## Phase 0 — Verification spike & repo bootstrap
**Model:** Sonnet · **Read first:** `CLAUDE.md`, `PRD.md`, `ARCHITECTURE.md`, `VERIFY.md`

### Goal
Turn every external assumption into a verified fact (or a chosen fallback) before writing product
code, and create an empty but runnable repository.

### Prerequisites (human provides)
CDP API key + wallet secret, SERV API key, a Base Sepolia RPC URL, a Coinbase Smart Wallet for testing,
Node 22, pnpm 9, Docker, Foundry.

### Tasks
0.1 [MUST] `git init`; add `.gitignore` (node, .env*, .next, out, broadcast, cache), `.nvmrc` (22), `README.md` stub.
0.2 [MUST] Create `/spikes` folder (throwaway, excluded from build). Write one script per VERIFY item:
   - `spikes/serv-smoke.ts` — V-01, V-02, V-08: call SERV with `openai` SDK, list models, test json_schema.
   - `spikes/agentkit-smoke.ts` — V-03, V-04, V-07: create `CdpSmartWalletProvider` on base-sepolia, print
     address, dump `agentkit.getActions()` names + schemas to `docs/agentkit-actions.json`, send a 0-value
     or tiny tx to test gas sponsorship.
   - `spikes/spend-permission-smoke.ts` — V-05: locate manager address + ABI; build a permission object;
     (manual step with human) sign with test smart wallet; call approveWithSignature + spend 1 USDC; revoke.
   - `spikes/usdc-and-price.ts` — V-06, V-13: read USDC decimals/balance; try Pyth action for USDC/USD.
   - `spikes/verify-sig.ts` — V-10: verify a smart-wallet signed message with viem.
   - Read-only research for V-09, V-11, V-12, V-14 (docs), summarize with links.
0.3 [MUST] Record every result in `PROGRESS.md` → Verification log (VERIFIED / FALSE → fallback chosen).
0.4 [MUST] If any fallback weakens a security layer (esp. V-05), stop and ask the human before continuing.
0.5 [MUST] Write `docs/agentkit-actions.json` (real action names) and `docs/addresses.md` (verified addresses with source links).
0.6 [SHOULD] Note any spec changes required by verified reality as proposed Decisions (don't edit specs silently; list diffs for human approval).

### Deliverables
Spike scripts, `docs/agentkit-actions.json`, `docs/addresses.md`, filled Verification log.

### Exit Gate
- All V-01…V-14 have a status; every FALSE has a fallback or a human decision.
- A real AgentKit smart wallet exists on Base Sepolia and executed at least one tx (hash recorded).
- A real SERV call succeeded (request id recorded).
- Spend permission spend + revoke demonstrated once (or fallback approved by human).

### Do not
Build product code. Commit any secret. Use mainnet.

---

## Phase 1 — Monorepo foundation, database, auth
**Model:** Sonnet (sub-task 1.9 **Opus**) · **Read first:** `ARCHITECTURE.md` §2–3, §6, `DATA_MODEL.md`, `API.md` (Auth), `TESTING.md`

### Goal
A typed, linted, tested monorepo with Postgres schema, append-only audit log, env validation, and SIWE login.

### Tasks
1.1 [MUST] pnpm workspace + turbo; packages/apps exactly as `ARCHITECTURE.md` §2. Shared `tsconfig.base.json`
    (`strict`, `noUncheckedIndexedAccess`), eslint (typescript-eslint strict), prettier, vitest workspace config.
1.2 [MUST] Root scripts from `CLAUDE.md` §6 (stubs allowed for later-phase scripts, printing "not yet implemented" and exiting 0 only for scripts owned by future phases).
1.3 [MUST] `.dependency-cruiser.cjs` implementing the import-boundary table (ARCHITECTURE §2); `pnpm check:arch`
    fails on violation. Add a deliberate-violation test fixture proving it fails.
1.4 [MUST] `packages/shared`: `env.ts` (zod; `Secret` wrapper with redacted toString/toJSON), `result.ts`,
    `money.ts` (bigint parse/format for 6-decimals, micro-USD conversion; no floats), `canonical.ts`
    (canonical JSON + sha256), `address.ts` (checksum/equals), `schemas/` (Policy, Proposal, Verdict, AllowReceipt stubs per POLICY_ENGINE.md), logger (pino with redaction paths from SECURITY §6).
1.5 [MUST] `docker-compose.yml` (postgres:16) and `packages/db` with Drizzle schema for **all** tables in
    `DATA_MODEL.md`, migrations, and typed repositories (thin).
1.6 [MUST] Constraints/indexes from DATA_MODEL "Key constraints".
1.7 [MUST] `apps/web` Next.js 15 skeleton (Tailwind, shadcn/ui init), `apps/worker` skeleton with pg-boss boot and a `health` job.
1.8 [MUST] SIWE auth routes (`/api/auth/nonce|verify|logout`, `/api/me`) with iron-session; signature verification via the V-10 method; creates `users` row.
1.9 [MUST] **(Opus)** Audit log: trigger blocking UPDATE/DELETE; `audit.ts` writer with per-wallet advisory lock and hash chain; `verifyChain(walletId)`; tests for tamper detection and concurrent writes.
1.10 [SHOULD] CI workflow (GitHub Actions): install, typecheck, lint, check:arch, test, gitleaks.

### Tests
money/canonical property tests; env validation; migrations up on fresh DB; audit trigger rejects UPDATE/DELETE; chain verify detects modified payload; SIWE happy path + bad signature + expired nonce.

### Exit Gate
`pnpm typecheck && pnpm lint && pnpm check:arch && pnpm test` green; `pnpm dev` serves web on :3000 and worker logs health job; audit tamper test passes.

### Do not
Implement policy/reasoning/wallet logic. Use `number` for money.

---

## Phase 2 — Wallet layer: AgentKit, spend permissions, test contracts
**Model:** **Opus** · **Read first:** `AGENTKIT_INTEGRATION.md`, `SECURITY.md` §3 L1–L2, `docs/agentkit-actions.json`, `docs/addresses.md`

### Goal
Provision per-owner agent wallets via AgentKit, support the owner-granted Spend Permission lifecycle,
and deploy the testnet contracts needed for the demo. No autonomous decisions yet.

### Tasks
2.1 [MUST] `contracts/` Foundry project: `MockVault.sol` (OpenZeppelin ERC4626 over USDC; owner-only
    `simulateYield(uint256)` and `simulateLoss(uint256 bps)` to move share price), `MockPriceFeed.sol`
    (owner-set price + timestamp), `MockUSDC.sol` (only if V-06 fallback). Foundry tests incl. share-price math,
    loss simulation, access control. Deploy script to Base Sepolia; record addresses in `docs/addresses.md`.
2.2 [MUST] `packages/wallet/src/agentkit.ts`: `buildAgentKit(walletRef?)` per AGENTKIT §2; startup assertion
    that every action name used exists; network guard (I8: refuse 8453 unless allowed).
2.3 [MUST] `provisionAgentWallet(userId)`: idempotent; stores `agent_wallet_address` + `agent_wallet_ref`; audit `WALLET_PROVISIONED`.
2.4 [MUST] `packages/wallet/src/spendPermission.ts`: build permission struct, `prepareTypedData` for the owner,
    store signed permission, `ensureApprovedOnchain` (approveWithSignature on first use, idempotent),
    `readAllowanceRemaining`, `isRevoked`, `buildSpendCall(amount)`. Pure encoders separated from I/O.
2.5 [MUST] `packages/wallet/src/actionRegistry.ts`: `buildCalls` for every ProposalKind per AGENTKIT §3
    (IDs → addresses resolved **only** from Policy), exact-amount approvals, and `callsHash`. No execution yet.
2.6 [MUST] Read models: `getBalances(walletId)` (treasury USDC, agent USDC), `getVaultPosition` (convertToAssets of shares), `getSharePrice`.
2.7 [MUST] API: `/api/wallet/provision`, `/api/wallet`, `/api/spend-permission/prepare`, `/api/spend-permission` (GET/POST).
2.8 [SHOULD] Anvil fork integration test harness (`test/fork/`) with helper to fund accounts and deploy mocks locally.

### Tests
Foundry suite; registry unit tests (each kind → expected calldata; unknown IDs → error; approvals exact); spend permission encoder tests against ABI; fork test: provision (mocked CDP) → build calls → simulate on fork succeeds.

### Opus review gate (record in PROGRESS)
- Can any code path produce a call to an address not from Policy/treasury/vault/USDC/SpendPermissionManager? (must be no)
- Are approvals ever > exact amount? Any `maxUint256`? (must be no)
- Are CDP secrets ever logged/serialized? (grep + test)
- Mainnet guard tested?

### Exit Gate
Standard bundle + `pnpm contracts:test`; contracts deployed on Base Sepolia (addresses verified on explorer);
live: provision a wallet, owner signs permission, worker pulls 1 USDC via `spend` (manual script), revoke works.

### Do not
Add an execute function that sends arbitrary calls. Give AgentKit to any LLM framework.

---

## Phase 3 — Policy Engine & mandate validator
**Model:** **Opus** · **Read first:** `POLICY_ENGINE.md` (all), `SECURITY.md` §3 L3, §5

### Goal
Implement the pure, fully tested Policy Engine and receipts — the component that makes the product trustworthy.

### Tasks
3.1 [MUST] Finalize zod schemas for Policy, Proposal (discriminated by kind), EvaluationInput, Verdict, AllowReceipt in `packages/shared`.
3.2 [MUST] `SystemCeilings` constants (§5) and `validatePolicyDraft` returning structured `PolicyIssue[]` (path, code, message, suggestion).
3.3 [MUST] Implement rules R00–R21 as individual pure functions `(input) => RuleResult` in `packages/policy/src/rules/Rxx.ts`, registered in a static ordered array. All rules always evaluated.
3.4 [MUST] `evaluate()` combining results with precedence and owner-approval lifting exactly per the table.
3.5 [MUST] Unit conversion helpers: token base units ↔ micro-USD using the input price map (stables at oracle price, never assumed 1.0 unless DEMO fallback explicitly passed).
3.6 [MUST] `hashProposal`, `signReceipt`, `verifyReceipt` (HMAC-SHA256 via @noble/hashes, constant-time compare).
3.7 [MUST] `renderPolicyAsSentences(policy)` and `ruleSentences` table (code → human sentence, used by UI & explainer).
3.8 [MUST] Mandate templates (`startup`, `dao`, `creator`) as Policy draft presets (JSON) with demo values from `DEMO.md`.
3.9 [SHOULD] `explainVerdict(verdict)` deterministic fallback text.

### Tests
Per-rule positive/negative; property tests P1–P6; golden demo verdicts table from `DEMO.md`; 100% branch coverage enforced in vitest config for `packages/policy`; `check:arch` proves no forbidden imports.

### Opus review gate
Walk every rule against SECURITY threat table T1–T17 and list which rule(s) mitigate each. Any threat relying solely on the LLM → add/adjust a rule. Record matrix in PROGRESS.

### Exit Gate
Standard bundle; coverage 100% branches for `packages/policy`; review matrix recorded.

### Do not
Import anything but `shared` and `@noble/hashes`. Read the clock or env inside the engine.

---

## Phase 4 — SERV reasoning & injection defenses
**Model:** **Opus** · **Read first:** `SERV_REASONING.md` (all), `SECURITY.md` §3 L5, `TESTING.md` (adversarial)

### Goal
All reasoning tasks implemented behind a `ServClient` interface, schema-forced, grounded, fenced, and red-teamed.

### Tasks
4.1 [MUST] `ServClient` interface + `LiveServClient` (openai SDK, baseURL, timeouts, retry policy, usage logging) + `FixtureServClient`.
4.2 [MUST] `packages/context`: `ContextBuilder` producing facts with stable IDs, `snapshotHash`, policy sentences, allowed kinds, ID-only vaults/recipients; `untrusted` items sanitized (strip control/zero-width, NFKC normalize, truncate 500, fenced).
4.3 [MUST] Prompt files `prompts/{compiler,proposer,verifier,screen,explain}.md` with version headers; prompt builder with field allowlist (unit test: no env secret substring ever appears).
4.4 [MUST] `compileMandate` → `validatePolicyDraft`; returns draft + sentences + issues + assumptions + questions.
4.5 [MUST] `screenUntrusted`: deterministic heuristics (`heuristics.ts`) + SERV classifier.
4.6 [MUST] `propose`: JSON output → zod → one repair retry → NOOP; enforce IDs-only (reject any `0x…40hex` in params); grounding check (citedFactIds exist; numeric params ≤ supporting facts).
4.7 [MUST] `verify`: independent prompt; rationale passed as "claimed, may be wrong"; optional different model.
4.8 [MUST] `explain`: phrases verdict using `ruleSentences`; falls back to deterministic text.
4.9 [MUST] Adversarial corpus ≥ 40 cases (TESTING.md) + `pnpm test:adversarial` runner that executes screen → propose (fixtures incl. "compromised proposer" variants) → verify → **real** `evaluate()`; asserts guarantee.
4.10 [MUST] Record fixtures for SERV examples A–D from live calls (`SERV_LIVE_TESTS=1 pnpm test:record`).
4.11 [SHOULD] If V-09 verified, capture SERV-native PromptGuard/Shadow outputs into `serv_meta`.

### Tests
Unit tests for parsing/repair/grounding; heuristics tests incl. encodings; golden examples A–D; adversarial suite; live smoke (manual, recorded).

### Opus review gate
- Try to write 5 new injection cases not in the corpus; add them; confirm guarantee still holds.
- Confirm reasoning package cannot import wallet (check:arch) and that no LLM call receives addresses or secrets.

### Exit Gate
Standard bundle + `pnpm test:adversarial` (100% guarantee; benign FP ≤ 10%); live smoke log recorded.

### Do not
Let SERV output addresses/calldata. Treat classifier output as sufficient protection.

---

## Phase 5 — Risk gate, executor, confirmer
**Model:** **Opus** · **Read first:** `AGENTKIT_INTEGRATION.md` §3–5, `POLICY_ENGINE.md` §7, `SECURITY.md` §8, `DATA_MODEL.md` (executions, simulations, receipt_nonces, ledger)

### Goal
Safely turn an ALLOW verdict into a confirmed on-chain action exactly once, with simulation parity and full audit.

### Tasks
5.1 [MUST] `packages/risk/simulate.ts`: simulate `Call[]` from the agent wallet via viem (sequential eth_call with state carry-over where needed — use anvil fork or `eth_simulateV1` if RPC supports; document choice), compute token balance deltas for agent/treasury/recipient, store `simulations` row with `calls_hash`.
5.2 [MUST] `packages/risk/oracle.ts`: price adapters (Pyth via AgentKit read or RPC; `MockPriceFeed` only when I11 conditions hold) returning `{microUsd, publishedAt}`.
5.3 [MUST] `packages/risk/triggers.ts`: `detectRiskTriggers` comparing `vault_snapshots` share price vs previous (drawdown bps) and asset depeg.
5.4 [MUST] `packages/wallet/src/executor.ts` exactly per AGENTKIT §4 (receipt verify → nonce insert → idempotent execution row → frozen re-check → calls-hash parity → send → store hash).
5.5 [MUST] Confirmer job `exec.confirm`: poll receipt (3 min), status transitions, `ledger_entries` writes, breaker counter update, obligation status update, audit rows.
5.6 [MUST] Error taxonomy: `Retryable` (network, sponsorship) with backoff 1/2/4/8 min max 4 **reusing the same execution row**; `Fatal` (revert, simulation mismatch) → FAILED, no retry.
5.7 [MUST] Circuit breaker: 3 consecutive FAILED or R14 breach → `breaker_open=true`, `frozen=true`, notification, audit `BREAKER_OPEN`.
5.8 [MUST] `sweepHome(walletId)` owner path: redeem all shares, transfer all USDC to treasury; allowed while frozen; source=`owner` proposal still evaluated (R03, R01 exception) and receipt-issued.

### Tests
Fork integration: deposit/withdraw/pay/sweep happy paths; duplicate execute call returns same execution; expired/tampered receipt rejected; frozen between verdict and send → CANCELLED; simulation-parity mismatch → refuse; timeout does not resend; breaker trips after 3 failures.

### Opus review gate
Enumerate every path that calls AgentKit/walletProvider send; confirm each is inside executor and guarded by receipt verify. Grep proof recorded.

### Exit Gate
Standard bundle + fork integration suite; live on Base Sepolia: one deposit and one payment executed through executor with receipts (hashes recorded).

### Do not
Resend a transaction without a new simulation + verdict. Catch-and-ignore errors.

---

## Phase 6 — Decision loop, scheduler, obligations, risk exits
**Model:** **Opus** · **Read first:** `ARCHITECTURE.md` §5, `SERV_REASONING.md` §4–7, `API.md` (jobs)

### Goal
The autonomous agent: triggers → context → reasoning → policy → execution, end to end, crash-safe.

### Tasks
6.1 [MUST] `DecisionLoop.run(walletId, trigger)` implementing ARCHITECTURE §5 exactly, with per-wallet advisory lock and an audit row at every step. DB unavailable ⇒ abort before any send.
6.2 [MUST] PreChecks (deterministic): skip if frozen/breaker; deterministic NOOP when nothing to do (SERV §7); deterministic proposals for (a) obligations due today (`pay_recipient`, source=deterministic) and (b) risk triggers (`risk_exit`); these still go through Policy Engine + risk gate.
6.3 [MUST] Discretionary path: screen → propose → verify → simulate → evaluate → ALLOW/ESCALATE/DENY handling.
6.4 [MUST] Escalation: create `approvals` row (24h), notification; approval handler (`/api/approvals/:id/approve`) verifies owner signature and re-runs evaluate with `ownerApproval` → receipt → executor. Policy version change auto-cancels pending approvals.
6.5 [MUST] Jobs: `loop.tick` (cron; 30 s in DEMO_MODE), `obligations.scan` (creates next monthly occurrence), `risk.scan` (vault snapshots every minute → trigger loop), `approvals.expire`.
6.6 [MUST] Crash safety: on worker boot, resume `pending/submitted` executions via confirmer; never re-propose while an execution for the wallet is unresolved.
6.7 [MUST] Degraded mode when SERV unavailable (circuit on SERV errors): only deterministic proposals run; UI flag in `/api/wallet`.
6.8 [MUST] `/api/agent/run`, `/api/decisions`, `/api/decisions/:id`, `/api/approvals*` routes.
6.9 [SHOULD] OpenTelemetry span per iteration with step timings (NFR-2).

### Tests
Integration (fork + FixtureServClient): scenarios from `DEMO.md` golden table end to end; SERV outage → deterministic payments still execute; worker killed mid-execution → resumes without duplicate; concurrent triggers → single iteration (lock).

### Opus review gate
Trace one ALLOW and one DENY through audit rows and confirm the decision is reproducible from stored snapshot + policy version (NFR-4) by re-running `evaluate` on stored inputs.

### Exit Gate
Standard bundle + `pnpm test:adversarial` + loop integration suite; live on Base Sepolia: 30-minute unattended run with demo policy producing pull → deposit → payroll, no errors.

### Do not
Add any shortcut path from SERV output to executor. Run two loops concurrently for one wallet.

---

## Phase 7 — Web app UX
**Model:** Sonnet (sub-tasks 7.6 and 7.8 **Opus**) · **Read first:** `UX_FLOWS.md`, `API.md`, `SECURITY.md` §4–5

### Goal
A polished, trustworthy web app implementing S1–S11 on top of existing APIs.

### Tasks
7.1 [MUST] Design tokens (light/dark), layout shell, header with global Freeze button, DEMO banner (I11), service-status banners.
7.2 [MUST] S1 landing, S2 connect (wagmi + Coinbase Smart Wallet per V-14, SIWE).
7.3 [MUST] S3 onboarding wizard (resumable state from API).
7.4 [MUST] S4 dashboard with polling/SSE refresh (5–10 s), stale-data indicators.
7.5 [MUST] S5 timeline with expandable decision detail (rule checks rendered with `ruleSentences`).
7.6 [MUST] **(Opus)** All signing UX: spend permission typed-data signing, policy activation signature, recipient-add signature, approval signature (exact message formats from SECURITY §5); server-side verification wiring; replay/expiry handling.
7.7 [MUST] S6 approvals, S7 policy (sentences + diff on new version), S8 recipients (poisoning-similarity warning), S10 settings, S11 closure checklist.
7.8 [MUST] **(Opus)** S9 freeze modal wired to owner-path APIs (freeze → revoke tx → sweep), each step idempotent and resumable.
7.9 [MUST] Mobile responsiveness + keyboard access for approval and freeze (NFR-7).
7.10 [SHOULD] Playwright e2e with test-mode signer: onboarding → activation → approval → freeze.

### Tests
Component tests for key widgets; e2e (7.10); a11y check (axe) on dashboard, approvals, freeze.

### Exit Gate
Standard bundle + `pnpm test:e2e`; manual walkthrough of all screens on desktop + mobile width recorded in PROGRESS (checklist).

### Do not
Compute security decisions in the browser. Show raw JSON as the primary UI.

---

## Phase 8 — Owner controls, notifications, hardening, security review
**Model:** **Opus** (sub-tasks 8.5, 8.6 Sonnet) · **Read first:** `SECURITY.md` (all), `TESTING.md`

### Goal
Make it production-credible: complete owner control path, notifications, and an adversarial review.

### Tasks
8.1 [MUST] Owner path APIs `/api/freeze`, `/api/unfreeze`, `/api/sweep`, `/api/spend-permission/revoked` per SECURITY §4 (no reasoning imports; check:arch rule proves it). Worker detects on-chain revoke automatically.
8.2 [MUST] Session hardening: SameSite=strict, short TTL, fresh-signature requirement for sensitive routes, CSRF protection, rate limiting on API.
8.3 [MUST] Secret hygiene: redaction tests, gitleaks in CI, `Secret` wrapper everywhere secrets flow.
8.4 [MUST] Audit: `/api/audit`, `/api/audit/verify`, `/api/export` (CSV/JSON).
8.5 [MUST] **(Sonnet)** Notifications: in-app center + Telegram (optional via env) for execution, escalation, blocked, risk, freeze, weekly report.
8.6 [SHOULD] **(Sonnet)** Weekly treasury report (yield earned, payments, blocked events) as notification + export.
8.7 [MUST] Red-team session: execute every row of SECURITY §8 matrix as a test or scripted manual check; record result.
8.8 [SHOULD] x402 stretch (FR-23) only if V-11 verified and all MUST items are green; rules X01–X03 added to Policy Engine with tests.
8.9 [MUST] Load/soak: 10 wallets × 1 hour in DEMO_MODE on fork; no duplicate executions, p95 iteration time recorded.

### Opus review gate (formal)
Produce `docs/SECURITY_REVIEW.md`: threat → control → test evidence for T1–T17; open risks; residual-risk statement (incl. custody limitation). Any HIGH finding blocks the gate.

### Exit Gate
Standard bundle + adversarial + e2e + red-team checklist 100% executed; SECURITY_REVIEW.md has no open HIGH.

---

## Phase 9 — Demo, deployment, docs, submission
**Model:** Sonnet (gate 9.8 **Opus**) · **Read first:** `DEMO.md`, `PRD.md` §9, `VERIFY.md` V-12

### Goal
A reliable live demo, deployed app, clear docs, and a submission that satisfies the hackathon rules.

### Tasks
9.1 [MUST] `pnpm db:seed:demo`: demo owner, recipients, obligations due "today", policy template values from DEMO.md.
9.2 [MUST] `scripts/demo/attack.ts` (dust transfer with malicious memo or untrusted-fact injection via demo API), `scripts/demo/drawdown.ts` (MockVault.simulateLoss 300 bps), `scripts/demo/reset.ts`.
9.3 [MUST] Rehearsal mode: loop tick 30 s; one-click "Run demo" checklist page (demo-only route) showing each beat's status.
9.4 [MUST] Deploy: web (Vercel), worker (Railway/Fly), Postgres (Neon); env configured; health checks; DEMO_MODE on testnet only.
9.5 [MUST] README: pitch, architecture diagram, security model summary, how SERV and AgentKit are used (link to specs), setup, demo steps, known limitations (SECURITY §9).
9.6 [MUST] Record backup demo video; 3-minute pitch deck outline in `docs/PITCH.md` (problem → demo → safety proof → business model → roadmap).
9.7 [MUST] Submission compliance per V-12 (e.g. register agent on OpenServ platform if required, show SERV usage evidence: request ids in timeline).
9.8 [MUST] **(Opus)** Release review: re-run all gates, confirm invariants I1–I12 by inspection + tests, confirm mainnet guard. Mainnet is **not** enabled for the hackathon unless the human explicitly signs off in PROGRESS with a written risk acceptance.
9.9 [FUTURE] Roadmap items (not built): session-key custody on owner account (ERC-7715/7702), Safe module, multi-chain, Sentinel SDK/API, consumer savings, RWA vaults, compliance packs.

### Exit Gate
Full rehearsal of DEMO.md beats twice in a row on the deployed app without manual DB edits; all tests green; release review recorded; submission checklist complete.

---

## Must / Should / Future summary

| Must-have (MVP) | Should-have | Future |
|---|---|---|
| AgentKit agent wallet, spend permission, MockVault | CI + gitleaks (in P1 as SHOULD, required by P8) | Session keys on owner account (no agent custody) |
| Pure Policy Engine R00–R21 + receipts | Telegram notifications, weekly report | Safe module / DAO multi-signer approvals |
| SERV compile/propose/verify/screen/explain | OpenTelemetry traces | Multi-chain + bridging (Across) |
| Executor/confirmer with idempotency + breaker | x402 stretch | Sentinel API for other agent builders |
| Decision loop + obligations + risk exits | Playwright e2e | Real mainnet vault allowlist (Morpho/Aave) with risk feeds |
| Approvals, freeze/revoke/sweep, audit chain + export | Policy diff view | Consumer savings, RWA vaults, compliance/KYT packs |
| Demo scripts + deployment | | Billing (SaaS tiers, bps fee after legal review) |
