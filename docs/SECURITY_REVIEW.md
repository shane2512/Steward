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

---

## 4. Task 8.7 — five new adversarial scenarios (RT-1…RT-5)

The Policy Engine has had an adversarial corpus since Phase 4 and 100% branch coverage since Phase
3. The **owner path (7.8) and the notification path (8.5/8.6) have had neither**, and the companion
treasury (Phase 7 addendum) is the newest custody logic in the project. These five attempts target
exactly that surface. Every one is now a standing test in the normal suite — none is a throwaway
script.

### RT-1 — can an injected notification body become executable content where it is rendered?

**Attack.** A notification body is the one string in Steward that begins as untrusted data (a vault
`name()` read off-chain, a DENY reason quoting a proposal, a recipient label) and ends on a screen
the owner trusts. Make it `<img src=x onerror=…>`, an HTML anchor, or Telegram markup.

**Result: PASS, no fix needed.** Two render surfaces, both safe:

1. The in-app centre is React, which escapes every JSX child. The guarantee only holds while nobody
   reaches for an HTML sink, so the test is a **static scan of every `.ts`/`.tsx` the web app ships**
   for `dangerouslySetInnerHTML`, `innerHTML =`, `insertAdjacentHTML`, `document.write`, `eval` and
   `new Function` — all zero, and the scan asserts it looked at a real, non-empty file set so it
   cannot pass vacuously. It also pins that the bell interpolates the title and body as *children*
   and never into an `href`, which React does **not** escape.
2. Telegram is sent with **no `parse_mode`**, so the Bot API renders the text literally.

Evidence: `apps/web/test/redteam.test.ts` (7); `packages/db/test/notifications.test.ts` ›
"RT-1: a notification body is sent verbatim with no parse_mode".

### RT-2 — can the Telegram sender be used as an SSRF or exfiltration vector?

**Attack.** Two halves. (a) Steer the outbound request somewhere else with a crafted chat id —
`../../evil`, an absolute URL, a header-injection newline, a query-string append. (b) Redirect an
owner's treasury notifications to an attacker-controlled destination.

**Result: (a) PASS. (b) real, and tightened.** The URL is a literal template with only the bot token
interpolated, and the chat id travels as a JSON **body field**, so nothing a chat id contains can
change the host, path or headers — asserted for five hostile ids in
`packages/db/test/notifications.test.ts` › "RT-2: a hostile chat id cannot move the request off
api.telegram.org".

Half (b) is the real finding. `POST /api/me/telegram` takes no fresh signature — deliberately, it is
a notification preference, not a money-moving action — so a hijacked session could point
notifications elsewhere. Telegram also accepts `@publicchannel` as a `chat_id`, which would make the
destination a *public* channel. **Fixed narrowly**: the route now accepts numeric chat ids only
(`/^-?\d{1,32}$/`), which is the shape every real private or group chat has, so the public-channel
destination class is gone entirely. What remains — a session-holding attacker pointing notifications
at their own private chat — is **F-3 (LOW)**: it leaks the same balances and amounts that same
session can already read from `/api/dashboard`, and it moves no funds.
Evidence: `apps/web/test/notificationsRoutes.test.ts` › "POST /api/me/telegram — RT-2 chat id shape"
(4 tests).

### RT-3 — can the rate limiter's per-user / per-IP keying be bypassed?

**Attack.** Rotate identity to mint fresh allowances and exhaust an expensive resource (a paid SERV
call, a loop iteration, an on-chain sweep).

**Result: PASS for everything that costs money; a known, deployment-level bound on the rest.**
Every expensive bucket — `mandate.compile`, `agent.run`, `sweep`, `unfreeze` — is keyed by the
session `userId`, which a caller cannot rotate; headers buy nothing. The two unauthenticated buckets
(`auth.nonce`, `auth.verify`) are keyed by `clientIp`, which trusts the first hop of
`x-forwarded-for`. That is correct behind exactly one proxy that sets the header (Vercel overwrites
it at the edge) and forgeable if the app is ever exposed directly. A forger cannot *borrow* someone
else's allowance, but they can mint their own — so those two buckets are a **cost control, not a
security control**, and nothing behind them moves funds. Recorded as **F-4 (LOW)** and pinned by a
test so the property is written down rather than assumed.
Evidence: `apps/web/test/sessionHardening.test.ts` › the two RT-3 tests, plus the pre-existing "has
no bucket for the owner stop path (I7)".

