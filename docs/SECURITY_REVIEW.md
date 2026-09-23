# SECURITY REVIEW — Steward

> Phase 8 Opus review gate (tasks 8.7 + 8.9). `PHASES.md`: *"Produce `docs/SECURITY_REVIEW.md`:
> threat → control → test evidence for T1–T17; open risks; residual-risk statement (incl. custody
> limitation). **Any HIGH finding blocks the gate.**"*
>
> Reviewed at commit on `main`, 2026-09-23, after Phases 0–7 (+ the Phase 7 companion-treasury
> addendum) and Phase 8 parts 1–2.

**Verdict: the gate PASSES.** No HIGH finding. One MEDIUM (a `SHOULD`-have control the spec itself
labels as such), four LOW, all recorded in §6 with recommendations. The custody limitation in §8 is
a *design* property of the MVP, not a defect, and it is stated plainly rather than mitigated away.

---

## 1. Scope and method

This document does not re-derive the security argument. Five earlier Opus review gates already
produced evidence, and this review's job is to **synthesise, re-check, and attack what those gates
did not cover**:

| Gate | Where | What it established |
|---|---|---|
| Phase 2 | `PROGRESS.md` › "Phase 2 — Opus review gate" | Every broadcast path; no address outside the Policy; no unbounded approval; no secret logged |
| Phase 3 | `PROGRESS.md` › "Phase 3 — Opus review gate: threat matrix" | The first T1–T17 matrix, against the pure Policy Engine |
| Phase 4 | `PROGRESS.md` › Phase 4 notes | Injection review + the 48-case adversarial corpus |
| Phase 5 | `PROGRESS.md` › Phase 5 notes | Crash-window analysis, retry/idempotency |
| Phase 6 | `PROGRESS.md` › Phase 6 notes | Replay / reproducibility of a recorded decision |
| Phase 7.8 | `PROGRESS.md` › "Opus review gate — grep evidence" | Owner-path signature gating; unreachable from reasoning |
| Phase 8 pt 1 | `PROGRESS.md` › "Secret-wrapper audit" | Every secret goes through `Secret`; `.reveal()` only at SDK boundaries |

New in this review:

1. **§3 — every row of `SECURITY.md` §8** executed as a test, a scripted check, or a recorded
   manual check. No row skipped.
2. **§4 — five new adversarial scenarios (RT-1…RT-5)** aimed specifically at the owner path and the
   notification path added in 7.8 / 8.1–8.6, which are newer and far less attacked than the policy
   core.
3. **§5 — every RR-\* residual risk** from Phases 3–7, dispositioned: closed, still open, or always
   a documented limitation.
4. **§7 (8.9) — load/soak**: 10 wallets, one simulated hour, concurrent, on an anvil fork.

Severity scale used here:

- **HIGH** — an attacker (or a bug) can move funds outside the owner's mandate, or can silently
  defeat a named invariant I1–I12. **Blocks the gate.**
- **MEDIUM** — a spec'd control is missing or weaker than written, but a second independent control
  still bounds the loss.
- **LOW** — a real property worth recording; no path to loss, or bounded by something the owner
  controls directly.

---

## 2. Threat matrix — T1–T17 (`SECURITY.md` §2)

Phase 3's matrix covered the Policy Engine. This version adds the layers built since: the risk gate
and executor (Phase 5), the decision loop (6), the signing UI and owner path (7), the session,
secret, audit and notification hardening (8). Where Phase 3's evidence still stands unchanged it is
cited, not repeated.