### RT-4 — can two concurrent freeze / unfreeze / sweep requests race into an inconsistent state?

**Attack.** Fire several owner-path requests together and try to (a) spend one confirmation twice,
(b) land a freeze and an unfreeze in the same instant, (c) double-sweep.

**Result: one real finding, FIXED; the rest safe.**

- **Found and fixed:** `verifyFreezeSignature` used to clear the session nonce *before* checking
  that the stored action matched the route being called. A mismatched request therefore **burned the
  owner's live confirmation** — a stray or hostile POST to `/api/freeze` would invalidate the
  unfreeze the owner had just prepared, and, more seriously, the reverse: a denial of the one
  control that stops the agent (I7). The check now runs **before** the nonce is spent. Nothing
  became replayable: the nonce is still single-use for its own action, still bound to `walletId`,
  still TTL-bound.
- **Concurrency itself is safe.** Five concurrent freezes with one confirmation: exactly one 200,
  four 400s. A *replayed* confirmation (the realistic production shape, since iron-session is a
  stateless cookie and two simultaneous requests each carry their own copy) is accepted a second
  time but is a **no-op** — the end state, the audit chain and the `frozen` flag are identical to a
  single request. That is why the cookie-copy race is **F-6 (LOW)** rather than a defect: every
  outcome on this path is idempotent and in the safe direction, and the sweep is additionally keyed
  by the proposal hash (I10).
Evidence: `apps/web/test/ownerPathApi.test.ts` › "RT-4 — concurrent owner-path requests" (3).

### RT-5 — can the companion-treasury derivation be tricked into deriving for the wrong owner?

**Attack.** Two routes in. (a) A SIWE message naming somebody else's address, signed with the
attacker's key. (b) Make a *later* sign-in re-derive: the EOA acquires on-chain code (an EIP-7702
delegation, or simply a node that answers `getCode` differently), which would re-classify it as a
deployed contract wallet and hand back the raw address instead of the companion — stranding
everything already sent to the companion.

**Result: PASS on both, no fix needed.** (a) is refused at the signature check: the address is
parsed from the message and the signature is verified against *that* address, so a mismatched
signature is a 401 and **no user row is created for the claimed address at all**. (b) is structurally
impossible: the treasury is resolved **only when the wallet row does not exist**, and the row is the
record of truth forever after — the test flips `getCode` between sign-ins and asserts the stored
treasury does not move. The derivation itself is a CREATE2 address over the owner bytes and a pinned
nonce, already proven deterministic and injective by a `fast-check` property in Phase 7's addendum.
Evidence: `apps/web/test/authVerifyTreasury.test.ts` › the two RT-5 tests, plus the four existing
ones; `packages/wallet/test/companionTreasury.test.ts`.

**Summary: 5 attempted, 3 clean passes, 2 produced a fix (RT-2 narrowing, RT-4 nonce ordering), 0
HIGH.**

---

## 5. Residual risks RR-1 … RR-17 — disposition

Every `RR-` recorded in `PROGRESS.md` across Phases 3–7, decided now. "Closed" means a later phase
built the control the risk was waiting for. "Accepted" means it was always a documented limitation
and stays one. "Open" means it is still live and is carried in §6.

| RR | Phase | What it said | Disposition |
|---|---|---|---|
| **RR-1** | 3 | The engine trusts that `ownerApproval.signer` was cryptographically verified; it cannot do I/O | **CLOSED.** Phase 6.4 and 7.6 verify the signature *before* building the `EvaluationInput` — `verifyApprovalSignature` in `apps/worker/src/approvals.ts` and the approve route, both with tests incl. "a verification that cannot be completed is NOT an approval (I5)". The engine's own checks (signer == `policy.signedBy`, hash binding, expiry) are a second layer, not the only one |
| **RR-2** | 3 | Key material lives outside the engine; a compromised backend holding the HMAC receipt key can mint receipts for proposals the engine allowed | **ACCEPTED — this is the custody model.** Bounded by the on-chain Spend Permission (L2) and by freeze/revoke. The engine's contribution stands: a receipt is useless for a different proposal, policy version, wallet, call set or time window. See §8 |
| **RR-3** | 3 | `proposal.source` is data, not proof | **CLOSED (bounded).** Phases 4/6 set `source` in code only — `propose` restamps its own output, the loop stamps `deterministic`/`serv`, and the owner path stamps `owner`. D-26 additionally refuses to exempt owner-sourced proposals from R02, so even a forged `source='owner'` escalates to a human instead of executing |
| **RR-4** | 4 | The injection classifier is weak (87.5% heuristic recall) | **ACCEPTED, by design.** Layer 5 is explicitly never the last line: R16 turns a flag into a DENY, and every hard rule runs regardless of what the classifier thought. The adversarial corpus measures the *end-to-end* guarantee (48/48), not the classifier |
| **RR-5** | 4 | Verifier collusion — same provider, same model family | **ACCEPTED.** Structural, not fixable inside this MVP. Mitigated by the verifier being independent of the proposer's chain of thought and by R15 being ESCALATE-on-UNSURE. A genuinely independent second provider is a production item |
| **RR-6** | 4 | Prompts are shared with OpenServ (NFR-5); data collection is on | **ACCEPTED, disclosed.** No secret ever enters a prompt (`redaction.test.ts` asserts it), and the prompt-builder field allowlist is what makes that true rather than hopeful |
| **RR-7** | 4 | `packages/context` does not decide what is untrusted — the gatherer must | **CLOSED for what exists; see RR-16.** `gather` fences every policy vault's on-chain `name` and accepts `extraUntrusted`. There is still no memo store, so the seam is half-used rather than half-built |
| **RR-8** | 4 | `noop` is the safe failure and also a denial of service | **ACCEPTED.** Correct by I5. The UI surfaces it (`paused`/`parked`/`degraded` on the dashboard) so a quiet agent is visible rather than mistaken for a working one |
| **RR-9** | 4 | Prompt/fixture drift — fixtures keyed by request hash | **OPEN (LOW).** Unchanged: editing a prompt silently invalidates fixtures and the golden tests skip rather than fail. Carried as **F-7** |
| **RR-10** | 5 | An ambiguous timeout inside `send` | **CLOSED.** The crash-window path resolves it: a hashless row is FAILED if the chain shows no agent activity, and **UNCERTAIN — never resent** if it does (`confirmer.test.ts` ×2) |
| **RR-11** | 5 | The ledger values USDC at $1.00 | **ACCEPTED.** Reporting-only; no rule reads `ledger_entries.usd_micro`. R12 still denies on a real depeg |
| **RR-12** | 5 | The breaker counted confirmer failures only | **CLOSED.** `tripBreaker` is now called on an R14 breach inside `runPipeline` too, and the soak (§7) fired it 1,000 times under load |
| **RR-13** | 6 | PreChecks size proposals at the $1 parity when there is no quote | **ACCEPTED.** Sizing-only heuristic; the engine redoes the conversion and R08/R06/R10/R12 deny if it was wrong. It can produce a proposal the engine refuses, never one it wrongly permits |
| **RR-14** | 6 | R17 and the deterministic path interact: a stuck obligation parks the wallet | **CLOSED (with a known consequence).** PreChecks take `recentProposalHashes` and go quiet; the `NOOP` audit row carries the reason and the dashboard shows `parked`. The soak deliberately varies its funding so this does *not* mask the load |
| **RR-15** | 6 | Payroll-before-yield differs from DEMO.md's narration | **ACCEPTED (not a security risk).** A Phase 9 scripting item |
| **RR-16** | 6 | `untrusted` is only vault names plus what the caller injects | **OPEN (LOW).** Unchanged. The screen is only as wide as what the gatherer fences, and Phase 9's attack script must supply the demo memo through `extraUntrusted`. Carried as **F-8** |
| **RR-17** | 6 | Quiescence is pinned by tests, not emergent: a quiet tick is an audit row, not a decision row | **CLOSED.** Phase 7's dashboard reads the `NOOP` audit events for liveness (`paused` after 10 minutes with no agent audit row) |