| ID | Threat | Controls (defence in depth, outermost last) | Test evidence |
|---|---|---|---|
| **T1** | Prompt injection | Fencing + truncation + control-char stripping (`packages/reasoning`); deterministic `screenItems` heuristics; SERV classifier *in addition*, never instead; **R16** (flagged ⇒ DENY for every value-out kind, and that DENY is not liftable by an owner approval); grounding R19; allowlists R04/R05. The LLM has no write tools at all — `check:arch` proves `packages/reasoning` cannot reach the executor | `packages/reasoning/test/adversarial.test.ts` (48 malicious cases, 100% DENY/ESCALATE; 0/12 benign false positives, `pnpm test:adversarial`); `heuristics.test.ts`; `packages/policy/test/rules.test.ts` › R16 ×5; `golden.test.ts` › "t=1:30 — the attack memo can never move value"; `pnpm check:arch` rules `reasoning-no-wallet-db` + `cdp-only-in-wallet-bootstrap`, each with a deliberate-violation fixture |
| **T2** | Excessive agency | **R02** (`autonomousKinds`), **R10** (approval threshold), R06/R07/R08/R14 caps, and the on-chain allowance above all of them | `rules.test.ts` › R02, R10; `adversarial.test.ts` › A12 (both halves); `apps/worker/test/loop.test.ts` › approval lifecycle |
| **T3** | Address poisoning | **R05** — a proposal carries a recipient **id**, and only the owner-signed Policy turns an id into an address. No ENS, no fuzzy match, exact checksummed equality (I4). `buildCalls` re-checks every target against `allowedTargets` | `adversarial.test.ts` › A03 (6 lookalikes incl. zero-width and Cyrillic "е"); `packages/wallet/test/actionRegistry.test.ts` › "an address that appears only in proposal-adjacent state never becomes a target"; `property.test.ts` › P1 |
| **T4** | Malicious contract | **R04** (vault allowlist + `contractHasCode` + asset is a policy token), **R11** (simulation parity in both directions), R18 | `rules.test.ts` › R04 ×7, R11 ×11; `adversarial.test.ts` › A13; fork: `packages/wallet/test/fork/fork.test.ts` |
| **T5** | Unlimited approvals | **R18**: at most one approval, exact amount, only to *this* deposit's allowlisted vault, only on a policy token. `ERC20_ABI` deliberately omits `increaseAllowance` | `rules.test.ts` › R18 ×8 (incl. `2^256-1`); `actionRegistry.test.ts` › "the only approve in any kind is for exactly the deposited amount"; fork test asserts the residual on-chain allowance is **0** after a real deposit |
| **T6** | Agent wallet key compromise | **Bounded, not prevented** (see §8). **R13** (≤ on-chain allowance), **R01** (freeze/breaker), the executor refuses without a valid `AllowReceipt`, and the Spend Permission caps the pull on-chain. Freeze → revoke → sweep is the response | `rules.test.ts` › R13, R01; `receipt.test.ts` › "refuses a different secret"; live Base Sepolia run (PROGRESS, Phase 2): a post-revoke spend is **rejected by the chain**. Residual **RR-2** |
| **T7** | Owner session hijack | SameSite=**strict**, httpOnly, Secure in prod, **12 h** TTL; every sensitive route needs a **fresh server-issued single-use nonce** signed by the owner's wallet (policy activate, recipients, spend permission, approvals, freeze, unfreeze, **sweep** — added in 8.2); the engine additionally refuses an approval whose signer ≠ `policy.signedBy` or whose hash is for a different proposal | `apps/web/test/sessionHardening.test.ts` (17); `apps/web/test/ownerPathApi.test.ts` (21, incl. the RT-4 race block); `signingApi.test.ts`; `evaluate.test.ts` › "ignores an approval signed by somebody else" / "for a different proposal" / "an expired approval". Residual **RR-1** (closed — see §5) |
| **T8** | SERV wrong / hallucinated reasoning | **R19** (every cited fact must exist; low confidence ⇒ ESCALATE), **R15** (DISAGREE ⇒ DENY, UNSURE ⇒ ESCALATE), **R11** (the *simulation*, not the rationale, decides what moved), schema forcing with one repair then NOOP | `adversarial.test.ts` › "cannot invent facts", "cannot understate the deltas of its own transfer"; `rules.test.ts` › R19 ×3, R15 ×7; `packages/reasoning/test/tasks.test.ts`. Residual **RR-4/RR-5** |
| **T9** | Replay / duplicate execution | **R17** (`hashProposal` over the *action*), receipt `nonce`/TTL/`proposalHash`/`callsHash`, unique `(wallet_id, proposal_hash)` in the DB, unique receipt nonce | `adversarial.test.ts` › A08; `receipt.test.ts`; `packages/wallet/test/executor.test.ts` › "a duplicate call with the SAME receipt…", "a FRESH receipt for the same proposal hash is still a duplicate", "concurrent executes of the same proposal hash produce exactly one send and one row", "a replayed nonce on a DIFFERENT proposal is refused outright"; **§7 soak** (10 wallets, concurrent, 0 duplicates) |
| **T10** | Execution loop | **R14** (`min(policy, 20/h)`) + circuit breaker (3 consecutive failures, or an R14 breach) → auto-freeze + notify | `rules.test.ts` › R14 ×3; `adversarial.test.ts` › A18; `packages/wallet/test/confirmer.test.ts` › "opens and freezes after 3 consecutive failures"; `pipeline.ts` `tripBreaker` on R14 (RR-12, closed) |
| **T11** | Stale / manipulated prices | **R12** (age ≤ 60 s, future-dated ⇒ DENY, depeg ⇒ DENY for **every price-sized kind**, widened in Phase 3's own review), `valueInput` refuses a zero price | `adversarial.test.ts` › A05 (59/60/61 s), A11 ×2; `units.test.ts`; `packages/risk/test/risk.test.ts` |
| **T12** | Depeg / vault exploit | **R20** pre-authorised exit (real trigger required, funds only vault→agent), R04 blocks new deposits into a flagged vault, R12/R16 exemptions so the exit is never itself blocked | `golden.test.ts` › "t=2:25 — a 3% vault drawdown exits autonomously"; `adversarial.test.ts` › A13, A16; fork: `apps/worker/test/fork/loop.fork.test.ts` › "a vault drawdown produces an autonomous risk_exit" |
| **T13** | Secrets leak via logs/prompts | `Secret<string>` wrapper (redacts through `toString`, `JSON.stringify`, `canonicalJson`, node inspect); pino `REDACT_PATHS` built from a `SECRET_KEYS` list, each key bare **and** as `*.key` (8.3 found `*.secret` never matched `apiKeySecret`); prompt builder allowlist; gitleaks in CI; the Policy Engine has no env, logger, network or clock at all | `packages/shared/test/redaction.test.ts` (7, incl. a canary per single-key path and a **static walk that fails the build if any file in `apps/`/`packages/` reads a secret env var directly**); `packages/wallet/test/secrets.test.ts` (9); `pnpm check:arch` + eslint purity fixtures |
| **T14** | Audit tampering | Hash chain (`prev_hash`, `row_hash`), Postgres trigger blocking UPDATE/DELETE, `/api/audit/verify` recomputes and names the broken row, `/api/audit` exposes both hashes so a caller need not trust `/verify` | `packages/db/test/audit.test.ts` (tamper detection with the trigger disabled); `apps/web/test/auditRoutes.test.ts`; `property.test.ts` › P4 (byte-identical verdicts). **Open: tail truncation — finding F-2, §6** |
| **T15** | Demo override abuse | The $1.00 parity fallback needs an explicit caller flag **and** chainId 84532 and never overrides a real quote; **R21** re-checks the chain and refuses 8453 without `allowMainnet`; `MAINNET_GATE_SIGNED_OFF === false` refuses it even *with* the flag (D-17) | `units.test.ts` › "uses the fenced DEMO parity fallback only on Base Sepolia"; `rules.test.ts` › R21 ×4; `packages/wallet/test/chain.test.ts`; `provision.test.ts` › "refuses mainnet **before touching CDP**" |
| **T16** | Malicious owner instruction | `validatePolicyDraft` **rejects** (never silently clamps) anything above a system ceiling, and R06/R07/R14 re-check the *system* ceiling independently, so a bad stored policy still cannot raise a limit. Risk guards cannot be disabled (`MIN_RISK_THRESHOLD_BPS`) | `mandate.test.ts` (48, incl. a 16-case rejection table); `rules.test.ts` › "denies above the system ceiling even if the policy allowed it" ×3 |
| **T17** | Permission escalation via received assets | No code path grants authority from a holding. An airdropped token has no policy entry, so it cannot be valued (R06/R12), targeted (R04/R05) or approved (R18); a phantom vault position is excluded from managed funds (D-30) | `property.test.ts` › P1; `adversarial.test.ts` › "a phantom position in state cannot inflate managed funds"; `units.test.ts` › "ignores positions in vaults the policy does not allowlist" |

---

## 3. Task 8.7 — the `SECURITY.md` §8 failure & attack matrix, row by row

Every row below has an outcome. `PASS` = an automated test proves the response. `MANUAL` = the
check was performed by hand for this review, with the steps recorded, because it cannot be a
standing automated test. `MITIGATED (residual)` = the response happens, but something outside the
system's reach remains, named in §6.

| # | Scenario (`SECURITY` §8) | Response, as actually built | Evidence | Outcome |
|---|---|---|---|---|
| 1 | Agent makes wrong decision | Screen → verifier → Policy Engine → simulation, in that order; a wrong call is DENIED or ESCALATED. If it is in-mandate and executes, the loss is bounded by R06/R07/R10 and the on-chain allowance; the owner is notified and the whole decision is replayable | `adversarial.test.ts` 48/48; `apps/worker/test/loop.test.ts` › the replay cases; `apps/worker/src/replay.ts` (a decision with no VERDICT row cannot be replayed) | **PASS** |
| 2 | Malicious owner instruction | `validatePolicyDraft` **rejects** above-ceiling mandates rather than clamping (safer than the spec's word "clamps": a clamp silently gives the owner something they did not ask for), warns on risky-but-legal settings, and the rules re-check the system ceilings independently | `packages/policy/test/mandate.test.ts` (48); `rules.test.ts` › the three "even if the policy allowed it" cases | **PASS** |
| 3 | Owner wallet compromised | Out of Steward's scope by design: Steward holds no owner key and cannot move treasury funds. An attacker with the owner's wallet can sign a policy or a recipient add — the signature requirement is built (7.6) — **but the 24 h cooldown the spec lists is not** | Signature side: `apps/web/test/signingApi.test.ts`, `recipientsScreen.test.tsx`. Cooldown: absent | **MITIGATED (residual)** — finding **F-1** (MEDIUM), spec-labelled should-have |
| 4 | Agent key compromised | Max loss = exposure bound (agent USDC + vault share value + remaining period allowance), shown in the UI as "Maximum at risk". Freeze → revoke → sweep; CDP key rotation is an operator action | `packages/wallet/test/spendPermission.test.ts` bounds; the `maxAtRisk` read model + `dashboard.test.tsx`; live run: a spend **after** revoke is rejected by the chain | **MITIGATED (residual)** — RR-2 / §8 custody statement |
| 5 | Malicious contract | R04 DENY (allowlist + code-present + asset check) and, independently, R11 simulation mismatch | `rules.test.ts` › R04 ×7, R11 ×11; `adversarial.test.ts` › A13 | **PASS** |
| 6 | Phishing site | Steward only ever asks for **fixed, human-readable** messages, all server-issued with a single-use nonce and a short TTL. A phishing copy cannot produce a signature Steward's own routes will accept, because the nonce lives in the victim's session | `apps/worker/test/loop.test.ts` › "the message is exactly the SECURITY §5 format"; `packages/shared/src/signing.ts` + `signHelpers.test.ts`; `ownerPathApi.test.ts` › the nonce/action binding (D-90) | **PASS** for the signature-acceptance half; a third-party site tricking a user into signing something else is out of scope — F-5 |
| 7 | Address poisoning | R05 exact match; the agent cannot add a recipient at all | see T3 | **PASS** |
| 8 | Token approval exploit | R18 exact-amount approvals only; the fork test asserts the residual allowance is 0 after a real deposit | see T5 | **PASS** |
| 9 | Insufficient balance | The proposer sees balances; R08/R06 size it; the simulation fails ⇒ DENY; R17 stops the identical proposal re-running and PreChecks go quiet rather than looping (RR-14) | `rules.test.ts` › R08, R06; `apps/worker/test/prechecks.test.ts`; `adversarial.test.ts` › A08 | **PASS** |
| 10 | Gas spike / congestion | Paymaster sponsorship when configured (`CDP_PAYMASTER_URL`); a sponsorship rejection is classified **retryable** and backs off 1/2/4/8 min, at most 4 attempts, then FAILED + notify | `packages/wallet/test/executor.test.ts` › "retries a retryable failure on the SAME row with the 1/2/4 minute backoff", "gives up after 4 attempts and marks the row FAILED" — the fixture error is literally a paymaster rejection | **PASS** |
| 11 | Failed transaction | The confirmer records FAILED **only** when the receipt reverted or the measured effect does not match; the breaker counter increments; the ledger is not written | `confirmer.test.ts` › "fails when the transaction reverted even though a receipt exists", "fails when the receipt succeeded but the effect does not match the proposal", "resets the consecutive-failure counter on success" | **PASS** |
| 12 | Duplicate transaction | Unique `(wallet_id, proposal_hash)`; single-use receipt nonce; the executor is idempotent on the proposal hash even with a *fresh* receipt | `executor.test.ts` ×4 including the concurrent case; **§7 soak: 0 duplicates across 10 concurrent wallets** | **PASS** |
| 13 | Execution loop | R14 rate limit; the breaker opens after 3 consecutive failures **or** an R14 breach, and opening it freezes the wallet and notifies | `confirmer.test.ts` › "opens and freezes after 3 consecutive failures"; `pipeline.ts` `tripBreaker` on R14 (RR-12 closed); `adversarial.test.ts` › A18 | **PASS** |
| 14 | SERV incorrect reasoning | Grounding (R19) + shadow verifier (R15) + the Policy Engine; a SERV timeout or an open SERV breaker makes the run `degraded`, which is deterministic-only, and a schema failure after one repair is NOOP | `packages/reasoning/test/tasks.test.ts`, `serv.test.ts`; `apps/worker/src/runtime.ts` SERV breaker + `SERV_COOLDOWN_MS` | **PASS** |
| 15 | AgentKit failure | Errors are classified fatal vs retryable; a fatal one never retries, and a retry re-sends exactly the receipt-bound calls or nothing at all | `packages/wallet/src/errors.ts`; `executor.test.ts` › "never retries a fatal failure" | **PASS** |
| 16 | API outage (SERV / RPC) | SERV down ⇒ `degraded` ⇒ deterministic path only, which is where `risk_exit` lives, so the safety action never needs SERV. RPC down ⇒ `gather` fails ⇒ SKIPPED, nothing sent | `apps/worker/test/loop.test.ts` › the dead-client cases | **PASS** |
| 17 | DB outage | The loop aborts **before** anything can be sent: an unreadable wallet row is `DB_UNAVAILABLE`, and any failed audit write aborts the iteration (I5/I6 — never act without an audit row). Re-answered in 8.1 for the owner path: no exception (D-108) | `loop.test.ts` › "a DB that cannot be read aborts before anything else (I5)"; `loop.ts` returns `AUDIT_FAILED` at four separate points | **PASS** |
| 18 | Immediate revoke | `/api/freeze` freezes, cancels pending approvals and audits, then hands back an **unsigned** revoke transaction for the owner's own wallet — Steward never broadcasts it. Since 8.1 `permission.scan` also detects an out-of-band revoke every 5 minutes with no user action at all | `ownerPathApi.test.ts`; `apps/worker/test/permissionScan.test.ts` (6, with `@steward/reasoning` mocked to throw on import — I7 proven at runtime, not just statically); live run: `isRevoked` true and the next spend rejected by the chain | **PASS** |
| 19 | Recover funds | `sweep_home` works **while frozen** and is the only action that does; it builds a `source:'owner'` proposal, simulates it, runs the real `evaluate()` (R03 + R11) and still needs a signed receipt. The owner can also revoke directly from their own wallet with Steward entirely offline | `executor.test.ts` › "still sends an owner sweep_home while frozen"; `ownerPathApi.test.ts` › the sweep block; `packages/wallet/src/sweepHome.ts` with its `check:arch` fixture | **PASS** |

**Score: 19/19 rows executed. 17 PASS, 2 MITIGATED-WITH-RESIDUAL-RISK, 0 FAIL, 0 skipped.**

### 3.1 The two rows that needed a manual check, and what was done

**Row 3 (owner wallet compromised) — MANUAL.** Steps taken for this review: grepped every path that
can move treasury funds without an owner signature (`sweepHome` is the only code that names the
treasury address at all, and it moves funds *to* it, never from it); confirmed
`wallets.treasury_address` is written exactly once, at first sign-in, and never updated afterwards
(`ensureWalletForUser`, and RT-5 in §4 proves a later re-classification cannot move it); confirmed
recipient adds and policy activations both require a fresh owner signature. **Result: the "Steward
cannot move owner funds" half holds. The 24 h cooldown half is not built** — F-1. It cannot become a
standing automated test until the control itself exists.

**Row 6 (phishing site) — MANUAL, half automatable.** Automated: the message formats are fixed
strings with tests, and every sensitive route re-derives the message from the **session's** nonce and
action rather than from the request body, so a message minted by any other site is refused. Not
automatable here: whether a human is induced to sign something on a page Steward does not control.
That is a wallet/browser-UX property. The honest mitigation is the one already in place — Steward
never asks for an opaque signature, and the on-chain Spend Permission caps what any signature can
ever be worth. Recorded as F-5 (LOW, accepted).

### 3.2 What this review changed

- **Rows 18/19 and I7.** RT-4 found that a *mismatched-action* request spent the owner's freeze
  confirmation before checking that it matched. A stray or hostile POST to `/api/freeze` could
  therefore burn the nonce the owner had just prepared for an unfreeze, and the reverse — a denial
  of the one control that stops the agent. **Fixed** in `apps/web/lib/ownerPath.ts`: the action is
  checked *before* the nonce is spent. Nothing became replayable that was not replayable before —
  the nonce is still single-use for its own action and still TTL-bound.
- **Row 1's notification tail.** `/api/me/telegram` now takes numeric chat ids only (RT-2), removing
  `@publicchannel` as a possible destination for an owner's treasury notifications.