---

## 6. Findings

| ID | Severity | Finding | Recommendation | Blocks gate? |
|---|---|---|---|---|
| **F-1** | **MEDIUM** | **No 24 h cooldown on recipient / policy changes.** `SECURITY` §8 row 3 lists it for the "owner wallet compromised" case. The signature half is built; the cooldown is not. An attacker holding the owner's wallet can add a recipient and have it paid in the same hour, bounded only by the per-tx / daily caps and the remaining allowance | Not attempted here: it needs a new Policy Engine rule and a schema column, and `POLICY_ENGINE.md` does not define one. Rushing a rule into a 100%-branch-covered engine at a review gate is the wrong trade. Spec it as R22 (`recipient.addedAt + 24 h > now ⇒ ESCALATE` for `pay_recipient`) and build it with the rest of the catalogue | **No** — the spec itself labels it `should-have`, and the primary control (owner signature) is in place. It is the single largest gap in this document |
| **F-2** | **MEDIUM → FIXED** | **The worker's advisory lock and its query traffic shared one 10-connection pool.** The lock holds a connection for the whole iteration; every query inside that iteration needs one too. At wallet-level concurrency ≥ the pool size the worker deadlocks permanently. Found by the 8.9 soak, which hung for 70 minutes before this was understood | **Fixed** in `apps/worker/src/index.ts`: a separate pool for the locks. Latent rather than live in the MVP (the `loop.run` handler concurrency is 1), fatal on scale-out | **No** — fixed |
| **F-3** | LOW | `POST /api/me/telegram` needs no fresh signature, so a hijacked session can point notifications at an attacker's own chat | Narrowed in this review (numeric ids only, so no public channel). Leaks nothing that session cannot already read from `/api/dashboard`; moves no funds. Add a signature if notifications ever carry anything `/api/dashboard` does not | No |
| **F-4** | LOW | The two unauthenticated rate-limit buckets key on `x-forwarded-for`, which is forgeable unless exactly one trusted proxy sets it | Treat `auth.nonce` / `auth.verify` limits as cost controls. If Steward is ever served without such a proxy, key them on something else or add a global ceiling. Pinned by a test so it is written down | No |
| **F-5** | LOW | A third-party page can still induce a user to sign *something else*; Steward cannot see that | Accepted and structural. Steward never asks for an opaque signature, and the Spend Permission caps what any signature can be worth. Wallet-UX territory | No |
| **F-6** | LOW | iron-session is a stateless cookie, so two genuinely concurrent requests each hold their own copy of the single-use freeze nonce and it can be spent twice inside its 2-minute TTL | Accepted: every outcome on this path is idempotent and in the safe direction (proven by RT-4's replay test). A server-side nonce store would close it if the owner path ever gains a non-idempotent action | No |
| **F-7** | LOW | SERV golden fixtures are keyed by request hash and the golden tests **skip** when a fixture is missing, so a prompt edit silently removes coverage (RR-9) | Add a CI flag that fails instead of skipping when `SERV_FIXTURES` is expected to be present | No |
| **F-8** | LOW | `ContextInput.untrusted` currently carries only vault names plus whatever the caller injects (RR-16) | Phase 9's attack script must supply the demo memo through `extraUntrusted`; a memo store would widen it properly | No |
| **F-9** | LOW | **Audit tail truncation is undetectable** — deleting the last N rows (with the trigger disabled by a superuser) leaves a chain that still verifies. Deferred from 1.9, again from 8.4, decided here | **Decision: formally accepted as a residual risk for the MVP, with a production plan.** See §6.1 | No |

### 6.1 The audit-tail-truncation decision (deferred since Phase 1.9)

The hash chain detects *edits* and *insertions*; it cannot detect a truncation of the tail, because
a shorter chain is still internally consistent. The attacker needs DB-owner rights (the trigger
blocks the app role, and that is exactly how the tamper test disables it).

Two mitigations were considered:

1. **A second DB role.** `GRANT INSERT, SELECT ON audit_log TO <app_role>` with ownership elsewhere
   makes the truncation need credentials the app does not have. This is the right production answer
   and it is *infrastructure*, not code: dev and test run as the owner, so the migration cannot
   apply it without breaking every local run.
2. **An external anchor.** `verifyChain` already returns `(rows, head)`. Periodically persisting
   `(walletId, rows, head, at)` somewhere the app role cannot rewrite — a Telegram message, an
   export, or on-chain — makes truncation detectable by comparison.

**Decision: accept for the MVP; do not build either here.** Reasons, in order: (a) the threat model
for T14 is an attacker who has already reached DB-owner rights, at which point the far bigger prize
is `RECEIPT_HMAC_SECRET`, not the log; (b) option 1 is a deployment change that this repo cannot
make correctly without also owning the deployment; (c) option 2 is a genuinely new subsystem, and a
review gate is the worst moment to add one. **Production checklist item, recorded here and in
`PROGRESS.md`:** apply option 1 before any deployment that holds real value, and, if notifications
are configured, send the weekly `(rows, head)` pair with the 8.6 report — that is the cheapest
version of option 2 and it reuses a transport that already exists.

---

## 7. Task 8.9 — load / soak

**Setup.** 10 wallets, each with its own user, policy, vault row and **its own agent address**, all
against one anvil fork of Base Sepolia (the real MockVault, the real Circle testnet USDC) and one
real Postgres. 120 rounds; each round fires **3 concurrent triggers per wallet** (30 in flight) so
the per-wallet advisory lock is genuinely contended, then drains the confirmer.

**What was compressed, and what was not.** Wall-clock only. The loop's clock is injected, so a round
advances `now` by the 30-second DEMO cadence rather than sleeping for it — 120 rounds is one
simulated hour per wallet. The iteration count, the concurrency, the chain work, the Policy Engine
evaluation, the `eth_simulateV1` risk gate, the executor, the confirmer and the rolling R07/R14
windows are all real and unmodified. The bugs a soak exists to catch — a second send for one
proposal hash, a lock that lets two iterations overlap, a rolling window computed off the wrong
clock, a pool that starves itself — are functions of iteration count and concurrency, not of
waiting. (F-2 is the proof that this is not a weakened test: it found a deadlock that ten minutes of
real-time single-wallet running would never have surfaced.)

**Result** — `STEWARD_FORK=1 STEWARD_SOAK_ROUNDS=120 npx vitest run apps/worker/test/fork/soak.fork.test.ts`:

| Metric | Value |
|---|---|
| Wallets | 10 |
| Simulated window | 60 min (120 rounds × 30 s) |
| Triggers fired | 3,600 |
| **Iterations run** | **1,200** (one per wallet per round; 2,400 refused by the advisory lock, as intended) |
| Outcomes | 200 executed, 1,000 denied, 0 skipped, 0 failed |
| Executions written | 200 · submitted 200 · `TxSender.send` calls **200** |
| **Duplicate executions** | **0** |
| Circuit-breaker trips | 1,000 (every R14 breach; the harness unfreezes like an owner would, see below) |
| **p50 / p95 / p99 / max iteration** | **119 ms / 210 ms / 270 ms / 404 ms** |
| NFR-2 target (< 20 s, excluding chain confirmation) | **met, by two orders of magnitude** |
| Audit chain | verifies for all 10 wallets after the run |
| Errors | none |

**Reading the numbers honestly.** 200 executions is exactly 20 per wallet, which is
`SYSTEM_CEILINGS.MAX_ACTIONS_PER_HOUR`. The run therefore demonstrates the execution-loop guard
doing its job: once a wallet has spent its hourly budget every further proposal is **denied**, and
the R14 breach trips the circuit breaker, which freezes the wallet (SECURITY §8 row 13). A frozen
wallet skips every later iteration, so the harness unfreezes breaker-frozen wallets between rounds —
what a live owner would do — and counts it; otherwise the "hour" would really have been ten minutes
of load. The 1,000 DENY iterations are full iterations (gather → pre-checks → context → simulate →
evaluate), not cheap early exits, which is why the p50 is 119 ms rather than single digits.

Second test in the same suite: **three *unlocked* concurrent iterations for one wallet** — the lock
removed on purpose — still produce one row per proposal hash and at most one send, proving the
executor's own idempotency (proposal hash + single-use receipt nonce) is what stops a double send,
not merely the fact that the loop is serialised.

**Not covered by this run:** paymaster-sponsored user operations (the fork harness sends
sequentially, per the Phase 5 limitation), the live Base Sepolia path, and SERV (every wallet runs
`degraded`, i.e. the deterministic path — which is the only path that produces executions, so it is
the only one that can produce a duplicate).

---

## 8. Open risks

Things that are **not** closed. Each is live at the moment this gate is signed.

1. **No 24 h cooldown on recipient / policy changes** (F-1, MEDIUM). The largest gap in this
   document. A compromised *owner wallet* can add a recipient and have it paid within the hour,
   bounded only by the per-tx and daily caps and the remaining allowance.
2. **Audit tail truncation is undetectable** (F-9, LOW, accepted with a production plan in §6.1).
3. **No real browser Smart Wallet has ever been click-tested in this environment.** Standing since
   Phase 0 (V-10), widened in Phase 7's addendum to cover the derived-companion path. Everything is
   proven with local viem accounts, a real Postgres, real SIWE signatures and three live Base
   Sepolia runs — but nobody has completed onboarding with an actual browser extension or a passkey
   Coinbase Smart Wallet here, because Coinbase's own hosted popup is currently broken
   (`postMessage` origin mismatch, an external bug confirmed not to be ours). **A human must
   confirm, against a real wallet, before any deployment that holds value:** connect works; the
   companion address `GET /api/wallet` returns matches the notice; a live spend-permission signature
   completes; and `SameSite=strict` survives the wallet popup round trip (reasoned, not observed —
   Phase 8 part 1 item 6).
4. **Telegram has never been tested against a real bot.** `TELEGRAM_BOT_TOKEN` is unset here; the
   send path is covered only by a unit test with mocked `fetch`.
5. **SERV fixture drift** (F-7) and **narrow `untrusted` coverage** (F-8), both LOW, both unchanged
   from Phase 4/6.
6. **The rate limiter is per-instance** (D-107) and **the SERV breaker is per-process**. Both match
   ARCHITECTURE §7's single-instance stance; both need a shared store before horizontal scaling.
   F-2's pool fix removes the worker's hard ceiling on wallet concurrency, but scale-out is still
   not a tested configuration.
7. **`permission.scan` only sees wallets with an active policy.** A wallet whose policy was never
   activated will not have an out-of-band revoke detected. Harmless — such a wallet cannot act — but
   it is a gap in the "no user action at all" claim.
8. **x402 (8.8) was not built.** A `SHOULD` gated on V-11 and on every MUST being green; rules
   X01–X03 do not exist, and the `x402` block in `Policy` is parsed but read by nothing.

---

## 9. Residual-risk statement — what the custody model actually guarantees

This section exists so that nobody reads the tagline *"the self-driving treasury that can't run off
with the money"* as a stronger claim than the code makes.

**What is true.** The owner's treasury keys never touch Steward. Steward cannot move funds out of
the owner treasury except through a **Spend Permission the owner signed**, which is capped per
period, expires, names the agent wallet as the only spender, and is revocable **from the owner's own
wallet with Steward entirely offline**. No LLM output can move funds: the reasoning layer has no
write tools (`check:arch`, with deliberate-violation fixtures), and the executor refuses to send
anything without a valid, unexpired, unused `AllowReceipt` minted by a pure Policy Engine at 100%
branch coverage. A fully compromised Steward backend still cannot pull more than the allowance,
proven on-chain: in the Phase 2 live run a spend after revoke was rejected by the chain itself.

**What is not true — the limitation.** The MVP's agent wallet is a **CDP server-controlled smart
account**. Its signing secret lives with Coinbase, and Steward's operator can instruct it. So:

> **Worst case is not zero. It is bounded.** An attacker who fully compromises the Steward operator
> — the CDP credentials *and* the receipt HMAC key — can move, at most, the agent wallet's USDC
> balance, plus the value of the vault shares the agent holds, plus whatever is left of the current
> period's allowance. That figure is not hidden: it is computed by `maxAtRisk` and shown to the
> owner on the dashboard as **"Maximum at risk"**. Everything beyond that number stays in the
> owner's treasury and cannot be reached.

The Policy Engine, the risk gate and the receipt scheme **do not remove this bound** — they make it
the *only* way to lose money, and they make every step of the path auditable. That is the honest
claim: Steward cannot run off with the treasury; it can, in the worst imaginable case, lose what the
owner deliberately put inside the bound.

**The production path that removes it** is already named in `ARCHITECTURE.md` §4 (OQ-2): move to
**session keys / ERC-7715 permissions on the owner's own account, so funds never leave it**. That is
designed for and not built in the MVP. Until it is, "non-custodial" is accurate about the
*treasury* and not about the agent's operating float, and the docs, the UI and the demo must keep
saying so — `SECURITY.md` §9 already does.

Three further limitations, unchanged and restated for completeness:

- **Vault smart-contract risk is not eliminated.** The allowlist only admits vetted vaults; it does
  not make them safe. R20's depeg/drawdown exit is a reaction, not a prevention.
- **LLM classifiers are probabilistic** and are never the last line of defence (RR-4, RR-5).
- **DEMO_MODE numbers prove nothing about real funds.** `MockUSDC` is mintable without limit by the
  demo admin, fenced to chain 84532, with a persistent DEMO DATA banner (I11). Phase 9's copy must
  not imply otherwise.

---

## 10. Verdict

**No HIGH finding. The Phase 8 Opus review gate PASSES.**

- Threat matrix T1–T17: every threat maps to deterministic code with named test evidence (§2). No
  threat rests on the LLM layer.
- `SECURITY.md` §8 failure matrix: **19/19 rows executed**, 17 PASS, 2 MITIGATED-WITH-RESIDUAL-RISK
  (rows 3 and 4 — both are the custody model being honest, not defects), 0 FAIL, 0 skipped (§3).
- New red-team attempts RT-1…RT-5: 5 attempted, 3 clean, **2 produced fixes** — the freeze-nonce
  ordering (an I7 denial-of-control) and the Telegram chat-id narrowing (§4).
- Residual risks RR-1…RR-17: 8 closed, 7 accepted as documented limitations, 2 open and carried as
  LOW findings (§5).
- Load/soak: 1,200 concurrent iterations across 10 wallets over a simulated hour,
  **0 duplicate executions**, p95 **210 ms** against a 20 s target, and one genuine MEDIUM bug found
  and fixed (F-2, the shared connection pool) (§7).
- Findings: 1 MEDIUM open (F-1, a control the spec itself labels `should-have`), 1 MEDIUM fixed
  (F-2), 7 LOW (§6).

**F-1 is the one thing a reader should carry forward.** It does not block this gate — the primary
control for that row, an owner signature, is built and tested — but it is the largest named gap in
Steward's security story and it should be specified as a Policy Engine rule rather than bolted on.

Signed off as the Phase 8 review gate. Phase 9 must not treat any item in §8 as closed.
