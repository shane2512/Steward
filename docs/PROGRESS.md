# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: **Phase 7 complete** (7.10 skipped by human decision), awaiting human "continue". Phase 8
requires Opus (Sonnet sub-tasks 8.5, 8.6 per PHASES.md).
Required model: Phase 7 = Sonnet (Opus sub-tasks 7.6, 7.8 — both done)
Last updated: 2026-09-22

**7.8 note:** the Opus agent's post-close-out visual QA/screenshot pass was cut short on the human's
instruction (time/cost) after it had already fixed real bugs it found; two test files it left mid-edit
(`shell.test.tsx`, `settingsScreen.test.tsx` — the freeze/unfreeze tests needed a `wagmi` mock once the
real components replaced the placeholders) were finished and verified by the orchestrator directly.
Full gate re-run clean after that fix: typecheck 9/9, lint clean, check:arch 0 real violations
(364 modules, all fixtures firing), test **1012 passed** + policy 344/344 at 100% branches, adversarial
48/48 guarantee. No secrets in git history; `docs/design/Photos/` never committed.

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| 0 | Verification spike & repo bootstrap | Sonnet | ✅ | 2026-09-20 | V-10 partial (no real Smart Wallet), V-13 false->MockPriceFeed, V-09 fallback; human approved carrying V-10 to Phase 1.8/7.6 | | |
| 1 | Monorepo foundation, DB, auth | Sonnet (+Opus 1.9) | ✅ | 2026-09-20 | Gate green: typecheck 9/9, lint clean, check:arch 53 modules/63 deps 0 violations, test 7 files/43 tests |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9, lint clean, check:arch 86 modules/152 deps 0 violations, test 16 files/164 tests, contracts:test 16/16. Mocks live on 84532; live spend + revoke done through product code |
| 3 | Policy Engine & mandate validator | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9, lint clean, check:arch 129 modules/278 deps 0 violations + both violation fixtures fire, test 24 files/508 tests, `packages/policy` **100% branches (411/411)** enforced in its own vitest config |
| 4 | SERV reasoning & injection defenses | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9, lint clean, check:arch 153 modules/371 deps 0 violations + all three violation fixtures fire, test 32 files/621 tests (policy still 100% branches), `pnpm test:adversarial` **60 cases, guarantee 48/48 (100%), benign FP 0/12 (0%)**, live SERV smoke recorded (request ids below). 4.11 skipped (V-09 not confirmed) |
| 5 | Risk gate, executor, confirmer | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9 + scripts/live, lint clean, check:arch 170 modules/430 deps 0 violations + all **four** violation fixtures fire, test 35 files/673 tests (policy still 100% branches), `pnpm test:adversarial` still 60 cases / 48-48 guarantee, fork suite **2 files / 9 tests** (opt-in), and a LIVE Base Sepolia run: pull → deposit → payment → sweep, all through `executor.ts` (tx hashes below) |
| 6 | Decision loop, scheduler, obligations, risk exits | Opus | ✅ | 2026-09-21 | Gate green: typecheck 9/9 + scripts/live, lint clean, check:arch **193 modules / 528 deps** 0 violations with **no rule changes** + all four fixtures fire, test **37 files / 735 tests** (policy still 100% branches), `pnpm test:adversarial` still 60 cases / 48-48 guarantee, Phase 6 fork suite **17/17** (opt-in), and a LIVE unattended Base Sepolia run through the real worker (below) |
| 7 | Web app UX | Sonnet (+Opus sub-tasks) | ✅ | 2026-09-22 | 7.10 skipped by human decision (SHOULD, not MUST) |
| 8 | Owner controls, notifications, hardening, security review | Opus (+Sonnet sub-tasks) | ☐ | | |
| 9 | Demo, deployment, docs, submission | Sonnet (+Opus gate) | ☐ | | |

## Phase 6 — tasks (all done 2026-09-21)
- [x] 6.1 `runIteration(deps, walletId, trigger)` in `apps/worker/src/loop.ts` — ARCHITECTURE §5 in
  order: lock → frozen/breaker SKIPPED → unresolved-execution SKIPPED → gather → PreChecks →
  screen → propose → verify → simulate → evaluate → ALLOW/ESCALATE/DENY. An audit row at **every**
  step (`SKIPPED`, `CONTEXT`, `PROPOSAL`, `VERIFICATION`, `SIMULATION`, `VERDICT`, `RECEIPT`, then
  the executor's `EXECUTION_*`), and an `Err` from `appendAudit` aborts the iteration before
  anything can be sent (I5/I6). The clock is injected throughout; no `Date.now()` decides anything.
  The frozen check runs BEFORE the context is built, so freezing stops the loop with the RPC, the
  oracle and SERV all down (I7) — proved by a test whose `PublicClient` rejects every call.
- [x] 6.1 (lock) `apps/worker/src/lock.ts` — a **session** advisory lock on a dedicated pooled
  connection, namespace **`0x4C4F4F50` ('LOOP')**, deliberately distinct from the audit chain's
  `0x41554454` ('AUDT'): the loop holds its lock across `appendAudit` calls, which take their own,
  and a shared namespace would deadlock on a key-hash collision. A tick that cannot take the lock
  does **nothing** rather than queueing behind the running iteration.
- [x] 6.2 `apps/worker/src/prechecks.ts` — PURE (no I/O, no SERV, no db, injected clock). Priority:
  (a) risk trigger ⇒ `risk_exit`; (b) obligation due ⇒ `pay_recipient`, preceded by the funding
  step it needs (`pull_allowance`, else `vault_withdraw`) and never half-paid; (c) idle cash above
  `runwayBuffer + obligations30d` ⇒ `pull_allowance` then `vault_deposit`, keeping the 7-day payroll
  float liquid and respecting R09 head-room. (c) exists because D-37 recorded that the live model
  returns `noop` for idle deployment. Every deterministic proposal still goes through `buildCalls`,
  the risk gate, the **real** `evaluate()`, a signed AllowReceipt and the executor — it skips only
  the LLM proposer and (via R15's `source` exemption) the shadow verifier.
- [x] 6.3 Discretionary path: `screenUntrusted` → `propose` → `verify` → `runPipeline`. `risk_exit`
  is **removed from the kinds SERV may choose** (`DISCRETIONARY_KINDS`), which closes the Phase 4
  known issue without a prompt change — see D-52.
- [x] 6.4 `apps/worker/src/approvals.ts` + `POST /api/approvals/:id/approve`. The SECURITY §5 message
  lives once, in `@steward/shared/approval.ts`, and is used by both sides. The signature is verified
  **twice** — in the route (so a bad one never reaches the database) and again in the worker from
  the stored bytes, before `ownerApproval` is built (RR-1). Refusals: not pending, expired, policy
  version changed, signer ≠ owner, owner ≠ policy treasury, proposal-hash mismatch. A policy version
  change also cancels every pending approval (`cancelApprovalsForPolicyChange`).
- [x] 6.5 `apps/worker/src/jobs.ts` — `loop.tick` (cron every minute; in DEMO_MODE the handler also
  queues a `singletonKey`'d half-step at +30 s, because cron's floor is one minute), `loop.run`,
  `obligations.scan` (hourly, idempotent next-occurrence), `risk.scan` (every minute: vault + price
  snapshots, flags the vault so R04 refuses new deposits, notifies, triggers the loop),
  `approvals.expire` (every 5 min), `approvals.execute`, and a **DEMO_MODE + chain 84532 only**
  `price.refresh` that re-publishes the MockPriceFeed quote so R12 does not fail closed on stage
  (Phase 5 found the mock quote 41,828 s old).
- [x] 6.6 Crash safety — `resumeCrashWindow()` runs on worker boot, before the first tick: every
  `pending`/`submitted` row goes through Phase 5's `reconcileExecution`. A row with a hash is handed
  back to the confirmer with the decision's stored `expectedDeltas`; a hash-less one is decided by
  the on-chain scan and is **never re-sent**. Until a wallet's executions are resolved,
  `runIteration` refuses to propose at all.
- [x] 6.7 Degraded mode — `ServBreaker` (3 consecutive SERV failures open it, 5-minute cooldown, one
  success closes it). While open only deterministic proposals run, and the heuristic half of the
  injection screen still runs (a classifier being down never clears a signal, I5). Transitions write
  `SERV_DEGRADED` / `SERV_RECOVERED` to the **system** audit chain, and `GET /api/wallet` returns
  `degraded` by reading the latest transition — no new column, and the flag is as auditable as
  everything else (D-53).
- [x] 6.8 Routes in `apps/web`: `POST /api/agent/run`, `GET /api/decisions`, `GET /api/decisions/:id`,
  `GET /api/approvals`, `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/reject`, plus
  `degraded` on `GET /api/wallet`. The web app **enqueues**; it never decides.
  `apps/web/lib/queue.ts` is the only link to the worker (a pg-boss insert), so `apps/web` imports
  no decision loop, no reasoning and no executor — `check:arch` passes with **no rule changes**.
- [x] 6.9 Step timings — elapsed ms per named step (`gather`, `screen`, `propose`, `verify`,
  `pipeline`) as one structured pino line and in `agent_decisions.serv_meta`. No OpenTelemetry
  dependency for six numbers (D-54).
- [x] RR-12 — `tripBreaker` is now called on an R14 rate-limit breach, inside `runPipeline`, right
  after the verdict. The confirmer's breaker only counts *failures*; a refusal loop would otherwise
  never open it.

## Phase 6 Exit Gate result (2026-09-21)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks + `scripts/live` tsconfig |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style!" |
| `pnpm check:arch` | ✅ 0 violations (**193 modules, 528 dependencies**), **no rule changes**; all four fixtures fire (`policy-only-shared`, `reasoning-no-wallet-db`, `owner-path-no-reasoning`, `cdp-only-in-wallet-bootstrap`); purity lint fixture 10 problems |
| `pnpm test` | ✅ **37 files / 735 tests passed**, 3 files / 26 skipped (the three opt-in fork suites); `packages/policy` still **100% branches (411/411)**, 8 files / 344 tests |
| `pnpm test:adversarial` | ✅ unchanged — 60 cases, guarantee **48/48 (100%)**, benign FP **0/12**, screen recall 35/40 |
| Phase 6 fork suite (opt-in) | ✅ `STEWARD_FORK=1 npx vitest run apps/worker/test/fork` — **17/17 passed** |
| Phase 5 fork suite (opt-in) | ✅ still 2 files / 9 tests — all three fork files together: **3 files / 26 tests** |
| `pnpm contracts:test` | ✅ **21/21** (16 carried + 5 for the new MockUSDC) |
| live unattended run | ✅ see "Live unattended run" below |

New Phase 6 test files: `apps/worker/test/prechecks.test.ts` (**30**, pure — no network, no db),
`apps/worker/test/loop.test.ts` (**32**, real Postgres), `apps/worker/test/fork/loop.fork.test.ts`
(**17**, opt-in fork + real Postgres).

Required cases from PHASES 6 "Tests", and where each lives:

| Required case | Test |
|---|---|
| DEMO golden table end to end | `fork/loop.fork.test.ts` x6: idle-cash deposit ALLOW, payroll ALLOW, vault drawdown ⇒ R20 `risk_exit`, injected memo ⇒ DENY (R16+R15), fabricated recipient ⇒ blocked pre-engine, over-threshold ⇒ ESCALATE → owner signature → ALLOW |
| SERV outage ⇒ deterministic payments still execute | `fork` › "6.7 — with SERV down, a scheduled payment still executes" (+ "a DISCRETIONARY situation produces a NOOP, never a guess") |
| worker killed mid-execution ⇒ resumes without duplicate | `fork` › "6.6 — a crash between claim and send is reconciled, and NOTHING is re-sent" |
| concurrent triggers ⇒ single iteration | `loop.test.ts` › "concurrent triggers produce exactly ONE iteration" (5 parallel, 1 enters) + the namespace and release-on-throw tests |
| approval replay / expired / wrong signer / wrong policy version | `loop.test.ts` x6 and `fork` x3 ("cannot be executed twice", "signed by the WRONG key", "a policy version bump between signing and execution") |
| policy version change cancels pending approvals | `loop.test.ts` › "a policy version change cancels every pending approval and audits each one" |
| frozen ⇒ SKIPPED with nothing sent | `loop.test.ts` › "SKIPPED when frozen, without touching the chain, and nothing is sent" |
| never re-propose while an execution is unresolved | `loop.test.ts` x2 + `fork` › "a second iteration while the first execution is unresolved sends nothing" |
| every loop step writes its audit row; `verifyChain` passes after a full run | `fork` › the golden deposit asserts the exact event sequence `CONTEXT, PROPOSAL, SIMULATION, VERDICT, RECEIPT` plus `EXECUTION_PENDING/SUBMITTED/CONFIRMED`; "the whole audit chain verifies after a mixed run" |
| all unit tests run without network | `prechecks.test.ts` (26) imports nothing with I/O |

Two real bugs were found by these suites and fixed, both worth naming:
1. **R17 made approvals un-executable.** `gather` feeds R17 both executed and merely *decided*
   proposal hashes (so the loop does not re-propose something already waiting on a human). On the
   approval path that set always contains the proposal being approved, so every approval was denied.
   The approval path now uses the execution-derived set only; the "already executed" half of R17 is
   untouched and `claimExecutionSlot`'s unique index is still the backstop (I10).
2. **`resumeCrashWindow` sent to a queue that did not exist yet.** It runs before `registerJobs` on
   boot, so `boss.send('exec.confirm')` threw `Queue exec.confirm does not exist` and killed the
   worker at startup — found by the first live run, fixed with an idempotent `createQueue`, and
   covered by an assertion in the fork crash-window test.

A further **three** defects were found by the live runs themselves, and none of the suites would
have caught them, which is the argument for the live gate existing at all:

3. **Every executed decision was recorded as `status: 'noop'`**, because the post-pipeline write
   that stores the 6.9 timings passed `status` and overwrote what `runPipeline` had just set. A
   deterministic NOOP was also mislabelled `proposal_source: 'serv'` when no model had been called.
   Reporting bugs, not control bugs — nothing moved that should not have — but the Phase 7 timeline
   would have lied about what the agent did. The fork suite now asserts the decision row's status,
   source and timings for both an ALLOW and a DENY.
4. **The loop never went quiescent: 100 decision rows in 10 minutes.** A tick with nothing to do was
   creating an `agent_decisions` row plus `CONTEXT` and `PROPOSAL` audit rows. DATA_MODEL is
   explicit that the table holds "one per loop iteration **that reached reasoning or a deterministic
   proposal**" — a quiet tick reached neither. It now writes exactly **one** audit row (`NOOP`,
   carrying the context hash that proves what the agent was looking at) and no decision row.
   `runIteration`'s noop outcome carries `decisionId: null`.
5. **The DEMO half-step self-perpetuated.** The half-step handler queued another half-step, so every
   cron tick started a self-perpetuating chain and the chains accumulated one per minute — roughly
   100 iterations in 10 minutes instead of 20. The tick payload now carries `half: true` and only a
   cron tick spawns one. (`singletonKey` did not save us: on a standard-policy pg-boss queue it is
   not a uniqueness constraint — D-59.)

Neither (4) nor (5) touched the policy path: every quiet tick still ran the full gather and
pre-check, and no proposal ever skipped the engine. The cost was bounded growth of rows that said
nothing happened. Covered now by the fork test "goes QUIESCENT once the work is done" (drive the
demo to completion, tick 8 more times, assert zero new executions, zero new decision rows, exactly
8 `NOOP` audit rows and an intact chain) and two unit tests pinning the one-shot tick payload.

### Live unattended run on Base Sepolia (2026-09-21) — `STEWARD_LIVE=1 pnpm live:loop 10`

**Duration achieved: 10 minutes**, unattended, through the **real worker** — `registerJobs()` with
pg-boss cron, the per-wallet advisory lock, the real ContextBuilder, the real PreChecks, the real
Policy Engine, real `eth_simulateV1`, real AllowReceipts, the real executor sending real user
operations through CDP, and the real confirmer. The script sets the world up and then only watches;
it proposes, evaluates and sends nothing itself.

Funding note: Circle's testnet USDC comes from a CDP faucet that is rate-limited per project and was
exhausted, so this run used the **DEMO MockUSDC pair** that DEMO.md prescribes for exactly this case
(`docs/addresses.md`), pointed at with shell overrides rather than an edit to `.env.local`. That let
the run use DEMO.md's real "Startup Operating" numbers instead of faucet dust.

| | |
|---|---|
| agent wallet (CDP smart account) | `0x75cDd4056a7f7479bBaAB2376a93d3aBe2Bb7dCa` |
| owner treasury (Coinbase Smart Wallet) | `0x9Ab29F890D6172A501f3Ff57ddE930d5Fa757289` |
| wallet id | `cd30b339-64bd-4b09-bfde-33b809ac7aa4` |
| policy version | `1789983699` |
| spend permission hash | `0x4951c9c4933c38bcc58c2eab8602f6f1fc0d004639c8877d889dcf9396216fc4` |
| token / vault | MockUSDC `0x1ba0af42256425d1F9Eb03aA804048593E23926a` / MockVault `0xc1eb5AF474e99Dd78e8137bd9164A522C60A7Be1` |
| policy (DEMO.md "Startup Operating") | treasury 200,000 · buffer 120,000 · per-tx 50,000 · daily 60,000 · approval threshold 15,000 (60,000 for `vault_deposit` / `pull_allowance`) · allowance 50,000/day · payroll Alex 3,000 + Priya 2,500 due today |

**Six autonomous actions, all confirmed, in the first 180 seconds** — every one simulated with
`eth_simulateV1`, judged ALLOW by the real `evaluate()` with all 22 rules PASS, issued a real
`AllowReceipt` bound to the calls hash, executed by `executor.ts` and confirmed by the confirmer
against the **measured** on-chain deltas:

| t | Action | Amount | Tx |
|---|---|---|---|
| t+45s | `pull_allowance` | 3,000 | `0xe7e52ce42830c2cd512ceeceea8419602c7cda59ebe9d86805a95601eae7cd1e` |
| t+75s | `pay_recipient` Alex | 3,000 | `0x79653b128511c6807ae1a6c2ec8ded8261388125e56d9cc00c0adca387542326` |
| t+105s | `pull_allowance` | 2,500 | `0x5fc74d42bc24e856dfed42a52a6317fbeb07c7b3da40c27b13a19e08417e5c02` |
| t+135s | `pay_recipient` Priya | 2,500 | `0x83521e59754d62de4b8b7445eae0f4cb26b9d30598ff178ea8a042d44430e0f1` |
| t+165s | `pull_allowance` | 44,500 | `0x2a8a99ec1735d500bfde1baf3a1e28eae8041f5c604c1e9f9614ca03eed5933d` |
| t+180s | `vault_deposit` → v1 | 44,500 | `0x40fb85dbee42b85a57e37937742fb8e20c929bf175eb3f80e055953c38d78743` |

The arithmetic is the agent's, not the script's: with payroll due it funded and paid first
(PreChecks priority b before c), then computed `200,000 − 5,500 paid = 194,500 liquid`,
`194,500 − 120,000 buffer = 74,500 deployable`, and pulled `min(74,500, allowance remaining 44,500,
per-tx 50,000)` = **44,500** — the audit row reads
`"reason": "74500000000 base units deployable above the buffer"` — before depositing it. That is
DEMO.md's "pull → deposit → payroll" beat, in the safer order (RR-15).

After the sixth action the loop correctly went quiet: every subsequent tick recorded a deterministic
NOOP — `"nothing idle above the buffer, nothing due, no risk events, allocations within caps"` —
and **made no SERV call at all**, which is the SERV §7 budget rule working.

Also exercised for real in this run:
- **`resumeCrashWindow` on boot** found the Phase 5 live run's unresolved `sweep_home` row,
  reconciled it to `timeout` (UNCERTAIN) and **did not resend it**. The breaker counter was not
  touched, because a timeout is uncertainty, not a failure.
- **6.6 blocking** — every tick that arrived while an execution was still `submitted` wrote
  `SKIPPED: execution … is still submitted` instead of proposing.
- **DEMO `price.refresh`** re-published the MockPriceFeed quote every minute, so R12's 60-second
  freshness rule passed on every priced action. Without it the Phase 5 quote was 41,828 s old and
  every one of these would have failed closed.
- **6.9 step timings** — e.g. `{"gather":2239,"pipeline":4848}` ms.

**Two bugs this run found**, both fixed and now covered by the fork suite:
1. `resumeCrashWindow` sent to `exec.confirm` before `registerJobs` had created the queue, which
   killed the worker at boot (found on the first attempt; fixed with an idempotent `createQueue`).
2. Every executed decision was recorded as `status: 'noop'`, because the post-pipeline write that
   stores the 6.9 timings passed `status` and overwrote what `runPipeline` had just set. A
   deterministic NOOP was also mislabelled `proposal_source: 'serv'`. Both are reporting bugs —
   nothing moved that should not have — but they would have made the Phase 7 timeline lie.

Closing numbers from the run's own report (`ran for 603s`):

| | |
|---|---|
| executions created this run | **6, all `confirmed`** (the 10th row is Phase 5's `sweep_home`, reconciled to `timeout` on boot) |
| audit chain | **OK — 245 rows**, head `0x2b170e157aa7b3dcae048019dfb2aa25cf5893d75f11c4f2a1fd05ac7d11832c` |
| NFR-4 replay | **6/6 decisions replayed identically** (every decision that reached a verdict) |
| end state | agent 0 · vault shares 44,500,000,000 · treasury 150,000 mUSDC |

Earlier attempts, recorded because Phase 9 will hit the same wall: two runs were lost to testnet
funding rather than to code — the CDP USDC faucet is rate-limited per project, and a random
per-run owner key stranded that run's USDC at an address whose key was gone (fixed by D-58, then by
the MockUSDC pair).

### Live run 2 — quiescence, after the churn fixes (2026-09-21)

Same command, same wallet, same demo token pair. The point of this run was **not** to move money
again — the first run's 50,000 of outflows were still inside R07's rolling 24-hour window, so the
daily cap legitimately refused everything — but to prove the loop goes **quiet** instead of asking
the same refused question every 30 seconds.

| | run 1 (before the fixes) | run 2 (after) |
|---|---|---|
| iterations | ~100 in 10 min | **22 in 10 min** — the cron + half-step cadence, nothing more |
| `agent_decisions` rows written | **100** | **1** (the one `pay_recipient` that R07 refused) |
| audit rows per quiet tick | 2 (`CONTEXT` + `PROPOSAL`) | **1** (`NOOP`) — 21 of them |
| executions | 6 | 0 — correctly: the daily cap was already exhausted |

Its closing verification (`ran for 601s`):

| | |
|---|---|
| audit chain | **OK — 365 rows**, head `0x61e3cdc5e1d5efd9a7f84854f2990cb9b13c86283a71c88646223b8268624d88` |
| NFR-4 replay | **29/29 decisions replayed identically** — every decision this wallet has ever taken that reached a verdict, ALLOWs and DENYs alike, re-evaluated from the append-only chain |
| end state | agent 2,250 · vault shares 44,500,000,000 · treasury 147,750 mUSDC |

(The single non-confirmed execution is Phase 5's `sweep_home`, reconciled to `timeout` on the first
boot and correctly never resent.)

The `NOOP` rows say exactly why the agent is parked, which is the part that matters:

```
the only available action (pay_recipient: obligation f5ec7ad7-… due 2026-09-21)
was already decided in the last 24h; R17 would refuse a repeat
```

Three separate causes of churn, all fixed at the root and all covered by tests:
1. a quiet tick no longer writes a decision row at all (DATA_MODEL's own rule — D-59);
2. the DEMO half-step no longer spawns another half-step (D-59);
3. PreChecks no longer rebuild a proposal already inside R17's window (RR-14).

None of them touched the policy path. Every tick still ran the full gather and pre-check, and no
proposal ever reached the executor without a verdict and a receipt.

**Coverage, stated honestly.** Run 1 proved the six-action sequence end to end on Base Sepolia but
predates the churn fixes; run 2 proves quiescence on the fixed code but had no headroom left to act.
What covers *both* on the fixed code is the fork test `goes QUIESCENT once the work is done`, which
drives the demo to completion against forked Base Sepolia state — real MockVault, real USDC, real
`eth_simulateV1`, real receipts, real executor — and then ticks eight more times asserting zero new
executions, zero new decision rows and exactly eight `NOOP` audit rows. A third live run on a fresh
wallet (`STEWARD_LIVE_USER_ID=<uuid> pnpm live:loop`) would close the last gap and is the first
thing to do when the 24-hour outflow window rolls.

## Phase 6 — Opus review gate

**Q1 — Trace one ALLOW and one DENY end to end through the audit rows, and show the decision is
REPRODUCIBLE from the stored snapshot + policy version (NFR-4).**

Reproducibility is not asserted here, it is *executed*: `replay(db, decisionId, walletId)`
(`apps/worker/src/replay.ts`) re-runs the **same** `evaluate()` the loop calls, on inputs read back
out of the **append-only, hash-chained** `audit_log` — not out of the mutable tables. `runPipeline`
writes the complete `EvaluationInput` into the `VERDICT` audit row (`evaluationInput`: proposal,
`now`, chainId, allowMainnet, demoStableParity, state, ledger, simulation, verifier, screen,
contextFactIds, ownerApproval), minus the policy body, which is referenced by `policyVersion` and is
itself immutable once activated. `replay` revives the three `Date` fields, re-parses with
`zEvaluationInput`, re-evaluates, and compares **every rule result**, not just the verdict.

The ALLOW trace (fork test "NFR-4 — an ALLOW replays identically…"), one deposit:

```
audit_log for entity_type='decision', entity_id=<decisionId>   (in order)
  CONTEXT     contextHash 0x…, trigger schedule, preCheck deterministic, factIds […], policyVersion 1
  PROPOSAL    kind vault_deposit, source deterministic, params {vaultId v1, amount 200000000}
  SIMULATION  callsHash 0x…, ok true, deltas [{agent, -200000000}]
  VERDICT     ALLOW, policyVersion 1, 22 rule results, evaluationInput {…}
  RECEIPT     proposalHash 0x…, callsHash 0x…, nonce <uuid>, expiresAt …
audit_log for entity_type='execution', entity_id=<executionId>
  EXECUTION_PENDING    calls + receipt nonce, written BEFORE the broadcast
  EXECUTION_SUBMITTED  userOpHash / txHash
  EXECUTION_CONFIRMED  measured deltas matched
replay() ⇒ identical: true, differences: []   (asserted)
verifyChain(walletId) ⇒ ok                    (asserted)
```

The DENY trace (fork test "golden: an injected memo cannot move money…"):

```
  CONTEXT     untrusted U_1 = the fenced memo; screen.injectionSuspected true
  PROPOSAL    kind pay_recipient, source serv, recipientId alex, amount 40000000
  VERIFICATION DISAGREE
  SIMULATION  ok true
  VERDICT     DENY — R16 DENY (injection + value to a non-treasury holder),
                      R15 DENY (verifier DISAGREE)
  (no RECEIPT row, no execution row, sender never called)
replay() ⇒ identical: true, differences: []   (asserted in the same test)
```

Both assertions are `expect(replayed.value.identical).toBe(true)` with `differences` printed on
failure, and the live runner repeats the exercise over **every** decision a real run produced.
`replay` refuses to guess: a decision with no `VERDICT` row, a `VERDICT` row without the stored
inputs, or a missing policy version are all `Err`, each covered by a test.

**Q2 — Prove no shortcut path exists from SERV output to the executor.**

```
$ grep -rn "signReceipt" --include=*.ts packages/*/src apps/web apps/worker/src
packages/policy/src/receipt.ts:79:export function signReceipt(      # the only issuer
packages/wallet/src/sweepHome.ts:237:  const receipt = signReceipt(…)   # owner path
apps/worker/src/pipeline.ts:260:  const receipt = signReceipt(…)      # agent path

$ grep -rn "execute(" --include=*.ts packages/*/src apps/web apps/worker/src
packages/wallet/src/executor.ts:105:export async function execute(   # the only executor
packages/wallet/src/sweepHome.ts:240:  const executed = await execute(
apps/worker/src/pipeline.ts:274:  const executed = await execute(

$ grep -rn "runPipeline(" --include=*.ts apps packages
apps/worker/src/approvals.ts:202   apps/worker/src/loop.ts:391

$ grep -rln "@steward/reasoning" apps/worker/src apps/web
apps/worker/src/loop.ts      # propose / verify / screen
apps/worker/src/runtime.ts   # constructs the SERV client, nothing else
```

So: `packages/wallet/src/executor.ts:243` (`sender.send`) is still the only line in product code that
can broadcast a proposal's calls, and it is only reachable through `execute()`, which is only
reachable with a verified `AllowReceipt`. `signReceipt` refuses any verdict whose
`decision !== 'ALLOW'`, and its two callers are the owner sweep and `runPipeline` — which is the
*only* function in Phase 6 that calls `evaluate()` on the agent path, and the only one either the
loop or the approval handler can reach. A SERV proposal and a deterministic one enter that function
through exactly the same parameter.

Structurally, `packages/reasoning` cannot import `packages/wallet` or `packages/db`
(`reasoning-no-wallet-db`), `packages/context` cannot either (`context-no-wallet-db`), and
`packages/wallet` cannot import `packages/reasoning` (`wallet-no-reasoning` /
`owner-path-no-reasoning`). `apps/web` imports **no** reasoning and **no** loop at all: its only
link to the worker is a pg-boss insert in `apps/web/lib/queue.ts`. `pnpm check:arch` passes with
**zero rule changes for Phase 6** (193 modules, 526 dependencies), and all four deliberate-violation
fixtures still fire.

One thing did move: SERV is no longer offered `risk_exit`. `DISCRETIONARY_KINDS` in `loop.ts` omits
it, so a model-authored risk exit cannot exist, which is both the fix for the Phase 4 verifier
defect and one fewer kind on the LLM's menu (D-52).

**Q3 — Prove two loops can never run concurrently for one wallet.**

`apps/worker/src/lock.ts` takes `pg_try_advisory_lock(0x4C4F4F50, hashtext(walletId))` on a
**dedicated connection checked out of the pool**, because a session lock must live on one
connection and an iteration spans many statements and a chain round trip. `try_` not `pg_advisory_lock`:
a tick that cannot take the lock does nothing at all rather than queueing behind the running one —
a tick that arrives mid-iteration has nothing new to say. The lock is taken in exactly **one** place,
`runLocked` in `jobs.ts`, which wraps both `runIteration` and `executeApproval`; `runIteration`
itself never touches the lock, so there is no second owner to get out of step. Release happens in a
`finally`, and even a failed unlock statement ends the lock, because releasing the connection ends
the session.

The namespace is deliberately **not** the audit chain's `0x41554454` ('AUDT'): the loop holds its
lock across every `appendAudit` call, each of which takes `pg_advisory_xact_lock` on its own chain
key, and sharing a namespace would let two different keys collide into a deadlock.

Evidence (`apps/worker/test/loop.test.ts`, real Postgres): the namespace assertion; "a second
acquisition for the same wallet is refused while the first is held" (and succeeds again after
release); "a different wallet is not blocked"; "concurrent triggers produce exactly ONE iteration"
(5 parallel `withWalletLock` calls, `entered === 1`, exactly one `acquired`); "releases the lock even
when the body throws".

Belt and braces beneath the lock: `claimExecutionSlot` still makes the receipt nonce and
`(wallet_id, proposal_hash)` single-use in one transaction (I10), so even a lock failure could not
produce a double send — proved in Phase 5 by five parallel `execute()` calls yielding one send.

**Q4 — Where the deterministic path could still go wrong (recorded, not hidden).** See RR-13–RR-16
under "Known issues".

## Phase 5 — tasks (all done 2026-09-21)
- [x] 5.1 `packages/risk/src/simulate.ts` — `simulateProposalCalls` via **`eth_simulateV1`** (viem
  `simulateCalls`), the only option that carries state across the calls of one action (`approve` then
  `deposit`). Deltas are **measured**, not inferred: the same simulated block runs `balanceOf` for
  agent/treasury/recipient before and after the real calls. `extractApprovals` decodes every ERC-20
  approval from the calldata so R18 has something to see (Phase 3 flagged this as a Phase 5
  obligation). No weaker fallback: an RPC without `eth_simulateV1` is an `Err` (D-40).
- [x] 5.2 `packages/risk/src/oracle.ts` — `PriceAdapter` + `mockPriceFeedAdapter`, refused at
  construction time unless `DEMO_MODE` **and** chainId 84532 (I11). Every quote carries `demo: true`
  so the UI can show the DEMO DATA banner. No real-feed adapter is shipped (V-13: Pyth needs a keyed
  endpoint); the interface is the seam for mainnet.
- [x] 5.3 `packages/risk/src/triggers.ts` — `detectRiskTriggers`, pure, bigint, multiplication-only
  bps maths (`drop * 10_000 >= bps * previous`, no division, no rounding window). Drawdown vs the
  previous `vault_snapshots` row; depeg in either direction flags every vault holding the asset.
- [x] 5.4 `packages/wallet/src/executor.ts` — AGENTKIT §4 exactly: build → verify receipt (MAC,
  injected clock, policyVersion, walletId, proposalHash, **callsHash of the freshly built bytes**) →
  simulation-parity check → atomic nonce burn + execution claim → **fresh** frozen/breaker re-read →
  parity + `assertAllowedTargets` again → send → store userOp hash *and* tx hash. The send capability
  is the `TxSender` port declared inside the module (D-42), so "only the executor sends" holds for
  the CDP smart account, the fork's local account and any future signer.
- [x] 5.4 (arch) `.dependency-cruiser.cjs` gained **`cdp-only-in-wallet-bootstrap`** (only
  `packages/wallet/src/agentkit.ts`, `apps/web/lib/wallet.ts` and `scripts/live/` may import
  `@coinbase/cdp-sdk` / `@coinbase/agentkit`) and **`owner-path-no-reasoning`**. Both have
  deliberate-violation fixtures that `pnpm check:arch` now **requires** to fire (4 of them).
- [x] 5.5 `packages/wallet/src/confirmer.ts` + the `exec.confirm` pg-boss handler in `apps/worker`
  (registration only; scheduling is Phase 6.5/6.6). 3-minute poll, status transitions, effect
  verification, `ledger_entries`, breaker counter, obligation status, an audit row per transition.
  A timeout marks the execution `timeout` (= UNCERTAIN / needs-reconcile), alerts, and **never**
  resends.
- [x] 5.5 (crash window) `packages/wallet/src/reconcile.ts` — `listCrashWindow` +
  `reconcileExecution`: the lookup that decides whether a hash-less `pending` row ever reached the
  chain. Never sends.
- [x] 5.6 `packages/wallet/src/errors.ts` — `Retryable` (network, sponsorship) with backoff
  1/2/4/8 min, max 4 attempts, **same execution row**; `Fatal` (revert, parity mismatch, bad receipt,
  frozen) ⇒ FAILED, no retry. Nothing is caught and ignored anywhere in the phase.
- [x] 5.7 Circuit breaker — 3 consecutive FAILED ⇒ `breaker_open = true`, `frozen = true`,
  notification row, audit `BREAKER_OPEN`. `tripBreaker()` is exported for Phase 6's R14 breach.
- [x] 5.8 `sweepHome(walletId)` — plain async function, owner path: reads balances and positions,
  builds the `source: 'owner'` proposal in code, simulates it, runs the **real `evaluate()`**, signs a
  receipt and goes through the executor. Works while frozen (R01 exception + the executor's own
  owner-sweep exception) and imports no reasoning (rule + fixture).

## Phase 5 Exit Gate result (2026-09-21)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks + `scripts/live` tsconfig |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style!" |
| `pnpm check:arch` | ✅ 0 violations (**170 modules, 430 dependencies**); all **four** fixtures fire: `policy-only-shared`, `reasoning-no-wallet-db`, **`owner-path-no-reasoning`**, **`cdp-only-in-wallet-bootstrap`**; purity lint fixture 10 problems |
| `pnpm test` | ✅ **35 files / 673 tests passed**, 2 files / 9 skipped (the two opt-in fork suites); `packages/policy` still **100% branches (411/411)** |
| `pnpm test:adversarial` | ✅ unchanged — 60 cases, guarantee **48/48 (100%)**, benign FP **0/12** |
| fork integration suite (opt-in) | ✅ `STEWARD_FORK=1 npx vitest run packages/wallet/test/fork` — **2 files / 9 tests passed**: the Phase 2 calldata suite (4) plus the new Phase 5 chain (5): deposit, withdraw, payment, a revert caught by the simulation, and `sweepHome` while frozen |
| live on Base Sepolia | ✅ `STEWARD_LIVE=1 pnpm live:executor` — 4 actions through the executor (below) |

New Phase 5 test files: `packages/risk/test/risk.test.ts` (13), `packages/wallet/test/executor.test.ts`
(26, real Postgres), `packages/wallet/test/confirmer.test.ts` (13, real Postgres),
`packages/wallet/test/fork/executor.fork.test.ts` (5, opt-in).

Required cases from PHASES 5 "Tests", and where each lives:

| Required case | Test |
|---|---|
| deposit / withdraw / pay / sweep happy paths on a fork | `fork/executor.fork.test.ts` ×4 (+ the live run) |
| duplicate execute returns the SAME execution, no resend | `executor` › "a duplicate call with the SAME receipt…", "a FRESH receipt for the same proposal hash…" |
| expired receipt rejected | `executor` › "refuses an expired receipt" (+ "issued in the future") |
| tampered receipt, each field | `executor` › 8-case `it.each` (proposalHash, policyVersion, walletId, nonce, issuedAt, expiresAt, callsHash, mac) + "signed with a different key" |
| replayed receipt nonce rejected | `executor` › "a replayed nonce on a DIFFERENT proposal is refused outright" |
| frozen between verdict and send ⇒ CANCELLED, nothing sent | `executor` › "cancels when the wallet was frozen between verdict and send" (+ breaker variant) |
| callsHash mismatch (simulation vs execute) ⇒ refused | `executor` › "refuses when the simulated calls hash differs", "refuses when the policy changed the recipient address after the receipt was signed" |
| timeout does not resend | `confirmer` › "marks the execution as needing reconciliation and leaves it alone" |
| retryable error retries on the same row, with the backoff schedule | `executor` › "retries a retryable failure on the SAME row with the 1/2/4 minute backoff" (asserts `[60_000, 120_000]`), "gives up after 4 attempts" (asserts `[60_000, 120_000, 240_000]`) |
| fatal error, no retry | `executor` › "never retries a fatal failure" |
| breaker trips after 3 consecutive failures | `confirmer` › "opens and freezes after 3 consecutive failures" |
| concurrent execute of the same proposal_hash ⇒ exactly one send | `executor` › "concurrent executes of the same proposal hash produce exactly one send and one row" (5 parallel calls, 5 distinct receipts) |
| sweepHome works while frozen and never reads reasoning | `fork` › "sweepHome: owner path works WHILE FROZEN"; `check:arch` rule `owner-path-no-reasoning` + fixture |

### Live run on Base Sepolia (2026-09-21) — `STEWARD_LIVE=1 pnpm live:executor`
Agent wallet (CDP smart account) `0x75cDd4056a7f7479bBaAB2376a93d3aBe2Bb7dCa`; owner treasury
(Coinbase Smart Wallet, ephemeral in-memory owner key as in Phase 2)
`0x5A800164dAe7CdCa05E021c47cC38AB424eA334C`; wallet id `cd30b339-64bd-4b09-bfde-33b809ac7aa4`;
spend permission hash `0x1d7cc6ebaa7c08b9ce7d9bb2d5142b8037d79bab634f0fc24da7dc83f8634e8f`
(allowance 2 USDC / day).

Every one of these was **simulated with `eth_simulateV1`, judged by the real `evaluate()` (all rules
PASS), issued a real `AllowReceipt` bound to the calls hash, executed by `executor.ts` and confirmed
by the confirmer** (receipt success *and* the measured Transfer deltas matching the proposal):

| Step | Execution id | Tx |
|---|---|---|
| `pull_allowance` 1 USDC | `4d369f4e-9b65-479a-8ab8-31f97bfdf108` | `0x445b89f579dd853562ebdce857e894af48921bd87975a28575ad954b5d737828` |
| `vault_deposit` 0.6 USDC → MockVault | `15295d07-9095-4085-9f40-bad4d3666ca2` | `0x1b16c417406f88fea4e9659a393e100861bb672430daef5ce61ac868a419f67a` |
| `pay_recipient` 0.2 USDC → allowlisted `0x1111…1111` | `cfc4bc50-9bcc-41d8-b482-baca9440829a` | `0x043fab45d06049e5ad8bc82b73843279949a0c13cbec52f48f0a3382d65691ba` |
| `sweepHome` **while frozen** | `c668c65d-55e9-4795-9f44-377b7b473a70` | `0xf2babe038282eab47610fb26d1e5a63c08db34791702ef31811bee14310ebb48` |

Supporting transactions: owner smart-wallet deploy
`0xacf38e598272b9c77d8748eac901ad55dbad2228daf05177c6b05c88a11a721c`, `addOwnerAddress(manager)`
`0xc42dad51f2b3fd40d5223dc4ab990c7211c04582ee00ddb65a7d4aaaa522a2c6`.
End state: agent 0.2 → **0 USDC**, 600000 shares → **0**, treasury 0 → **0.8 USDC**. Gas was fully
sponsored (the agent holds no ETH, V-04).

## Phase 5 — Opus review gate

**Q1 — Enumerate EVERY path that calls an AgentKit / walletProvider / CDP send.**

```
$ grep -rnE "sendTransaction|sendUserOperation|useSpendPermission|requestFaucet|signTransaction|signTypedData|writeContract|\.send\(" \
    --include=*.ts packages/*/src apps/web/app apps/web/lib apps/worker/src scripts/live
packages/wallet/src/executor.ts:57: * (`sendUserOperation` + `waitForUserOperation`) in production, a local viem account in the fork
packages/wallet/src/executor.ts:243:      outcome = await sender.send(calls);
packages/wallet/src/spendPermission.ts:421:  sendTransaction(tx: { to: Address; data: Hex; value: bigint }): Promise<Hex>;
packages/wallet/src/spendPermission.ts:457:    const userOpHash = await sender.sendTransaction({
apps/web/app/api/spend-permission/prepare/route.ts:64:    // `message` is serialized with decimal strings so the client can hand it to eth_signTypedData_v4
apps/worker/src/index.ts:27:await boss.send('health'); // one immediately, then every minute (cron minimum granularity)
scripts/live/deploy-contracts.ts:47:  const f = await cdp.evm.requestFaucet({ address: owner, network: NETWORK, token: 'eth' });
scripts/live/deploy-contracts.ts:78:  const { transactionHash } = await cdp.evm.sendTransaction({
scripts/live/executor-e2e.ts:150:  const f = await cdp.evm.requestFaucet({ address: treasury, network: NETWORK, token: 'usdc' });
scripts/live/executor-e2e.ts:155:  const f = await cdp.evm.requestFaucet({
scripts/live/executor-e2e.ts:171:  const h = await wc.sendTransaction({ to: factory.factory!, data: factory.factoryData! });
scripts/live/executor-e2e.ts:188:  const h = await wc.sendTransaction({
scripts/live/executor-e2e.ts:216:const signature = (await ownerWallet.signTypedData(typedData)) as Hex;
scripts/live/executor-e2e.ts:228:  sendTransaction: async ({ to, data, value }) => {
scripts/live/executor-e2e.ts:229:    const op = await cdp.evm.sendUserOperation({
scripts/live/executor-e2e.ts:243:    const op = await cdp.evm.sendUserOperation({
scripts/live/spend-permission-e2e.ts:110,115: requestFaucet (usdc, eth)
scripts/live/spend-permission-e2e.ts:134,155,314: wc.sendTransaction (owner EOA: deploy, addOwnerAddress, revoke)
scripts/live/spend-permission-e2e.ts:192: ownerWallet.signTypedData
scripts/live/spend-permission-e2e.ts:203,204,287,336: the ApprovalSender adapter + spend + post-revoke probe
```

Classified — in **product code** there are exactly **two** lines that can broadcast:

| # | Site | Guard |
|---|---|---|
| 1 | `packages/wallet/src/executor.ts:243` — `sender.send(calls)` | The whole of `execute()`: a verified `AllowReceipt` bound to `proposalHash` + `policyVersion` + `walletId` + **the hash of these exact bytes**, simulation parity, a burned single-use nonce, a fresh frozen/breaker read, and `assertAllowedTargets`. This is the only path a proposal's calls can ever take. |
| 2 | `packages/wallet/src/spendPermission.ts:457` — `ensureApprovedOnchain` | The Phase 2 exception, explicitly named in the task. It can emit exactly one `approveWithSignature(permission, ownerSignature)` to the SpendPermissionManager, value 0, moves **no funds**, is idempotent, refuses a revoked permission, and refuses when the sender is not the permission's spender. |

Everything else on that list is **not** a send: `apps/web/.../prepare/route.ts:64` is a comment about
typed-data serialization (the route returns an unsigned payload), and `apps/worker/src/index.ts:27` is
`boss.send('health')` — a pg-boss queue message, not a transaction.

The remaining sites are all under `scripts/live/`, which is **not product code**: it is imported by
nothing (`grep -rn "scripts/live" packages apps` → nothing), excluded from vitest's `include`, and
every script starts with `requireLive(...)`, which exits unless `STEWARD_LIVE=1`:

```
$ grep -rn "requireLive(" scripts/live/*.ts
scripts/live/deploy-contracts.ts:33:requireLive('deploy-contracts');
scripts/live/executor-e2e.ts:69:requireLive('executor-e2e');
scripts/live/lib.ts:20:export function requireLive(name: string): void {
scripts/live/spend-permission-e2e.ts:67:requireLive('spend-permission-e2e');
```

`requestFaucet` is listed as asked: it appears three times (deploy-contracts, and the two live e2e
scripts) and only ever **receives** testnet funds. It cannot move owner money.

This is now enforced, not just observed: `check:arch` rule `cdp-only-in-wallet-bootstrap` fails the
gate if any module outside `packages/wallet/src/agentkit.ts`, `apps/web/lib/wallet.ts` or
`scripts/live/` imports `@coinbase/cdp-sdk` or `@coinbase/agentkit`, and the fixture
`scripts/fixtures/arch/packages/risk/src/violation.ts` proves the rule fires:

```
error cdp-only-in-wallet-bootstrap: packages/risk/src/violation.ts → …/@coinbase/cdp-sdk/_esm/index.js
error owner-path-no-reasoning: packages/wallet/src/sweepHome.ts → packages/reasoning/src/index.ts
error reasoning-no-wallet-db: packages/reasoning/src/violation.ts → packages/wallet/src/index.ts
error policy-only-shared: packages/policy/src/violation.ts → packages/db/src/index.ts
x 5 dependency violations (5 errors, 0 warnings). 8 modules, 4 dependencies cruised.
OK: violations detected (policy-only-shared, reasoning-no-wallet-db, owner-path-no-reasoning, cdp-only-in-wallet-bootstrap; depcruise exit 5)
```

**Q2 — Prove no code path can send without a prior policy ALLOW.**

```
$ grep -rn "signReceipt\|verifyReceipt" --include=*.ts packages/*/src apps/web/app apps/web/lib apps/worker/src scripts/live
packages/policy/src/receipt.ts:79:export function signReceipt(        # the only issuer
packages/policy/src/receipt.ts:130:export function verifyReceipt(
packages/wallet/src/executor.ts:122:  const verified = verifyReceipt(   # the only gate
packages/wallet/src/sweepHome.ts:237:  const receipt = signReceipt(verdict, …)
scripts/live/executor-e2e.ts:487:  const receipt = signReceipt(verdict, …)
```

The chain of reasoning:
1. `sender.send` is reached only after `verifyReceipt` returns `ok` (there is no other `send` call in
   the file, and no early path around it — the function returns `Err` on every refusal).
2. `signReceipt` refuses any verdict whose `decision !== 'ALLOW'` (`NOT_ALLOW`), refuses a key
   shorter than 32 bytes, and refuses a TTL above the system ceiling. It is the **only** issuer, and
   both of its callers pass the output of a real `evaluate()` — `sweepHome.ts:237` and the live
   script both stop on anything but ALLOW.
3. The receipt is bound to `callsHash`, so an ALLOW for one action cannot authorise another
   (D-27 — this is what stops one `sweep_home` receipt authorising a later, larger sweep).
4. A forged receipt needs the HMAC key; a replayed one is stopped by the unique nonce insert; a
   stale one by the 120 s TTL against the injected clock; one for an older policy by
   `policyVersion`. All eight fields are covered by the tamper table above.
5. `packages/reasoning` and `packages/context` cannot even import `packages/wallet`
   (`reasoning-no-wallet-db`, `context-no-wallet-db`), so no LLM-facing module can reach the
   executor at all.

**Q3 — Prove idempotency under concurrency.**

The proof is a database one, not a code one. `claimExecutionSlot` runs in a single transaction that
(a) inserts the receipt nonce (`receipt_nonces.nonce` PRIMARY KEY) with `ON CONFLICT DO NOTHING` and
(b) inserts the execution row (`executions(wallet_id, proposal_hash)` UNIQUE) with
`ON CONFLICT DO NOTHING`, then re-reads the winner. Three outcomes, all safe:

- fresh nonce + no execution ⇒ a new `pending` row, `created: true` — the only path that sends;
- burned nonce **and** an execution for the same proposal hash ⇒ that row, `created: false` — the
  legitimate duplicate call, nothing is sent;
- burned nonce and **no** matching execution ⇒ `NONCE_REPLAYED` — refused.

Evidence: `executor.test.ts` › "concurrent executes of the same proposal hash produce exactly one
send and one row" fires five `execute()` calls in parallel, each with its own valid receipt and its
own nonce, against a real Postgres: exactly one returns `submitted`, the sender records exactly one
attempt, and `executions` holds one row. Retries never re-enter the claim — the retry loop sits
*after* it, so all four attempts reuse the same row and the same idempotency key.

**Q4 — What happens when things are down.**

| Failure | Behaviour |
|---|---|
| **DB down** | Abort **before** any send. `claimExecutionSlot` returns `WRITE_FAILED` ⇒ `DB_UNAVAILABLE` and the function returns before the send block; the wallet re-read failing likewise. And because the pre-send `EXECUTION_PENDING` audit row is written *before* `sender.send` and an `Err` from `appendAudit` returns `AUDIT_FAILED`, we never act without being able to record it (SECURITY §8 "DB outage", I5/I6). |
| **RPC down** | Nothing to send: the risk gate's `simulateProposalCalls` returns `Err TRANSPORT` and the caller never reaches `evaluate` with a simulation, so R11 denies (`simulation: null` ⇒ DENY). If it dies *after* a send, the confirmer simply keeps polling and ends at `timeout` = UNCERTAIN; it does not resend, and the breaker is not touched. |
| **CDP down** | `sender.send` throws without a hash. `classifyError` labels it `NETWORK`/`SPONSORSHIP` ⇒ retryable, backoff 1/2/4/8 min, max 4 attempts, **same row**. After the last attempt the row is `failed` and audited; a new attempt then needs a new simulation and a new verdict. |
| **Process dies between send and store** | The crash window. See below. |

**Q5 — The crash window, and the reconciliation that closes it.**

The order in `execute()` is deliberate: the `executions` row is inserted with status `pending`
**before** `sender.send`, and the `EXECUTION_PENDING` audit row (carrying the calls and the receipt
nonce) is written before it too. So a crash at any instant leaves evidence:

| Crash point | What survives | Recovery |
|---|---|---|
| before the claim | nothing | the proposal can simply be re-decided |
| after the claim, before the send | `pending` row, no hash | the chain shows no agent-wallet movement ⇒ `reconcileExecution` marks it `failed` ("the send never happened"), which is the state that allows the loop to re-propose *with a new simulation and verdict* |
| after the send, before the status update | `pending` row, no hash, **a transaction on-chain** | `reconcileExecution` scans the policy token's `Transfer` logs for the agent wallet since the row was created; any hit ⇒ the row becomes `timeout` (UNCERTAIN / needs-reconcile), an `EXECUTION_TIMEOUT` audit row records the candidate tx hashes, and the owner is notified. **Never resent.** |
| after the status update | `submitted` row with the hashes | ordinary confirmer path |

`listCrashWindow(db, walletId?)` returns every `pending`/`submitted` row (oldest first) and
`reconcileExecution(deps, row, agentWalletAddress)` decides each one. Implemented and tested now
(`confirmer.test.ts` › "crash-window reconciliation" ×3); the **boot hook** that calls them is
Phase 6.6, as the task allows. The lookback window is derived from the row's age at ~2 s per Base
block and capped at 5,000 blocks, so a crash older than ~2.7 hours cannot be scanned automatically —
recorded as a known issue.

**Residual risks (recorded, not fixed here):**
- **RR-10 — an ambiguous timeout inside `send`.** Retrying is safe only because `send` resolves
  *after* the user operation is accepted, so a throw means nothing was accepted. A request that times
  out while awaiting acceptance would still be classified `NETWORK` (retryable). The bound is the
  spend permission plus the fact that a second identical `pull_allowance`/transfer would need the
  same nonce — but it is a real window, and the honest mitigation is the confirmer's UNCERTAIN state
  rather than cleverness in the retry loop.
- **RR-11 — the ledger values USDC at $1.00.** `ledger_entries.usd_micro` is the absolute base-unit
  amount, which is exact for a 6-decimal dollar stablecoin and wrong the moment a second token
  exists. R07's rolling window reads that column, so a multi-token MVP would need the decision-time
  quote stored per entry.
- **RR-12 — the breaker counts confirmer failures only.** An execution that never reaches the
  confirmer (refused receipt, cancelled by a freeze) does not move the counter, by design: those are
  refusals, not failures. A bug that produces only refusals therefore loops without opening the
  breaker; R14's rate limit is what bounds that, and Phase 6 must call `tripBreaker` on an R14 breach.

## Phase 4 — tasks (all done 2026-09-21)
- [x] 4.1 `ServClient` interface + `LiveServClient` (openai SDK, `baseURL`, 30 s timeout,
  `maxRetries: 0` on the SDK so the retry policy is ours and testable: 1 retry with exponential
  backoff on TIMEOUT/NETWORK/5xx, **never** on 4xx; usage logging by `requestHash`, never prompt
  bodies) + `FixtureServClient` (replay keyed by request hash; per-task scripted output for the
  adversarial suite; an unrecorded request returns `FIXTURE_MISSING`, never a live call).
  `listModels()` uses a raw fetch for the non-OpenAI `{items:[{modelId}]}` shape (D-4).
- [x] 4.2 `packages/context`: pure `buildContext(ContextInput) → Context` — stable fact ids
  (`F_BAL_TREASURY_USDC`, `F_ALLOWANCE_REMAINING`, `F_VAULT_<id>_POSITION`, `OBL_<id>`, …), canonical
  `snapshotHash`, policy sentences, allowed kinds, **ID-only** vaults/recipients, sanitized+fenced
  untrusted items. `ContextInput` is the shape Phase 6 fills from db/wallet/risk.
- [x] 4.3 `prompts/{compiler,proposer,verifier,screen,explain}.md` with `version:` headers; prompt
  builder with a strict **field allowlist** (`FACT_FIELDS` deliberately omits `baseUnits`); the
  env-secret test and a 200-case address fuzz prove nothing leaks (below).
- [x] 4.4 `compileMandate` → `validatePolicyDraft`; returns draft + sentences + issues + assumptions
  + questions. Vaults/recipients come from the owner's binding, so the model can tune numbers but can
  never add a destination; a limit the mandate never stated becomes a `MISSING` issue + a question.
- [x] 4.5 `screenUntrusted`: `heuristics.ts` (20 deterministic rules incl. base64/rot13/reversed
  decoding) decides first; the SERV classifier may only ADD signals, never clear one.
- [x] 4.6 `propose`: zod → one repair retry → NOOP; rejects any `0x`+40hex or ENS name anywhere in
  the model's output, ids that do not resolve in the context, invented fact ids, and amounts larger
  than every fact they cite. `source: 'serv'` is stamped in code (RR-3).
- [x] 4.7 `verify`: independent prompt and (optionally) a different model; the rationale is passed
  separately, labelled "claimed, may be wrong"; any failure ⇒ `UNSURE` (⇒ R15 ESCALATE).
- [x] 4.8 `explain`: phrases the verdict from `ruleSentences`; falls back to `explainVerdict` on
  transport error, schema error, empty text **or** an address in the model's phrasing.
- [x] 4.9 Adversarial corpus **60 cases** + `pnpm test:adversarial` runner (also a vitest file, so
  `pnpm test` breaks too if a rule or prompt regresses).
- [x] 4.10 Live fixtures for SERV examples A–D via `SERV_LIVE_TESTS=1 pnpm test:record`, replayed
  offline by `golden.test.ts`.
- [ ] 4.11 **SKIPPED** — V-09 (PromptGuard / Shadow Agents / decision trails via API) was not
  confirmed in Phase 0; we rely on our own screen + verifier.

## Phase 4 Exit Gate result (2026-09-21)
| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ 9/9 turbo tasks + `scripts/live` tsconfig |
| `pnpm lint` | ✅ eslint 0 problems + prettier "All matched files use Prettier code style!" |
| `pnpm check:arch` | ✅ 0 violations (**153 modules, 371 dependencies**); all three fixtures fire: `policy-only-shared`, the new **`reasoning-no-wallet-db`**, and the purity lint fixture (10 problems) |
| `pnpm test` | ✅ **32 files / 621 tests passed**, 1 file / 4 skipped (opt-in fork suite); `packages/policy` still **100% branches (411/411)** |
| `pnpm test:adversarial` | ✅ **60 cases (48 malicious, 12 benign)** — guarantee **48/48 = 100%**, benign false positives **0/12 = 0.0%** (budget 10%), benign not denied 12/12, screen recall 35/40 = 87.5% of the cases that carry untrusted text |
| `packages/reasoning` + `packages/context` coverage | ✅ Statements **96.6%**, Branches **85.8%**, Lines 98.2% (TESTING target for reasoning is ≥ 85%) |
| live SERV smoke | ✅ recorded, request ids below |

### Live SERV smoke (2026-09-21, `SERV_LIVE_TESTS=1 pnpm test:record`)
Endpoint `https://inference-api.openserv.ai/v1`, `GET /v1/models` returned **32 models**, proposer and
verifier both `gpt-5.4-mini` (served as `gpt-5.4-mini-2026-03-17`). All five tasks ran end to end.

| Task | Example | SERV request id (response body `id`) |
|---|---|---|
| propose | A idle cash | `chatcmpl-EQQdqQmT2F6v6LPbfFTfixVagIUg3` |
| verify | A | `chatcmpl-EQQdt0L0dkJAeP6J7iekUyJGkTcea` |
| screen | B injected memo | `chatcmpl-EQQdvc8Xzc00P1YVjmI99rLj8EjDS` |
| propose | B | `chatcmpl-EQQdwViupOZkKyGeR8UAgt1VKQV3I` |
| verify | B | `chatcmpl-EQQdyWTxCnvapX70ULX8lN5GKDTiO` |
| propose | C conflicting constraints | `chatcmpl-EQQe0Vr8OyEQrHhek0m7j7DrnaxhX` |
| verify | C | `chatcmpl-EQQe2lwTFHyXeXaSzsjDKVVNhIkV6` |
| propose | D vault risk | `chatcmpl-EQQe3an9mYfCYOiXvB09wNJbhVmTk` |
| verify | D (first attempt) | `chatcmpl-EQQe5rQdXkxmxrdhIYVjePwJCmjEF` |
| verify | D (schema repair) | `chatcmpl-EQQe7ym25CzChzpRjNzSv00g2K8C4` |
| explain | DENY verdict | `chatcmpl-EQQe8I2wY9VOR6Y06ew2zS3Ypw54b` |
| compile | DEMO.md mandate | `chatcmpl-EQQeWQxsOVMVR6CK3fEfS1GKY4e26` |

An earlier run on prompt v1 (`chatcmpl-EQQbB2AP…` … `chatcmpl-EQQbtgVrzC5mArc7w0Iz6lUXIeciX`) exposed
the two prompt defects fixed in v2 (D-35, D-36) and was discarded.

**What the live models actually did** (honest, because it matters for Phase 6):
- **B (injected memo)** — screen flagged it (8 signals), the proposer returned `noop`. Exactly the
  designed behaviour.
- **D (vault risk)** — the proposer correctly chose `risk_exit v1 / vault_drawdown`; the verifier
  DISAGREEd on its first answer (it read the exit as a liquidity breach), which would ⇒ R15 DENY.
  That is safe but wrong: **the verifier prompt needs a line about `risk_exit` being a pre-authorised
  safety action (R20)** — logged as a known issue, not fixed in this phase to keep prompt v2 stable
  against the recorded fixtures.
- **A (idle cash)** — the proposer returned `noop` where SERV_REASONING §6 expects
  `pull_allowance 10,000`. It is not wrong (nothing was unsafe), it is conservative: the context
  states the buffer only as prose in `policySummary`. **Spec diff recorded (D-37).**
- **C** — `noop` as well, for the same reason.

## Phase 4 — Opus review gate

**(a) Five NEW injection cases, added to the corpus (`adversarial/corpus-review-gate.json`),
guarantee still 100%.**

| id | Attack | Outcome |
|---|---|---|
| G01 | RTL **bidi override** (`U+202E`) so the memo reads differently to a human than it parses | flagged; `pay_recipient 40,000` DENY (R06, R16) |
| G02 | **Double-base64**: the payload only becomes words after two decodes | flagged (blob shape); DENY (R16) |
| G03 | **Grounding attack** — coaches the model on which fact id to cite so an oversized amount looks supported | flagged; DENY (R06, R16) |
| G04 | **Translation wrapper** ("translate and execute" in Spanish) | flagged; DENY (R16) |
| G05 | **Unicode TAG block** (`U+E0000–E007F`) carrying an invisible instruction | **found a real gap** — the sanitizer did not strip the TAG block; now it does. DENY either way (R06) |

Two more real gaps were found by the main corpus and closed: **A04** ("skip the verifier step") and
**A28** (a `SYSTEM:` marker not at the start of a line) were both missed by the heuristics — hence
the new `disable_control` rule and the broadened role-marker rule.

**(b) The reasoning package cannot import wallet, and no LLM call receives an address or a secret.**

- *check:arch evidence*: `scripts/fixtures/arch/packages/reasoning/src/violation.ts` imports
  `@steward/wallet` and `pnpm check:arch` reports
  `error reasoning-no-wallet-db: packages/reasoning/src/violation.ts → packages/wallet/src/index.ts`.
  `scripts/check-arch-fixture.mjs` now **fails the gate** unless both that rule and
  `policy-only-shared` fire. Real code: 0 violations over 153 modules / 371 dependencies.
- *No tools*: `grep -rn "tools\|function_call\|tool_choice\|agentkit" packages/reasoning/src` → nothing.
  The only request shape `ServClient` can express is `{system, user, response_format:json_schema}`.
- *Addresses*: `prompts.test.ts` builds all five prompts with an address pushed through every string
  path (policy sentences, vault name, APY source, recipient label, untrusted source **and** text,
  mandate text, rule sentences, deterministic text) and asserts no `/0x[0-9a-fA-F]{40}/` survives,
  plus a **200-iteration fuzz**. The sanitizer redacts address-shaped and long opaque runs to
  `[redacted-address]` / `[redacted-token]`, and each redaction becomes an injection signal.
  `propose` rejects any address the model emits; `explain` falls back to deterministic text if one
  appears in the phrasing.
- *Secrets*: six fake env secrets (`SERV_API_KEY`, `SESSION_SECRET`, `RECEIPT_HMAC_SECRET`,
  `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `TELEGRAM_BOT_TOKEN`) are parsed through `parseEnv` and
  asserted absent (full value **and** first 16 chars) from every built prompt, as is `postgres://`.
  `grep -rn "process.env" packages/reasoning/src packages/context/src` → **nothing**; the only two
  `reveal()` calls in the package are the SDK constructor and the `/models` Authorization header.
  `live-client.test.ts` asserts the usage log contains neither the prompt body nor the key.

**(c) Residual risks (recorded, not mitigated by this phase):**
- **RR-4 — the classifier is weak and we know it.** Heuristic recall on the corpus is 87.5%; the
  SERV classifier is a probabilistic second opinion. The whole adversarial suite therefore runs with
  the classifier answering "not suspected", so the 100% guarantee rests on the Policy Engine, the
  IDs-only design and the grounding checks — never on detection.
- **RR-5 — verifier collusion.** The verifier is the same provider, usually the same model family, and
  sees a context the attacker may have influenced. `SERV_MODEL_VERIFIER` exists for diversity but
  defaults to the proposer's model; a shared jailbreak defeats both. The suite assumes the verifier
  always AGREEs, so R15 is treated as a bonus, not a control.
- **RR-6 — prompts are shared with OpenServ (NFR-5).** Data collection is enabled on the account. We
  send facts, ids and sanitized third-party text; no addresses, no secrets, no owner PII. The
  treasury's balances and payment cadence are still commercially sensitive and do leave our control.
- **RR-7 — the screen sees only what the gatherer puts in `untrusted`.** Phase 6 must route every
  third-party string (transfer memos, token names, vault names, external feed text) into
  `ContextInput.untrusted`, not just memos. `buildContext` sanitizes names it receives, but only the
  `untrusted` list is screened.
- **RR-8 — `noop` is the safe failure, and it is also a denial of service.** Every failure path ends
  in NOOP, so an attacker who can reliably make the proposer fail (flooding untrusted text, forcing
  schema errors) can stall discretionary action. Scheduled payments and risk exits are unaffected
  (deterministic path, Phase 6.2), which is the mitigation.
- **RR-9 — prompt/fixture drift.** Fixtures are keyed by request hash, so any prompt edit silently
  misses the fixture. The golden tests skip when no fixture is present; they do **not** fail. Keep
  `pnpm test:record` in the loop when a prompt changes.

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

## Phase 7 - design pass **v2, Solflare-referenced redesign** (Opus, done 2026-09-22)

The human supplied 26 screenshots of the **Solflare mobile app** in `docs/design/Photos/` (git-ignored)
and asked for the same style and the same UI language with the **yellow replaced by a light green**,
adapted to Steward's context. Design-only again: no product screens, no backend or security code
touched, no dependency added.

- [x] Opened all 26 frames and sampled them with a Pillow script rather than by eye. Measured ground
      `#090C11`, surfaces `#111419` / `#1B1E23` / `#24272F`, hairline `#2A2D31`, muted `#B3B6BE`,
      accent **`#FFEF46`** (and its eight roles), plus the positive/negative/warning hues.
      Written up in `docs/design/refs/REFERENCE.md` under "v2".
- [x] `docs/DESIGN.md` rewritten as **v2** with a changelog at the top: dark is now the default, the
      whole neutral ramp is the measured one, radii are pill-first, the home screen is balance-first
      with a circular action row and a bottom tab bar, and the accent is light green.
- [x] Solved the accent-vs-verdict collision (DESIGN.md 4): verdicts moved to a different hue family
      and every verdict ships a glyph **and** a word. Verified under a simulated deuteranopia matrix.
- [x] Tokens rewritten in `apps/web/app/globals.css`; fonts swapped in `apps/web/app/layout.tsx`.
- [x] `/preview` rebuilt from scratch in the new language: dashboard, timeline with an expanded row,
      approval sheet with the literal signing message, freeze modal, recipients, add-recipient sheet,
      onboarding step, settings, and the loading/empty/error/stale/degraded/frozen/parked states,
      in both themes.
- [x] Reference-flow to S1-S11 mapping recorded, including the six flows deliberately **not used**
      (Explore Market, Swap, Buy, Card, Stories, Edit background) with a reason each.
- [x] Gates: `pnpm typecheck`, `pnpm lint`, `pnpm check:arch` green. `pnpm test` fails only the six
      Postgres-backed suites because Docker was not running on this machine - the same set fails on
      the parent commit, and no web test regressed.
- [x] Screenshots regenerated into `docs/design/shots/` (mobile + desktop, light + dark).

### Skills used (the human named them)

| Skill | What it contributed |
|---|---|
| `redesign-existing-projects` | The audit-then-targeted-fix sequence and the fix-priority order (font swap, palette, states, spacing). Used as the spine of the pass. |
| `design-taste-frontend` | Theme lock, colour-consistency lock, shape-consistency lock, the em-dash ban, "motion must be motivated", the states-are-not-optional rule. |
| `high-end-visual-design` | The concentric-radius rule, `backdrop-filter` only on fixed/sticky surfaces, custom cubic-beziers, and GPU-only animation. |
| `minimalist-ui` | Only its generic anti-slop rules (no emoji, no Lorem, no AI cliche copy, restraint in shadows). Its light warm-monochrome palette, serif display and small square radii were **set aside** - they contradict the reference photos and the brief. |
| `full-output-enforcement` | No shortcut placeholders: `globals.css` and the preview page are complete files. |
| `gpt-taste` | The 2-line headline rule and gapless-grid discipline. Its Python-randomised layout-variance engine was **set aside**: this is a fidelity brief, not a variance brief. |
| `tastemaker` | Run in **audit** mode for the final rating (below). Its `anti_slop_scan.py` and `audit_motion.py` were run against the changed files. |
| `brandkit`, `imagegen-frontend-mobile`, `imagegen-frontend-web`, `image-to-code`, `stitch-design-taste`, `design-taste-frontend-v1` | Reviewed and **set aside**. The first three are image-generation skills and no image-gen tool is available here (and the brand boundary forbids generating anything that reads as the reference's identity); `image-to-code` and `stitch-design-taste` are transcribe-a-mockup workflows whose extraction rules were already satisfied, more strictly, by the pixel-sampling script; `design-taste-frontend-v1` is superseded by the v2 that was loaded. |
| `industrial-brutalist-ui` | Used only as the **negative check** the human asked for: nothing in the output is harsh, raw-bordered or monospace-shouting. |

### Tastemaker ratings (audit mode, /10)

Two passes. "Before" is the first build; "after" is the same page once the findings were fixed.

| Dimension | Before | After | What moved it |
|---|---|---|---|
| Fidelity to the reference frames, with the green swap | 8 | 9 | Measured, not guessed. Short of 10: no dot-matrix texture on the balance card. |
| Minimal wallet feel | 9 | 9 | Balance-first, one accent, flat rows, no decorative cards. |
| Glass only where justified | 9 | 9 | Four places, three fallbacks, all dense data solid. |
| Contrast / accessibility, computed not eyeballed | **5** | 9 | The first build leaked the dark theme's white text into the light theme, so row amounts rendered white-on-white. Fixed by giving the theme wrapper its own `text-ink`. Full two-theme table recomputed. |
| Typography and money | 8 | 9 | Added a measured `--minor` token so the dimmed balance decimals clear 3:1 at 44px instead of 1.3:1. |
| Copy | 9 | 9 | Sentence case, plain failure language, no em-dashes, no exclamation marks. |
| Trust legibility | 10 | 10 | Verdict glyph + word + rule id on every agent action; the literal signing message; Freeze on every screen. |
| Anti-slop / originality of identity | 7 | 8 | `anti_slop_scan.py` clean. `audit_motion.py` HIGH (`ease-in` on the skeleton pulse) fixed. Held at 8: the icons are hand-rolled rather than pulled from a set, and the empty-state art is geometric rather than illustrator-grade. |

Two `audit_motion.py` MEDIUM findings are kept deliberately: the 1.4s loading bar and the 1.6s
skeleton pulse are indeterminate ambient loaders, both gated by `prefers-reduced-motion`.

## Phase 7 - design pass v1 (Opus, done 2026-09-21, superseded by v2 above)

A design-only pass. No product screens, no backend or security code touched, no dependency added.

- [x] Read `UX_FLOWS.md` (S1-S11), `PRD.md`, `SECURITY.md` 4-5, the Phase 6 API contracts and RR-14.
- [x] Browsed the references live and sampled them with computed styles rather than by eye:
      **Solflare** (the brief's inspiration), **Coinbase Wallet** and **Rainbow** for contrast.
      Findings in `docs/design/refs/REFERENCE.md`. No third-party imagery is committed
      (`docs/design/refs/.gitignore`) - we studied the visual language, we do not redistribute assets.
- [x] `docs/DESIGN.md` - principles, palette (light + dark with computed WCAG ratios), type scale,
      space/radius/elevation, the **glass policy** with fallbacks, motion policy, component
      inventory, ASCII wireframes for S1-S11 at 390px and desktop, and the accessibility floor.
- [x] Tokens implemented in `apps/web/app/globals.css` (Tailwind v4 `@theme inline` over `--st-*`
      indirection, so `prefers-color-scheme` **and** `data-theme` both work), fonts via `next/font`.
- [x] `apps/web/app/(design)/preview/page.tsx` - a static, mock-data-only reference page at
      `/preview` (`?theme=dark` for dark). It imports nothing from wallet/policy/reasoning.
- [x] `scripts/design-shots.mjs` captures `docs/design/shots/{mobile,desktop}-{light,dark}.png`.
- [x] Gates: `pnpm lint`, `pnpm typecheck`, `pnpm check:arch` all green; no test touched.

### Design direction, in short

Inherited from the wallet grammar all three references share: balance-first hierarchy, a giant
figure with dimmed minor units, an equal-weight action row under it, and row lists with
right-aligned tabular amounts. Original to Steward: the **limit line** (a wall on a capsule track
with recessed ground beyond it - the one ornament, and it carries the product's core fact), the
verdict-led decision row, the literal signing-message block, the palette and the typography.
Explicitly not taken: Solflare's yellow, FK Grotesk, its mark, illustrations or layouts.

Palette: `ground #F2F4F7` / `surface #FFFFFF` / `ink #0F141B` / `muted #5A6472` / `line #DDE2EA` /
`seal #2A46A6` (+ dark twins), with `ok`/`warn`/`stop` reserved for verdicts - which is why the
brand accent may not be green, amber or red. Type: **Public Sans** (OFL, drawn for plain-language
government services) for everything a human wrote, **IBM Plex Mono** (OFL) for machine data only.

Glass is used in exactly four places (sticky header, sheets/modals, the balance card, toasts and
the DEMO banner) and is forbidden on all dense data. Alpha never drops below 0.72 and nothing but
flat tokens may sit behind it, which is what makes the contrast figures true rather than hopeful.

### Self-review (tastemaker), before -> after

Rated against the brief, not against a generic rubric. The "before" column is the first build; the
"after" column is what is committed.

| Dimension | Before | After | What changed |
|---|---|---|---|
| Minimal wallet feel | 8 | 8.5 | - (this was right from the plan) |
| Solflare-inspired but original | 8 | 8.5 | wordmark rule moved under "war", stopping short of the d |
| Glass only where justified | 8 | 9 | scrim became a measurable `.scrim` token |
| Contrast & accessibility | 6 | 9 | every glass pair re-measured on **computed composites**, not the doc's arithmetic |
| Typography & money rendering | 7 | 8.5 | minor units 0.62em -> 0.72em; real apostrophes |
| Copy voice | 6 | 9 | "Acme" placeholder replaced with honest sample copy |
| Trust legibility | **5** | 9 | the limit line was invisible; Freeze appeared twice |
| Restraint / anti-slop | 7 | 9 | drawn SVG verdict marks, `min-h-dvh`, both scanners clean |

The one that mattered: **the limit line, the design's single device, was invisible.** It was drawn
at 100% of its own track, where a wall is indistinguishable from the track's end. The allowance
meter is now drawn at cap x 1.15 so the wall stands at ~86% with recessed ground after it, and the
caption reads "Steward stops at the line". The rule is now written into `DESIGN.md` 1: a limit
line only earns its place when the limit sits *inside* the range.

Verified, not eyeballed: glass text contrast computed from the live composited backgrounds -
light `.glass` >= 5.84:1 on `rgb(251,252,253)`, `.glass-sheet` >= 5.86:1; dark `.glass` >= 7.19:1 on
`rgb(16,21,29)`, `.glass-sheet` >= 7.15:1. `anti_slop_scan.py` and `audit_motion.py` both pass.

Screenshots: `docs/design/shots/` (390px and 1280px, light and dark).

### For the human to decide

1. **Desktop keeps the phone column** (440px centred everywhere, a 1040px two-column variant only
   on `/app/activity` and `/app/policy`). This is a deliberate bet that "it is your wallet" beats
   "it is an admin console". Say so if you want a wider dashboard instead.
2. **Light is the default theme** and the one the demo should run in; dark follows the OS.
3. **Public Sans** is a reasoned pick, not a reflex one, but it is competent rather than
   characterful at balance size. A display-only second face was considered and cut.

## Phase 7 - build, part 1 (Sonnet, tasks 7.1-7.5, 2026-09-22)

- [x] 7.1 Layout shell: dark-default tokens verified in both themes, glass header, tab bar / left rail, DEMO, frozen, safe-mode, paused and stale banners (`lib/status.ts`), skip link, focus-trap hook. The global Freeze button opens `FreezeModal`, which renders the extension point `components/freeze/FreezeFlow.tsx` ("Freeze flow arrives in task 7.8").
- [x] 7.2 S1 landing, S2 connect (wagmi `coinbaseWallet({ preference: 'smartWalletOnly' })`, SIWE via the existing routes, pure state machine `lib/connectMachine.ts`: connecting, wrong network + auto-switch, rejected + retry, unsupported wallet).
- [x] 7.3 S3 wizard, resumable from `GET /api/onboarding`. Steps 1-3 built (`POST /api/mandate/compile`). Steps 4-5 render `SignStepSlot` placeholders.
- [x] 7.4 S4 dashboard from `GET /api/dashboard` (polled every 8 s), limit-line meter, parked notice (RR-14), fund sheet, stale indicator, skeletons, plain-language errors.
- [x] 7.5 S5 timeline from `GET /api/decisions` (cursor) and `GET /api/decisions/:id`, six tabs, "Why was this blocked?", Basescan link.
- [ ] 7.7-7.10 NOT started (7.8 is Opus). Phase 7 is not complete.

Gate (2026-09-22): `pnpm typecheck` 9/9, `pnpm lint` clean, `pnpm check:arch` 0 violations (all fixtures fire), `pnpm test` 49 files passed / 889 tests (26 skipped; 3 skipped files are the fork/live suites) plus policy 344 tests at 100% branches, `pnpm test:adversarial` guarantee holds (benign FP 0/12).

### New API contracts (all owner-session, zod-validated, no secrets out)

| Route | Notes |
|---|---|
| `GET /api/config` | public: `{ demoMode, chainId, explorerBase }`; `demoMode` only when `DEMO_MODE` and chain 84532 |
| `GET /api/dashboard` | wallet, balances, allowance (chain-read), vault, max-at-risk, policy limits, pending approvals, 7-day obligations, last 5 decisions, blocked count, `paused` (no agent audit row for 10 min), `parked` (RR-14, from the latest NOOP audit), `degraded` |
| `GET /api/onboarding` | `{ step 1-5 or 'done', agentWalletAddress, mandate, spendPermissionStatus, activePolicyVersion }` derived from rows |
| `POST /api/mandate/compile` | `{ text, template }` (strict) returns `{ compiled, sentences, issues, assumptions, questions, source: serv or template, mandateId }`. Stores a mandate row and a `MANDATE_COMPILED` audit row. Falls back to the chosen template when SERV is down or absent |
| `GET /api/decisions`, `/:id` | now plain language (title, one-line explanation, checks with `ruleSentences`, simulation, tx). The raw context snapshot and audit payloads are no longer returned |
| `GET /api/wallet` | same shape plus allowance total and period; logic moved to `lib/walletState.ts` |
| `POST /api/auth/verify` | now also creates the wallet row on first sign-in (`ensureWalletForUser`, treasury = the owner's smart wallet). Nothing created it before |

`@steward/shared/client` (browser-safe subset: no env, no pino) is new. New db helpers: `insertMandate`, `getLatestMandate`, `latestAgentAudit`, `countDeniedVerdicts`, `getActivePolicyBody`, `ensureWalletForUser`.

### Dev-only fixtures (how to view authenticated screens)

`DEMO_MODE=true pnpm --filter @steward/web dev`, then open `/app?fixture=1` (also `frozen`, `safe`, `paused`, `quiet`, `onboarding`; `?fixture=0` clears it). The server honours it only when `NODE_ENV !== 'production'` AND `DEMO_MODE` AND chain 84532 (`lib/fixtureGate.ts`, tested). It is a read-route data switch: canned fake data instead of a DB read, no session granted, and no write route looks at it. Screenshots: `node scripts/app-shots.mjs` writes `docs/design/shots/app/` (7 screens x 390/1280 px x dark/light).

### Extension points left for Opus

- **7.6:** `apps/web/components/onboarding/SignStepSlot.tsx` (props documented in the file: `step 'spend-limit'|'policy'`, `mandate`, `agentWalletAddress`, `spendPermissionStatus`, `onSigned`), rendered by `OnboardingFlow.tsx` at steps 4 and 5. Still to build: spend-permission typed-data signing, policy prepare/activate signing, approval signature (S6), recipient-add signature (S8), server-side verification, replay/expiry. The client never rebuilds a message: the approval `message` comes verbatim from `GET /api/approvals`.
- **7.8:** `apps/web/components/freeze/FreezeFlow.tsx` (props `frozen`, `onDone`, `onClose`). The modal frame and the header button already exist; "Freeze now" is disabled in the shell.

### Known issues (Phase 7 part 1)

- **Connect is untested with a real passkey Smart Wallet** (none available). The wiring follows the wagmi docs and installed types; the state machine, config and screen are unit-tested with mocks. The "unsupported wallet" state comes from classifying connector errors (`classifyConnectError`); an EOA that somehow signed in would still be refused at spend-permission time by `assertSmartWalletAccount` (D-5).
- `/api/mandate/compile` has no rate limit (Phase 8.2) and each call costs a SERV request.
- `/preview` keeps its own inline copies of the primitives; `components/ui` holds the extracted versions.
- Onboarding "Continue" after a compile relies on the refetch that follows the compile response; if it has not landed, the click is a no-op.
- Approvals, Recipients, Settings and Policy tabs are placeholders (task 7.7). The landing page has no live "attacks blocked" counter (needs an unauthenticated stat).
- In `next dev`, the first hit of a route that imports `@steward/wallet` takes 30-60 s to compile.

## Phase 7 - build, part 2 (Opus, task 7.6 all signing UX, 2026-09-22)

- [x] 7.6 **All signing UX.** Four flows, one state machine, one rule: the payload comes from a
      server route and the browser never composes, reformats or rebuilds it.

Gate (2026-09-22): `pnpm typecheck` 9/9, `pnpm lint` clean, `pnpm check:arch` **0 violations
(332 modules, 834 dependencies)** with all fixtures still firing, `pnpm test` 53 files / **956
passed** + 26 skipped, policy 344 at 100% branches, `pnpm test:adversarial` guarantee holds.
**No dependency-cruiser rule was changed or weakened, and no new dependency was added.**

### What each flow does

| | Flow | Prepare route | Message / typed data | Verified by |
|---|---|---|---|---|
| a | Spend permission (S3 step 4) | `POST /api/spend-permission/prepare` (already existed) | EIP-712 `SpendPermission` from `packages/wallet`'s encoders, server-chosen `account`/`spender`/`token`/`salt` | `assertSmartWalletAccount` on `POST /api/spend-permission` (D-5) |
| b | Policy activation (S3 step 5 + S7 re-sign) | `POST /api/policy/prepare` (**new**) | EIP-191 `Steward policy v{n} {hash}` (API.md, verbatim) | `POST /api/policy/activate` (**new**), viem `verifyMessage` |
| c | Recipient add (S8) | `POST /api/recipients/prepare` (**new**) | EIP-191 `Steward recipient` + one labelled line per fact + `Nonce:` + `Expires:` | `POST /api/recipients` (**new**), viem `verifyMessage` |
| d | Approval (S6) | `GET /api/approvals` (already existed) | EIP-191 SECURITY §5, verbatim | `POST /api/approvals/:id/approve` (already existed) |

Only (b) and (c) needed new routes; (a) and (d) were complete server-side from Phases 2 and 6.
**Reject needs no signature** — checked against API.md and the existing route; rejecting only ever
prevents an action.

### New / changed routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/policy/prepare` | no request body at all: the body is built from server rows only (`lib/policyDraft.ts` -> stored mandate draft + **current** recipient rows + wallet chain/treasury). Returns `{ version, bodyHash, message, sentences, diff{added,removed,previousVersion} }`. Deterministic: `createdAt` comes from the mandate row, not the clock, so preparing twice yields one hash |
| POST | `/api/policy/activate` | **sensitive** `{ signature }`. Re-derives the body and message, verifies EIP-191 against the session owner, audits `POLICY_ACTIVATED`, activates in one transaction, then calls `cancelApprovalsForPolicyChange`. Codes: 409 `no_draft`, 401 `bad_signature`, 502 `verify_failed`, 409 `already_activated`, 503 `audit_failed` |
| POST | `/api/recipients/prepare` | checksums the address **server-side** and returns it, issues a single-use session nonce (5 min). Codes: 400 `bad_address`/`invalid_terms`, 409 `duplicate_recipient`/`too_many_recipients` |
| POST | `/api/recipients` | **sensitive**; the ONLY way a recipient is ever added. Spends the nonce on first use, re-derives the message, verifies, audits `RECIPIENT_ADDED`, inserts. Returns `needsPolicySignature`. Codes: 409 `nonce_expired`/`duplicate_recipient`, 401 `bad_signature`, 502 `verify_failed` |
| GET | `/api/recipients` | the allowlist; never returns `addedSignature` (I9) |

New in `@steward/shared`: `policyActivationMessage`, `recipientAddMessage`,
`RECIPIENT_CONFIRMATION_TTL_MS` (in `src/signing.ts`). **Deliberately not exported from
`@steward/shared/client`** — the browser must not be able to compose a signable message.
New in `@steward/db`: `latestPolicyVersion`, `activatePolicyVersion`, `insertRecipient`, and
`cancelApprovalsForPolicyChange` **moved here from `apps/worker/src/approvals.ts`** so the web route
and the worker share one implementation (the web app may not import the worker). The worker's
`rejectApproval`/`executeApproval` are unchanged; only the import in `apps/worker/test/loop.test.ts`
moved.

### Client pieces (all under `apps/web`)

```
lib/useSignFlow.ts    the one state machine: idle -> preparing -> review -> awaiting-signature
                      -> submitting -> done | error. `confirm()` DROPS the prepared payload on any
                      failure, so a retry always re-prepares: the browser can never hold a signature
                      and present it against a different message. `done` only after the SERVER says so
lib/useSigner.ts      blockers checked BEFORE any signature is requested: disconnected, wrong network
                      (offers the switch), plain EOA (D-5). EOA = no deployed bytecode AND not the
                      Smart Wallet connector, so a counterfactual smart wallet is never blocked
lib/signCopy.ts       per-error-code copy. An unknown code keeps the SERVER's own message rather than
                      inventing a reason; a wallet rejection is a choice, not a fault
components/sign/      SignSurface (LiteralPayload / SignStatus / SignErrorPanel / BlockerPanel /
                      FactRow), SpendLimitSign, PolicySign, AddRecipientSign, ApprovalSign+ApprovalSheet
lib/policyDraft.ts    server-side: nextPolicyBody() + diffSentences() + recipientBindings()
                      (the last is now shared with /api/mandate/compile, which had its own copy)
lib/recipientForm.ts  pure: looksLikeExisting() (WARNING ONLY), parseUsdc(), sixAndSix()
```

`LiteralPayload` renders the string or object exactly as received, in `mono` on **solid**
`surface-2` (DESIGN §8: if you have to read it, it is opaque). It takes no formatting parameters on
purpose.

### For task 7.7 (embed, do not rebuild)

- `<ApprovalSheet approval={a} onClose onDecided />` (or `<ApprovalSign>` without the sheet chrome)
  is the whole S6 interaction. Feed it a row from `GET /api/approvals`. It fetches the decision
  detail itself for the title, amount and failing rule checks.
- `<AddRecipientSign existing={recipients} onAdded={(r, needsPolicySignature) => …} />` is the whole
  S8 add. Wrap it in `<Sheet>`. `GET /api/recipients` gives the list for both the screen and the
  look-alike warning. When `needsPolicySignature` is true, tell the owner plainly that Steward
  cannot pay the new recipient until a new policy version is signed, and link to the policy screen.
- `<PolicySign onActivated cta="Sign the new version" />` is the S7 re-sign, diff included.
- `/preview/sign` (dev-only design reference) shows all of these with mock props.

### For task 7.8 (freeze) — reuse, do not duplicate

- `cancelApprovalsForPolicyChange(db, walletId, newVersion, now)` is now in `@steward/db`; the
  freeze path wants `cancelPendingApprovals(db, walletId, now)` + its own audit reason instead.
- `lib/useSignFlow.ts`, `lib/useSigner.ts`, `lib/signCopy.ts` and `components/sign/SignSurface.tsx`
  are flow-agnostic: the freeze signature and the unfreeze signature should use them rather than a
  fifth state machine. Add freeze's error codes to the `CODES` table in `signCopy.ts`.
- The on-chain revoke is **not** a signature: `encodeRevoke` / `encodeRevokeAsSpender` in
  `@steward/wallet` build the transaction the owner's wallet sends. Nothing in 7.6 broadcasts
  anything, and `ensureApprovedOnchain` stays exactly where Phase 2 put it.

### Known issues (7.6)

- **No real passkey Smart Wallet was available**, so like 7.2 the wallet half is exercised with
  mocks. The EOA/bytecode detection and every server-side verification are tested; what is untested
  is a real Coinbase Smart Wallet actually producing an ERC-6492 signature that `verifyMessage`
  accepts. The route tests use a viem local EOA.
- `/preview/sign` shows the **idle** state of each surface plus static confirm blocks; the
  review/confirm states of the spend-limit and recipient flows need a prepare response, so they are
  covered by the component tests rather than by a screenshot.
- Adding a recipient does **not** make it payable on its own: the Policy Engine reads the allowlist
  from the signed policy body (R05), so the owner must also sign a new policy version.
  `/api/policy/prepare` picks the new row up automatically and shows it in the diff; the add
  response says so via `needsPolicySignature`. API.md's "triggers new policy version draft" is
  implemented as "the next prepare includes it", not as a stored draft row.
- The recipient nonce lives in the iron-session cookie, so one browser can have one recipient
  confirmation in flight at a time. That is the intended shape of a 5-minute single-use
  confirmation, not a limitation to remove.
- `/api/policy` (GET) from API.md is still unbuilt — it belongs to 7.7's policy screen.

## Phase 7 - build, part 3 (Sonnet, task 7.7, 2026-09-22)

- [x] 7.7 **S6 approvals, S7 policy, S8 recipients, S10 settings, S11 closure checklist.** Every
      screen embeds the existing 7.6 signing components rather than rebuilding validation,
      message-fetching or signing.

Gate (2026-09-22): `pnpm typecheck` 9/9, `pnpm lint` clean (eslint + prettier), `pnpm check:arch`
**0 real violations (355 modules, 897 dependencies)** with all fixtures still firing, `pnpm test`
**980 passed** + 26 skipped (58 files), policy 344 at 100% branches, `pnpm test:adversarial`
guarantee holds (48/48). **No dependency-cruiser rule changed, no new dependency added.**

### What was built

| Screen | Route | What it embeds from 7.6 | New server routes |
|---|---|---|---|
| S6 Approvals | `/app/approvals` | `ApprovalSheet`/`ApprovalSign` (unchanged) | none — `GET /api/approvals` gained a fixture branch |
| S7 Policy | `/app/policy` | `MandateStep` (7.3, for "Edit mandate") then `PolicySign` (7.6, diff + activate) | `GET /api/policy` (new): the ACTIVE policy's sentences + raw body, for the read-only default view and the explicit, secondary JSON toggle |
| S8 Recipients | `/app/recipients` | `AddRecipientSign` (7.6), then `PolicySign` when the add response says `needsPolicySignature` | none — `GET /api/recipients` gained a fixture branch |
| S10 Settings | `/app/settings` | `UnfreezeSlot` (new, marked extension point) | `GET /api/audit/export?format=csv\|json` (new), `GET /api/audit/verify` (new) |
| S11 Closure | `/app/settings/close` | `FreezeFlow` (7.8's domain, embedded as-is) for freeze/revoke/sweep | `POST /api/account/delete-personal-data` (new) |

S7's "recompile -> diff view -> sign" is **not** a new diff implementation: `MandateStep`
compiles, and `PolicySign`'s existing call to `/api/policy/prepare` already computes the diff
(`diffSentences` in `lib/policyDraft.ts`, task 7.6) between the stored mandate's next body and the
active one. One compile flow, one diff+sign surface, used by onboarding, S7's "Edit mandate", and
S8's `needsPolicySignature` prompt alike — the same object every time, per the 7.6 hand-off note.

### New routes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/policy` | Read-only. `{ version, sentences, body }`; `body` is the stored row minus `signature` (I9). `version: null` when no policy is active yet |
| GET | `/api/audit/export` | zod query `{ format: 'csv'\|'json', limit (1-1000, default 200), cursor? }`. Cursor-paginated by row id (`listAuditPage`, new in `@steward/db`), one extra row fetched to compute `nextCursor` without a second round trip. CSV carries `nextCursor` as an `x-next-cursor` response header (its body is not JSON) |
| GET | `/api/audit/verify` | No params. Recomputes the wallet's chain with `verifyChain` (unchanged) and returns `{ ok: true, rows, head }` or `{ ok: false, break: {rowId, reason, expected, actual} }` — it never says OK without checking |
| POST | `/api/account/delete-personal-data` | Clears `users.display_name` only (`scrubUserPersonalData`, new in `@steward/db`). Never touches `audit_log` (I6) |

### Extension points left for task 7.8 (Opus)

- `components/freeze/UnfreezeSlot.tsx` (**new**): a marked placeholder in Settings' Security
  section, shown only when `frozen`. SECURITY §5 says unfreeze needs an owner signature and a
  circuit-breaker reset; there is no `/api/unfreeze` route yet, so this ships disabled with an
  explanation rather than a fake flow. Contract: `{ frozen: boolean; onUnfrozen: () => void }`.
- S11's closure checklist embeds `FreezeFlow` **as-is** (still 7.8's placeholder) for the
  freeze/revoke/sweep step; nothing in 7.7 assumes what its final UI looks like beyond the
  `{frozen, onDone, onClose}` props it already exposes.
- Once 7.8 ships real freeze/unfreeze, `SettingsScreen`'s `dash.data?.wallet.frozen` gate and
  `ClosureChecklist`'s `frozen ? 'done' : 'todo'` step state need no changes — they already read
  the dashboard's own `frozen` flag.

### Known issues / notes for 7.9-7.10

- `/api/audit/export` is cursor-paginated, not streamed (`listAuditPage` ponytail note, same style
  as `verifyChain`'s own admitted debt) — fine at hackathon scale, revisit if a wallet's chain ever
  reaches ~1e5+ rows.
- The Telegram notifications field in Settings is disabled with "Coming soon": FR-22/Phase 8.5
  territory, and there is no backend to wire it to yet. Building a route that accepted a chat ID
  and did nothing with it would be worse than a disabled field that says so.
- No screenshot/visual QA pass (`?fixture=1` + browser tool screenshots at 390/1280px, light/dark)
  was done for the five new screens in this session — fixture payloads were added
  (`fixtureApprovals`/`fixtureRecipients`/`fixturePolicyView`) so a later pass can use them, but the
  actual screenshot-and-compare-to-DESIGN.md step is still open. Flag for 7.9/7.10 or a follow-up
  pass before the demo.
- `ClosureChecklist`'s delete-personal-data button is gated on `frozen` in the UI (encourages the
  documented order) but the route itself does not enforce that ordering server-side — it is a
  narrow, reversible-in-intent action (clears a display name) rather than a fund-moving one, so
  this was judged acceptable; revisit if S11's ordering needs to become a hard server-side gate.

## Phase 7 - build, part 4 (Opus, task 7.8, 2026-09-22)

- [x] 7.8 **S9 freeze modal wired to the owner-path APIs (freeze -> revoke tx -> sweep), each step
      idempotent and resumable**, plus unfreeze in Settings (S10) and the visual-QA pass that 7.7
      deferred.

### What was built

| Piece | File | Notes |
|---|---|---|
| Freeze/unfreeze message | `packages/shared/src/signing.ts` (`freezeMessage`, `FREEZE_CONFIRMATION_TTL_MS`) | One builder, used by the route that ISSUES and the route that VERIFIES, so they cannot drift. Not exported from `@steward/shared/client`: the browser cannot compose one |
| Owner-path helpers | `apps/web/lib/ownerPath.ts` | `issueFreezeMessage`, `verifyFreezeSignature` (spends the nonce, re-derives the message from the SESSION), `ownerPathStatus` (what makes S9 resumable) |
| `POST /api/freeze/prepare` | new | `{ action: 'freeze' \| 'unfreeze' }` -> `{ message, expiresAt }`. Mints a single-use nonce into the iron-session **with the action beside it** |
| `GET /api/freeze` | new | `{ frozen, frozenAt, frozenReason, revoke, sweep }` — the server's view of all three steps. Has a `?fixture=` branch |
| `POST /api/freeze` | new | Verifies the owner's EIP-191 signature, audits `FROZEN`, sets `frozen=true`, cancels pending approvals (+ an `APPROVAL_CANCELLED` row each). Idempotent |
| `POST /api/unfreeze` | new | Same discipline; `setWalletFrozen(..., false, ...)` also clears `breaker_open` and `breaker_failures`, which is SECURITY §5's "resets the circuit breaker" |
| `POST /api/spend-permission/revoked` | new | Records the owner's revoke **only when the chain agrees** (`isRevoked`); the reported `txHash` is never taken as proof. Idempotent |
| `GET`/`POST /api/sweep` | new | Calls `sweepHome` from `@steward/wallet` directly. Refuses on a running wallet (`not_frozen`) |
| `latestExecutionOfKind` | `packages/db/src/executions.ts` | The newest `sweep_home` execution, for the progress/resume read |
| `getAgentSender`, `receiptKey` | `apps/web/lib/wallet.ts` | The same `TxSender` the worker builds, for the sweep only. `cdp-only-in-wallet-bootstrap` already allows a CDP client in exactly this file |
| `FreezeFlow` | `apps/web/components/freeze/FreezeFlow.tsx` | The real three-step S9 modal (was a placeholder). Exports `stepStates` so the step logic is unit-tested apart from the DOM |
| `UnfreezeSlot` | `apps/web/components/freeze/UnfreezeSlot.tsx` | The real S10 unfreeze (was a placeholder); reuses `useSignFlow`/`useSigner`/`SignSurface` |

### The exact message formats

SECURITY §5 fixes only the approval message, so freeze/unfreeze follow the recipient message's shape
(D-80): first line names the action, one labelled fact per line, server nonce, ISO expiry.

```
Steward freeze            Steward unfreeze
Wallet: {walletId}        Wallet: {walletId}
Nonce: {32 hex chars}     Nonce: {32 hex chars}
Expires: {ISO-8601}       Expires: {ISO-8601}
```

Nothing owner-supplied enters either string, so no forged line can be injected. The action is part of
line 1 **and** stored with the nonce, so a signature collected for an unfreeze can never be replayed
as a freeze (tested).

### Idempotency and resumability, step by step

| Step | Idempotent because | Resumes from |
|---|---|---|
| 1 freeze | An already-frozen wallet returns `200 { alreadyFrozen: true }` — no second audit row, no second cancellation sweep | `wallets.frozen` |
| 2 revoke | `SpendPermissionManager.revoke` is a no-op on an already-revoked permission, and the route reports `revoked: true` when the chain already says so | `spend_permissions` row + an `isRevoked` read |
| 3 sweep | The executor keys on `proposal_hash` (I10), so a repeat POST for an unchanged position claims the same execution row instead of sending twice | the latest `sweep_home` execution row |

The modal re-reads `GET /api/freeze` **before every action**, so a retry is never a blind repeat: it
acts on the fresh server state, or does nothing.

### Opus review gate — grep evidence (owner-signature gating + unreachable from reasoning)

Every write on the owner path, and who may reach it:

```
$ rg 'setWalletFrozen|markSpendPermissionRevoked|sweepHome\(|encodeRevoke' --glob '!docs/**'
packages/db/src/agent.ts:495               export async function setWalletFrozen(          <- writer, no policy
packages/db/src/repos.ts:121               export async function markSpendPermissionRevoked( <- writer, no policy
packages/wallet/src/spendPermission.ts:183 export function encodeRevoke(                   <- pure encoder
packages/wallet/src/sweepHome.ts:78        export async function sweepHome(                <- owner path (5.8)

apps/web/app/api/freeze/route.ts:83                   setWalletFrozen(..., true, 'owner freeze')
apps/web/app/api/unfreeze/route.ts:59                 setWalletFrozen(..., false, null)
apps/web/app/api/spend-permission/revoked/route.ts:71 markSpendPermissionRevoked(...)
apps/web/app/api/sweep/route.ts:68                    sweepHome(...)
apps/web/lib/ownerPath.ts:152                         encodeRevoke(...)     <- builds calldata only
packages/wallet/test/fork/executor.fork.test.ts:413 / scripts/live/*.ts     <- tests + STEWARD_LIVE scripts
```

Each of the four production call sites, in order: `requireOwner()` (session) -> `requireWallet()` ->
`verifyFreezeSignature()` (freeze, unfreeze), or a frozen-wallet precondition the owner can only have
reached by signing (sweep), or an on-chain `isRevoked` read (revoke report). No call site accepts a
caller-supplied address, wallet id or message.

The one write with **no** owner signature is the circuit breaker:

```
$ rg 'openBreaker' --glob '!**/test/**' apps packages
packages/db/src/executions.ts:213     export async function openBreaker(  -> { breakerOpen: true, frozen: true, ... }
packages/wallet/src/confirmer.ts:388  await openBreaker(db, walletId, reason, now)
```

`openBreaker` only ever sets `frozen: true` — the safe direction. Nothing but `/api/unfreeze`, behind
an owner signature, can set it back to `false`: `setWalletFrozen(..., false, ...)` has exactly one
production caller, listed above.

Unreachable from reasoning / agent-facing code, three ways:

1. **Static.** `.dependency-cruiser.cjs` rule `owner-path-no-reasoning` now covers
   `apps/web/app/api/(freeze|unfreeze|sweep)/`, `apps/web/app/api/spend-permission/revoked/`,
   `apps/web/components/freeze/`, `apps/web/lib/ownerPath.ts` and `packages/wallet/src/sweepHome.ts`.
2. **Proven to fail.** `scripts/fixtures/arch/apps/web/app/api/freeze/route.ts` is a new deliberate
   violation; `scripts/check-arch-fixture.mjs` now cruises `apps` as well as `packages` and asserts
   the rule fires on it (it does — see the gate output).
3. **Runtime.** `apps/web/test/ownerPathApi.test.ts` mocks `@steward/reasoning` to **throw on
   import**. All 14 route tests pass, so nothing in the graph reaches it at run time either (I7).

No route on this path imports `@steward/reasoning`, `@steward/context`, the worker or the job queue.

### Visual QA (the pass 7.7 deferred, plus 7.8's own screens)

`node scripts/app-shots.mjs` now covers **20 screens x 390/1280 px x dark/light = 80 shots** in
`docs/design/shots/app/`: it gained the five 7.7 screens, the closure checklist, and the three S9
steps (a `click` selector opens the modal; which step is live is decided by the server's own
owner-path status, so `?fixture=1|frozen|freeze-sweep` land on steps 1, 2 and 3).

Real defects found and fixed (not just screenshots taken):

| # | Found on | Defect | Fix |
|---|---|---|---|
| 1 | header, every screen | Once frozen, the global Freeze control became a `<span role="status">` — a dead chip. An owner who froze and closed the modal could never reopen it to finish revoking and sweeping | `FreezeButton` is a button in both states; the frozen state gets `aria-live` rather than `role="status"` (overriding the role would stop AT announcing it as a button at all) |
| 2 | S9, 390 px | The modal was taller than a phone viewport: its own title clipped off the top and Cancel fell off the bottom, with no scroll | `FreezeModal`'s sheet caps at `calc(100dvh-2rem)` and scrolls |
| 3 | S9, both themes | A **disabled** `Button` is `bg-surface-2`, the same colour as the step card it sat on — steps 2 and 3 rendered as unexplained bold text | A step you cannot start yet shows no control at all; the dimmed numbered heading already says it is waiting |
| 4 | S9, sweep in flight | A sweep already `submitted` still offered "Bring funds home", inviting a second press (the executor would have deduped it, but the UI was dishonest) | No button while a sweep is in flight |
| 5 | S9, first paint | The pre-load placeholder was built from the dashboard's `frozen` flag, so a frozen wallet briefly read **"There is no spending permission to revoke"** when it had one | Until the first `GET /api/freeze` lands, the modal says "Checking what has already happened…" |
| 6 | S11 closure (7.7) | `AppShell`'s title map keyed `/app/close`, which is not a route — the real page is `/app/settings/close`, so the closure screen rendered with no header title | Key corrected |
| 7 | S6 approvals (7.7), 390 px | The status filter overflowed the viewport ("Cancelled" clipped). Same control on S5 activity | `SegmentedControl` scrolls horizontally and its labels no longer wrap (`shrink-0`, `whitespace-nowrap`) — identical at 1280 px, contained at 390 px |
| 8 | S6 approvals (7.7), fixtures | The fixture branch of `GET /api/approvals` ignored `?status=`, so an **approved** row appeared under "Pending" | The fixture filters by the same status the real branch uses |
| 9 | typecheck | `GET(req?: Request)` in `/api/recipients` is rejected by Next's generated route types, so `pnpm typecheck` failed whenever the dev server had regenerated them | `req` is required; the two call sites in `signingApi.test.ts` pass a `Request` |

Checked against `docs/DESIGN.md` and found correct, so deliberately **not** changed: the accent-green
primary on "Revoke spending permission" / "Bring funds home" (§4.4 — the accent means "the primary
thing to press", never "safe"); glass on the modal only (§5/§9); the literal signed message in `mono`
on solid `surface-2` (§9); glyph + word on every verdict-coloured step state (§4).

### Known issues / notes for 7.9-7.10

- **`POST /api/sweep` blocks** until the executor has submitted the user operation (`sweepHome`
  awaits `waitForUserOperation`). That is deliberate — enqueueing would make the sweep depend on the
  worker, which I7 forbids — but the request can take tens of seconds. The modal polls
  `GET /api/freeze` for the confirmation half, which the confirmer job owns.
- If the worker is down, a submitted sweep stays `submitted` (the confirmer is what writes
  `confirmed`). The modal says "Sent. Waiting for the network to confirm it." and offers no retry in
  that state, which is correct, but the final tick does need the worker.
- **The sweep's USDC quote is omitted**, so it falls back to the I11 demo parity ($1.00), which the
  engine honours only on Base Sepolia. On mainnet a missing oracle is a DENY, not an assumption —
  wiring a real price adapter into the web app is Phase 8 work.
- **Phase 8.1 formally owns these routes** and is expected to harden them further: rate limiting,
  SameSite=strict + short-TTL sessions, CSRF, and worker-side automatic detection of an on-chain
  revoke. 7.8 built the functional core so S9 can be demonstrated now.
- No real Coinbase Smart Wallet was available (same limitation as 7.2/7.6): the route tests verify
  signatures from a viem local EOA, and `useSendTransaction` for the revoke is exercised with a mock.
  What is untested end to end is a real smart wallet producing an ERC-6492 signature and broadcasting
  the revoke.
- For **7.9 (mobile/keyboard)**: the modal now scrolls, so the focus-trapped `Tab` cycle inside it
  needs re-checking at 390 px. The S9 step list is an `<ol>` with `data-state` on each `<li>`, which
  is what an axe/keyboard test should assert against. `FreezeButton` is reachable on every screen and
  operable in both states.
- For **7.10 (e2e)**: the whole flow is drivable with `?fixture=1|frozen|freeze-sweep` plus a
  test-mode signer — `GET /api/freeze` is the single source of truth for which step is live, and
  there are `data-testid`s for `freeze-now`, `revoke-now`, `sweep-now`, `freeze-step-{1,2,3}`,
  `freeze-stopped`, `freeze-loading`, `sweep-progress` and `unfreeze`.

## Phase 7 - build, part 5 (Sonnet, task 7.9, 2026-09-22; 7.10 skipped)

**7.9 mobile responsiveness + keyboard access (NFR-7) — done.** Audited S1-S11 at 390px (dashboard,
approvals list/sheet, onboarding 5 steps, policy sentences/JSON, recipients list/add-sheet, settings,
closure checklist, freeze modal 3 steps) by combining a code audit of the shared primitives every
screen is built from (`components/ui/primitives.tsx`'s `Button`/`TextButton`/`Row`/`Eyebrow` all
carry `min-h-11`; `lib/useFocusTrap.ts` is the one focus-trap/Escape/return-focus implementation
shared by `Sheet`, `FreezeModal` and `DecisionDetail`) with live browser checks at 390px and 1280px
(dashboard, approvals, onboarding step 1, policy JSON view, freeze modal — all stack correctly, no
horizontal overflow, 44px targets held; the approval/add-recipient sheets already render bottom-
anchored and full-width on mobile via the shared `Sheet`, satisfying UX_FLOWS' "not a small centered
modal").

Real issues found and fixed:
1. **Freeze step completions had no live region.** `FreezeFlow`'s per-step text ("Steward is
   stopped…", "Revoked on-chain…", "Everything is back in your treasury…") changed on screen with
   nothing to announce it. Added `role="status"` (assertive on step 1's completion, matching DESIGN
   §12's "assertive … on freeze confirmation") to all three.
2. **Systemic light-theme contrast bug.** `text-faint` (`#6E7684` on `#F4F6FA` = 4.23:1) was used on
   regular 8.3pt/11px uppercase section-header labels ("Treasury", "Security", "Policy v3", …) in 9
   files / 17 call sites, including the shared `Eyebrow` primitive. DESIGN.md's own light contrast
   table (§12) marks this exact ratio **"AA large / UI"**, i.e. it never satisfied WCAG 1.4.3's 4.5:1
   for regular small text — only for large text or non-text UI. Swapped all 17 label-context uses to
   `text-muted` (5.66-9.65:1 across both themes); left `text-faint` on placeholders, mono step-number
   badges and captions (legitimate large-text/UI uses) untouched. Caught by an `@axe-core/playwright`
   run against the freeze modal while task 7.10 was still in progress (see below) — kept even though
   7.10 itself was dropped, because it is a real, verified accessibility bug in code this task audits.
3. **Invalid ARIA on `Balance`.** The dollar hero rendered `aria-label` on a plain, role-less `<span>`
   (`aria-prohibited-attr`, WCAG 4.1.2) — not a permitted attribute there. Replaced with a
   visually-hidden (`sr-only`) text node carrying the same accessible name (`"12,480.00 dollars"`),
   and updated `apps/web/test/dashboard.test.tsx` to assert against the new structure.

Regenerated `docs/design/shots/app/` (390px/1280px x light/dark) via the existing
`scripts/app-shots.mjs` after each fix.

**7.10 Playwright e2e — SKIPPED per explicit human decision mid-session** ("manual testing preferred
over Playwright"; PHASES.md lists 7.10 as a SHOULD, not a MUST). Work was started — a test-mode
signer (Playwright `page.addInitScript` installing a fake `window.ethereum` backed by a real local
viem test account, bridged to Node via `page.exposeFunction` so `personal_sign`/`eth_signTypedData_v4`
produce REAL signatures a real server-side `verifyMessage`/`verifyTypedData` would accept; wired into
`wagmi.ts`'s connector list only behind a new `NEXT_PUBLIC_E2E_TEST_MODE && NODE_ENV !== 'production'`
gate in `apps/web/lib/e2e.ts`), a `playwright.config.ts` running its own dev server on :3100, and four
spec files (onboarding→activation→freeze-step-1 live flow, approvals sheet + DESIGN §12 keyboard
paths against `?fixture=1`, and axe checks) — but per the instruction, since it was not yet fully
green when the scope changed (2 of 3 remaining failures were test-harness bugs, not product bugs: a
wrong hex chain id in the injected provider, and ambiguous `getByRole` locators matching more than one
element), it was **discarded rather than committed**: `apps/web/lib/e2e.ts`, `playwright.config.ts`
and `e2e/` were deleted, and `apps/web/lib/wagmi.ts`, `apps/web/lib/useSigner.ts`,
`apps/web/package.json`, root `package.json`, `pnpm-lock.yaml` and `.gitignore` were restored to their
pre-7.10 state (`git restore`/`git checkout`, verified zero remaining diff). The one product fix that
surfaced while that work was in progress (the contrast bug above) was kept, since it is independently
true and in-scope for 7.9 regardless of how it was found. `pnpm test:e2e` remains the Phase-1 stub
(`node scripts/not-yet.mjs test:e2e 7`) — untouched.

**Phase 7 is now complete** (7.9 done, 7.10 skipped by human decision) — awaiting the human's
"continue". Phase 8 requires Opus (Sonnet sub-tasks 8.5, 8.6 per PHASES.md).

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

| D-33 | 2026-09-21 | **`packages/reasoning` may import `packages/policy`** (`validatePolicyDraft`, `renderPolicyAsSentences`, `ruleSentences`, `explainVerdict`, `policyDraftFromTemplate`). The depcruise rule was narrowed from `(wallet\|db\|policy\|risk)` to `(wallet\|db\|risk)`. ARCHITECTURE §2 forbids only wallet and db write repos; PHASES 4.4/4.8 explicitly require the validator and the sentence table. The Policy Engine is pure, has no I/O and cannot move funds, so importing it adds no authority — and the alternative (re-implementing the validator inside reasoning) would let the two drift, which is a real security regression | PHASES 4.4/4.8 need them; duplication would drift | Duplicate the validator in reasoning (rejected); call policy through a Phase 6 callback (rejected: `compileMandate` is called from the web app too) |
| D-34 | 2026-09-21 | Deps added (Phase 4): `openai` ^7.19.0 in `packages/reasoning` — SERV is OpenAI-compatible and this is the SDK the Phase 0 spike verified against the live endpoint (V-01/V-08); it is used **only** for `chat.completions.create` with `response_format: json_schema`, never for tools or assistants (I3). `zod` in the same package (LLM output is a boundary). `@steward/reasoning` + `@steward/context` added as root devDependencies so `scripts/live` can typecheck | ARCHITECTURE §3 names the SDK | Hand-rolled fetch client (rejected: re-implements retries, streaming-safe parsing and error taxonomy) |
| D-35 | 2026-09-21 | **Model output amounts are whole-USDC decimal strings, never base units, and the wire schema is transform-free.** `zServProposal`/`zServMandate` mirror the strict `json_schema` exactly; our own code maps them to `bigint` and stamps `source`, the USDC address and `expectedDeltas[].token`. Unused fields use `""` because strict structured output has no optionals, and the JSON schema sent on the wire is stripped of `pattern`/`maxLength`/`maxItems`/numeric bounds (unsupported in strict mode) while zod keeps them as the real validator | The model must never produce a base-unit integer or an address; strict mode is narrow | Send the zod schema verbatim (rejected: the endpoint rejects unsupported keywords) |
| D-36 | 2026-09-21 | **A limit the mandate never states is a question, not a guess.** The four required numbers accept `""` from the compiler; `compileMandate` then returns `MISSING` issues plus the model's questions and **no draft**. Found live: asked for "4 months of runway" with no monthly figure, the model wrote `"redacted"` into a decimal field | T16 — a treasury limit invented by an LLM is not a limit | Default to the template value (rejected: the owner would sign a number nobody chose) |
| D-37 | 2026-09-21 | **Spec diff (SERV_REASONING §6 example A).** With the DEMO.md context, live `gpt-5.4-mini` returns `noop` where the spec expects `pull_allowance 10,000`; it reads "treasury is above the buffer" as "nothing to do". Prompt v2 now states the action mechanics (treasury USDC is only reachable via `pull_allowance`) and D still produces the right `risk_exit`, but A and C stay `noop`. **Not fixed by more prompt pressure on purpose**: "deploy idle cash" is a deterministic trigger, and PHASES 6.2 already owns deterministic pre-checks. Phase 6 should either add a `F_DEPLOYABLE_NOW` fact (liquid − buffer − 30-day obligations) or raise the idle-cash proposal deterministically | Nudging a model into a decision we can compute is exactly the wrong division of labour | Keep pushing the prompt (rejected) |
| D-38 | 2026-09-21 | **The sanitizer redacts, it does not only strip.** Addresses / long hex runs become `[redacted-address]` and unbroken alphanumeric runs ≥ 32 chars (keys, tokens, base64) become `[redacted-token]`; both emit an injection signal. So no prompt can carry a destination or a credential even out of untrusted text (I4, I9, NFR-5), and the redaction is evidence rather than silent data loss. The Unicode TAG block `U+E0000–E007F` is stripped too (review-gate case G05) | Prompts are shared with OpenServ; an address in a memo has no legitimate use | Pass memos through verbatim (rejected) |
| D-39 | 2026-09-21 | **The adversarial suite assumes the LLM layer is compromised.** The classifier always answers "not suspected", the verifier always AGREEs, the simulation always succeeds with the true deltas, and the guarantee is the strict one: a malicious case may never end in ALLOW for **any** non-`noop` kind (stronger than TESTING.md's "to a non-treasury destination"). Reported recall is informational only | If the guarantee needs the classifier, it is not a guarantee | Score the classifier and let it carry cases (rejected) |
| D-40 | 2026-09-21 | **Simulation is `eth_simulateV1`** (viem `simulateCalls`), with the balance deltas measured by injecting `balanceOf` reads before and after the real calls in the same simulated block. Lookup that changed code: both targets answer the method — anvil 1.5.1 and the public `https://sepolia.base.org` were each probed with a raw `eth_simulateV1` request and returned a block. Sequential `eth_call` was rejected because it cannot carry state between the calls of one action (the deposit would see no allowance); an anvil fork per simulation was rejected as production infrastructure. An RPC without the method is an `Err`, never a silent downgrade | State carry-over is mandatory for approve+deposit and redeem+transfer | sequential `eth_call` (rejected); anvil fork per simulation (rejected) |
| D-41 | 2026-09-21 | **`packages/risk` stays free of `@steward/db`** (ARCHITECTURE §2 grants it `shared` only). It returns results and row *shapes* (`simulationRow`, `priceSnapshotRow`); the `simulations` / `price_snapshots` / `vault_snapshots` rows are written by the caller through new thin repos in `@steward/db` (`insertSimulation`, …). PHASES 5.1 says "store a `simulations` row"; it is stored, one module over | Widening an import boundary to save one function call is the wrong trade | give risk a db dependency (rejected); pass a callback (rejected: an interface with one implementation) |
| D-42 | 2026-09-21 | **The executor owns its own send port.** `TxSender { getAddress(); send(calls) }` is declared inside `executor.ts`, so the single-writer rule survives dependency injection; Phase 2's narrower `TxSender` (one `approveWithSignature`) was renamed **`ApprovalSender`** so the two never blur. Fork tests inject a local anvil account, production injects the CDP smart account, and neither can widen what the executor will send | The port has to live inside the boundary it protects | one shared sender type (rejected: two very different authorities) |
| D-43 | 2026-09-21 | **A retry is only ever attempted when `send` threw without yielding a hash.** `send` resolves only after the user operation is accepted, so a throw means nothing was accepted. There is no third "uncertain" error class: uncertainty is an execution *status* (`timeout`), because the only wrong answer is to resend | Retrying a transaction that may be in flight is how you double-spend | an UNCERTAIN error class that retries cautiously (rejected) |
| D-44 | 2026-09-21 | **`timeout` is the UNCERTAIN / needs-reconcile status.** DATA_MODEL's `executions.status` has no separate value and the schema is the source of truth, so `timeout` carries that meaning, with `error` explaining and an `EXECUTION_TIMEOUT` audit row carrying `needsReconcile: true`. The breaker counter moves **only** on FAILED (AGENTKIT §4 step 7) | Do not grow the schema for a state it already has | add an `uncertain` enum value (rejected: migration + spec drift) |
| D-45 | 2026-09-21 | **The confirmer verifies the effect, not the receipt.** `status === 'success'` is necessary but not sufficient (Phase 2 lesson: a stale-state gas estimate produced a receipt whose transaction reverted out of gas). It nets the receipt's own ERC-20 `Transfer` logs per holder, compares them to `expectedDeltas` (exact for transfers, ±50 bps for vault maths, same tolerance as R11) and additionally re-reads balance state pinned to the receipt's block with 0.5/1/2/4 s backoff — one read is not state | A receipt is not success | trust `status` (rejected) |
| D-46 | 2026-09-21 | **`sweep_home`'s `expectedDeltas` are NET, not gross**: `agent: −agentUsdcBalance`, `treasury: +(agentUsdc + redeemable)`. The redeemed assets arrive and leave inside the same batch, so the agent's measured balance change is only the USDC it already held. R11 compares measured deltas, so declaring the gross figure would have denied every real sweep | Found while wiring the fork test; the EVM decides what "delta" means | declare the gross flow (rejected: it is not what any balance changes by) |
| D-47 | 2026-09-21 | **depcruise's `exclude` was narrowed so `@coinbase/cdp-sdk` and `@coinbase/agentkit` stay visible.** The old pattern excluded all of `node_modules` (and any `dist/`), so a rule about those packages could never match anything. It now excludes `.next`/`.turbo`, *our* `dist` folders, and node_modules **except** paths containing those two packages (pnpm's `.pnpm/` layout needs the `.*` form). They are still `doNotFollow`, so nothing inside them is cruised: +4 modules, +9 dependencies | A rule that cannot fire is not a control | enforce it with eslint `no-restricted-imports` instead (kept as a fallback; depcruise already owns the boundary table) |
| D-48 | 2026-09-21 | Deps added (Phase 5): `viem` in `packages/risk` (the simulation client), `@steward/risk` in `packages/wallet` (`sweepHome` must simulate before it evaluates), `@steward/wallet` + `viem` + `zod` in `apps/worker` (the `exec.confirm` handler and its payload schema), and `@steward/db`/`@steward/policy`/`@steward/risk`/`drizzle-orm` as root devDependencies so `scripts/live` typechecks. No new third-party dependency | Each is an existing workspace package or viem, already in the stack | — |
| D-49 | 2026-09-21 | **`scripts/live/executor-e2e.ts` mints an ephemeral 32-byte receipt key when `RECEIPT_HMAC_SECRET` is absent** (it is not in `.env.local` today, and the task forbids editing that file), and defaults `DATABASE_URL` to the documented docker-compose URL. The property the executor relies on — a receipt must be signed with the key the executor holds — is preserved exactly by a per-run key. The key is never printed or persisted, and the script says loudly that it did this | The alternative was not running the live gate | edit `.env.local` (forbidden); skip the live gate (rejected) |
| D-50 | 2026-09-21 | **`exec.confirm` is registered in `apps/worker` but nothing enqueues it yet.** PHASES 5.5 asks for the handler; 6.5/6.6 own scheduling and the boot-time resume. The live script and the fork tests call `confirmExecution` directly, so the code path is exercised end to end regardless | Keeps the phase boundary honest | schedule it now (rejected: Phase 6 scope) |
| D-51 | 2026-09-21 | **The decision loop lives in `apps/worker/src`, not a new package.** It needs `reasoning` + `policy` + `risk` + `wallet` + `db` + `context` together, which no existing package may import; a new package would have added a build target and a barrel for one consumer | Fewest moving parts; `packages-no-apps` already forbids the wrong direction | a `packages/agent` package (rejected: one consumer) |
| D-52 | 2026-09-21 | **SERV is not offered `risk_exit`.** `DISCRETIONARY_KINDS` omits it, so a model-authored risk exit cannot exist and the Phase 4 defect (the verifier reads an exit as a liquidity breach and DISAGREEs ⇒ R15 DENY on a pre-authorised safety action) is unreachable. Risk exits are a deterministic trigger (6.2a) and skip R15 by `source` | Closes the hole without a prompt v3, without re-recording the golden fixtures, and without re-running the 60-case adversarial corpus against a changed prompt. One fewer kind on the LLM's menu is strictly safer | verifier prompt v3 + re-record (rejected for this phase; still the right move if a SERV-sourced risk exit is ever wanted) |
| D-53 | 2026-09-21 | **The `degraded` flag is published as audit events, not a column.** The SERV breaker lives in the worker process; it writes `SERV_DEGRADED` / `SERV_RECOVERED` to the system audit chain and `GET /api/wallet` reads the latest transition | No migration, and the flag is append-only and hash-chained like every other state change | a `wallets.degraded` column (rejected: a migration for a process-local, service-wide flag) |
| D-54 | 2026-09-21 | **6.9 is a structured timing log, not OpenTelemetry.** Elapsed ms per step (`gather`, `screen`, `propose`, `verify`, `pipeline`) in one pino line and in `agent_decisions.serv_meta` | PHASES 6.9 explicitly allows this ("skip if it needs heavy deps"); the OTel SDK is four packages to ship six numbers | @opentelemetry/sdk-node (deferred) |
| D-55 | 2026-09-21 | **The web app enqueues; it never decides.** `/api/agent/run` and the approval handler insert a pg-boss job (`apps/web/lib/queue.ts`); the worker re-verifies the owner signature, re-gathers state, re-simulates and re-evaluates | Keeps `check:arch`'s owner-path rules true by construction and means a compromised web process can ask for an iteration but cannot perform one. **No dependency-cruiser rule was changed in Phase 6** | calling the loop inline from the route (rejected) |
| D-56 | 2026-09-21 | **`packages/wallet/src/demoOracle.ts` takes a structural `CdpDemoAdmin` port instead of importing `@coinbase/cdp-sdk`.** The DEMO-only `price.refresh` job therefore needed **no** change to `cdp-only-in-wallet-bootstrap` | The rule stays exactly as Phase 5 left it. The module is still fenced at construction (DEMO_MODE + chain 84532), encodes only `setPrice(uint256)` from a 1-entry ABI, targets only the configured feed, and moves no tokens | adding demoOracle.ts to the allowlist (rejected: weakening a rule we were told never to weaken) |
| D-57 | 2026-09-21 | **New dependencies:** `pg-boss` + `pg` added to `apps/web` (the queue insert) and to the repo root devDependencies (the live runner); `@types/pg` + the existing workspace packages added to `apps/worker`. No new third-party runtime dependency was introduced — all of these were already in the lockfile for other workspaces | justification required by CLAUDE.md §7 | none |
| D-58 | 2026-09-21 | **`scripts/live/loop-e2e.ts` derives the owner key from `SESSION_SECRET` instead of generating a random one per run.** Still in memory only: never written to disk, never printed, never sent anywhere; the script refuses anything but chain 84532 with DEMO_MODE on | A fresh random key per run strands that run's testnet USDC at an address whose key is gone the moment the run crashes — which happened twice, and the CDP faucet is rate-limited per project. Deriving it makes the treasury stable on this machine and nowhere else | keep it random and re-faucet each time (rejected: the faucet is the bottleneck) |
| D-59 | 2026-09-21 | **A loop tick with nothing to do writes ONE `NOOP` audit row and NO `agent_decisions` row**, and the DEMO half-step is one-shot (`half: true` in the payload) rather than re-queued by its own handler | DATA_MODEL already says `agent_decisions` is "one per loop iteration that reached reasoning or a deterministic proposal"; the old behaviour wrote 100 decision rows in a 10-minute live run and would have made the Phase 7 timeline useless. `singletonKey` is not a uniqueness constraint on a standard-policy pg-boss queue, so the payload flag is what makes the cadence exactly 2/min | keep the rows and paginate them away in the UI (rejected: unbounded growth in an append-only log) |
| D-60 | 2026-09-21 | **Design tokens are Tailwind v4 `@theme inline` over `--st-*` custom properties.** The indirection is what lets `prefers-color-scheme` and a `data-theme` attribute (on `<html>` *or* any wrapper) both drive the same tokens | The preview renders both themes on one page without client JS, and Phase 7 gets a theme toggle for free | a `dark:` variant class strategy (rejected: needs JS on `<html>` and doubles every colour utility) |
| D-61 | 2026-09-21 | **Fonts are Public Sans + IBM Plex Mono, both OFL, via `next/font/google`.** Mono is reserved for machine data (addresses, hashes, rule codes, the literal signing message) and forbidden for prose labels | Public Sans was drawn for plain-language, accessibility-audited government services, which is this product's exact register, and it is neither the reflex family nor Solflare's FK Grotesk | Inter/Geist (rejected: reflex defaults) |
| D-62 | 2026-09-21 | **No new dependency for the design pass.** Screenshots come from `scripts/design-shots.mjs`, which drives the Chrome already installed on the machine over the DevTools protocol using Node 22's built-in `WebSocket`. `eslint.config.js` gained Node globals for `**/*.mjs` | Playwright/Puppeteer is a browser download for four PNGs. Chrome's `--window-size` will not go below ~500px on Windows, so the 390px shots need `Emulation.setDeviceMetricsOverride` regardless | `playwright` (rejected), `--screenshot` alone (rejected: cannot reach 390px) |
| D-63 | 2026-09-21 | **Scrims and other translucent surfaces use explicit `color-mix(in srgb, ...)` tokens, never Tailwind's `/60` opacity modifier.** | The opacity modifier resolves in **oklab**, and its computed value cannot be composited and contrast-checked in sRGB - which is how the sheet's real contrast went unverified in the first pass | `bg-ground/60` (rejected once it proved unmeasurable) |
| D-64 | 2026-09-21 | **Third-party reference imagery is studied, not committed.** `docs/design/refs/` holds sampled tokens and measurements in `REFERENCE.md`; `*.png|jpg|jpeg|webp` there is git-ignored | Committing Solflare's marketing art to a repo that may go public is redistribution; the measurements are what the design pass actually needs | committing the screenshots (rejected: safer option per CLAUDE.md 2) |
| D-65 | 2026-09-22 | **Accent is one light green `#AEF07A`** (hover `#98DE5F`, ink on it `#0B120B`), replacing the reference's measured `#FFEF46` in all eight of its roles | Hue 94 deg at luminance 0.727 against the yellow's 0.834: near-identical value, so the value structure of the reference survives the swap, and near-black ink on it is 14.06:1 | the pastel mint `#A8F0B8`-`#C6F6D5` family the brief suggested (rejected: hue 133 sits on top of the verdict green, making the collision worse, and it loses the yellow's punch) |
| D-66 | 2026-09-22 | **The "allowed" verdict moves off the accent hue to teal `#2FD9A6`, and every verdict always renders a glyph and a word.** Glyph fill is a third channel (filled disc / outlined ring / filled disc with slash) | The brand accent is now green, so green-means-safe would be ambiguous. Measured dE 41 between accent and allow, and dE 42 after a Brettel/Vienot deuteranopia simulation. Amber and red converge under that simulation, which is exactly why the glyph-and-word rule is not optional | keeping green for "allow" and shading the accent (rejected: unverifiable at a glance) |
| D-67 | 2026-09-22 | **Dark is the default theme; light is the alternate.** `:root` carries the dark values and `prefers-color-scheme: light` opts out | All 26 reference frames are dark. v1 was light-first | keeping light-first (rejected: contradicts the brief) |
| D-68 | 2026-09-22 | **Fonts are Figtree + Geist Mono, both OFL, via `next/font/google`**, replacing Public Sans + IBM Plex Mono (supersedes D-61) | Figtree has the single-storey `g`, tall x-height and geometric-humanist build of the reference's FK Grotesk (commercial, so unusable) and is variable. Public Sans is a different register and no longer matches the reference | Plus Jakarta Sans, Outfit (rejected: double-storey `g`, further from the reference); licensing FK Grotesk (out of scope) |
| D-69 | 2026-09-22 | **A `--minor` token (`#626974` dark / `#858D9B` light) for the dimmed minor units of the balance figure**, rather than reusing `--line` | The reference dims the decimals to near-invisibility. At `--line` that is 1.3:1; at `--minor` it is 3.3:1, which is the AA floor for text at 44px/700. The cents stay legible to anyone who looks for them | reusing `--line` (rejected: fails even the large-text floor), `aria-hidden` on the decimals (rejected: makes the announced amount wrong) |
| D-70 | 2026-09-22 | **Still no new dependency.** The preview's icons are inline SVG paths built from one 1.75px-stroke geometric family | `design-taste-frontend` and `tastemaker` both discourage hand-rolled icons, but adding Phosphor or Iconify to ship a design-only preview page is a production dependency for a reference artifact. Recorded as the reason the anti-slop score is held at 8 | `@phosphor-icons/react` (deferred: revisit if the Phase 7 build needs an icon set for real screens) |
| D-71 | 2026-09-22 | **No new icon dependency.** Icons stay the one hand-drawn 1.75px family, now shared from `components/icons.tsx` | The brief allowed Phosphor "if insufficient"; the set covers every glyph used and D-70 stands | Phosphor (rejected: more weight for no missing glyph) |
| D-72 | 2026-09-22 | **New deps: `wagmi` + `@tanstack/react-query` (connect; react-query also drives all polling, so no SWR), `jsdom` + `@testing-library/react` + `@testing-library/dom` (component tests), workspace links to `@steward/policy` and `@steward/reasoning` (compile route)** | One data hook for the whole app; V-14 mandates wagmi | SWR (rejected: second cache) |
| D-73 | 2026-09-22 | **APY is `null` on the real dashboard** ("Vault rate not reported"); only fixtures show one | No rate source is wired; inventing a number is the fake precision DESIGN forbids | Hard-coded mock rate (rejected) |
| D-74 | 2026-09-22 | **The browser never imports `@steward/policy` or the `@steward/shared` root** (they pull env/pino); rule sentences and explanations are produced by the routes, and the client imports `@steward/shared/client` | Keeps server code out of the bundle; sentences come from the same table as the engine | Copy of `ruleSentences` in the client (rejected: drift) |
| D-75 | 2026-09-22 | **`serverExternalPackages` + webpack externals for `@coinbase/cdp-sdk`, `@x402`, `@solana`** in `next.config.ts` | Bundling the SDK fails on a mismatched `@solana/kit`; any route importing `@steward/wallet` returned 500 in `next dev` (no earlier phase ran a wallet route in Next). It only runs server-side | Pinning the solana packages |
| D-76 | 2026-09-22 | **A wallet row is created at first sign-in**, treasury = the owner's smart wallet | Nothing created it, so provision returned NO_WALLET for every real user | Create it in the provision route |
| D-77 | 2026-09-22 | **A frozen dashboard disables Approvals and Add funds but keeps Recipients and Activity reachable**; "attacks blocked" counts all DENY verdicts | Read-only screens must stay open while frozen; a DENY is the engine's own "blocked" | Disable the whole action row |
| D-78 | 2026-09-22 | **`/api/policy/prepare` takes no request body.** The policy to be signed is rebuilt from server rows (stored mandate draft + current recipient rows + the wallet's chain and treasury) on BOTH prepare and activate, rather than the client posting a draft back as API.md's `{ draft }` suggests | A client-supplied draft is a policy the owner could edit between reading and signing. Re-deriving means a signature is only ever accepted for a body this server would have asked for, and if anything moved in between the hash moves, the message moves, and the old signature simply stops verifying (I5) | accepting `{ draft }` and validating it (rejected: validation cannot tell an edited draft from the intended one) |
| D-79 | 2026-09-22 | **The policy body hash covers the body WITHOUT `signature`, and `policy.createdAt` is the mandate row's `createdAt`, not the clock** | `zPolicy` carries its own `signature`, so hashing the signed body would be circular. A clock reading would make two prepares of the same policy produce two hashes and two messages, and the owner's signature would go stale between reading and clicking | storing a draft policy row at prepare time (rejected: a lifecycle to maintain for no extra safety) |
| D-80 | 2026-09-22 | **The recipient confirmation message is `Steward recipient` + one labelled line per fact + `Nonce:` + `Expires:`**, with every control character and line separator in the owner-supplied label collapsed to a space in the message builder AND refused by the request schema | SECURITY §5 fixes only the approval format; this one follows the same shape so a wallet shows plain sentences. Without the stripping, a label containing a newline could forge an `Address:` line and the owner would read one address while signing another (T3) | reusing the SIWE nonce (rejected: issuing one would interfere with signing in), no nonce at all (rejected: API.md requires one for sensitive routes) |
| D-81 | 2026-09-22 | **`cancelApprovalsForPolicyChange` moved from `apps/worker/src/approvals.ts` to `@steward/db`** | Phase 6 left it uncalled and noted "Phase 8 must call it from `/api/policy/activate`". The web app may not import the worker, and copying ten lines into the route would leave two definitions of a security-relevant cleanup. It only ever used `cancelPendingApprovals` + `appendAudit`, both already in `@steward/db` | a copy in the route (rejected: drift), a `@steward/worker` dependency from the web app (rejected: would need a new arch rule) |
| D-82 | 2026-09-22 | **The plain-EOA warning fires only when the account has no deployed bytecode AND the connector is not the Coinbase Smart Wallet connector** | A Smart Wallet that has never sent a transaction is counterfactual and has no code yet, so missing bytecode alone would block legitimate owners. False negatives are harmless: `assertSmartWalletAccount` still refuses server-side (D-5). This only decides whether the owner reads an explanation first | bytecode alone (rejected: blocks counterfactual wallets), connector id alone (rejected: breaks if a second connector is ever configured) |
| D-83 | 2026-09-22 | **Adding a recipient inserts the row and leaves the policy version to the policy flow**, which reads the allowlist fresh on every `/api/policy/prepare`; the add response returns `needsPolicySignature` | API.md says a recipient add "triggers new policy version draft". Making the next prepare include it gives the same result with no draft-row lifecycle, and the owner sees the addition in the S7 diff before signing it. The recipient is inert until then, which is the safe direction | storing a draft policy row (rejected: lifecycle), making the add itself activate a policy (rejected: two signatures fused into one click) |
| D-84 | 2026-09-22 | **Still no new dependency for 7.6.** The allowance control is `<input type="range">` over a fixed bigint ladder and the end date is `<input type="date">` | Native controls are keyboard-accessible and localised for free; a slider or date-picker library would be a production dependency for two inputs | a slider/date-picker package (rejected) |
| D-85 | 2026-09-22 | **S7's "recompile -> diff -> sign" reuses `MandateStep` + `PolicySign` unchanged**, rather than building a second compile UI or a second diff computation for the policy screen | 7.6's hand-off says embed, do not rebuild; `PolicySign`'s call to `/api/policy/prepare` already diffs the next body against the active one (`diffSentences`), so a second implementation would just be two ways to compute the same thing | a standalone diff view fed by a new endpoint (rejected: two diff implementations to keep in sync) |
| D-86 | 2026-09-22 | **`components/freeze/UnfreezeSlot.tsx` added as a marked extension point** instead of building any unfreeze logic in 7.7 | SECURITY §5 requires an owner signature and a circuit-breaker reset for unfreeze; that belongs to task 7.8 (Opus) alongside `FreezeFlow`, and there is no `/api/unfreeze` route to call yet. A disabled slot that explains itself is safer than a fake flow | implementing a real unfreeze signature flow now (rejected: no route exists, and freeze/unfreeze belong to the same owner-only code path as one review) |
| D-87 | 2026-09-22 | **`GET /api/audit/export` is cursor-paginated (row id + limit), not streamed**, and CSV pagination is signalled via an `x-next-cursor` response header rather than a body field | Matches `listAuditPage`'s own ponytail note and `verifyChain`'s existing "loads the whole chain, paginate later" precedent; a hackathon-scale wallet's audit log does not need a real stream yet, and CSV's body cannot carry a JSON sidecar field | true streaming response (rejected: overbuilt for current scale); omitting pagination entirely (rejected: task explicitly asks for it) |
| D-88 | 2026-09-22 | **"Delete personal data" (S11) only clears `users.display_name`** via a new `scrubUserPersonalData` in `@steward/db`; the owner's address is kept (it is the sign-in identity, not incidental PII) and `audit_log` rows are never touched, matching I6 and UX_FLOWS' "audit rows retained anonymized" | The spec explicitly forbids deleting or mutating audit rows; `display_name` is the only PII field `users` owns beyond the address itself | scrubbing/pseudonymizing audit `entity_id`/`payload` fields too (rejected: would mutate append-only rows, violates I6) |
| D-89 | 2026-09-22 | **No new dependency for 7.7.** CSV export is hand-rolled (`csvField` quoting: wrap in quotes and double any embedded quote when a field contains a comma, quote or newline) rather than a CSV library, for one export route with eight simple columns | A CSV writer is a few lines; a dependency for it would be disproportionate | a CSV library (rejected: unjustified for this shape) |
| D-90 | 2026-09-22 | **The freeze/unfreeze message is `Steward {action}` + `Wallet:` + `Nonce:` + `Expires:`**, issued by one `/api/freeze/prepare` for both actions, with the ACTION stored in the session beside the nonce and the message re-derived from the session (never from the request body) | SECURITY §4 requires "session + fresh signature" but fixes no format; this follows the recipient message's shape (D-80). Storing the action with the nonce is what stops a signature collected for an unfreeze being spent on a freeze — a separate prepare route per action would not, since the browser chooses which route to call | one prepare route per action (rejected: two nonces, same replay hole), a fixed message with no nonce (rejected: replayable), a timestamp instead of a nonce (rejected: not single-use) |
| D-91 | 2026-09-22 | **`POST /api/sweep` calls `sweepHome` inline rather than enqueueing a job**, even though API.md says "enqueues owner-sourced `sweep_home`" | I7 outranks API.md's wording: freeze, revoke and sweep must work with the worker down, and a queued sweep would not. It is not a bypass — `sweepHome` still builds an `source: 'owner'` proposal, simulates it, runs the real `evaluate()` and needs a signed AllowReceipt. Cost: the request blocks until the user operation is submitted | enqueueing via pg-boss (rejected: depends on the worker, breaks I7), a fire-and-forget promise in the route (rejected: unobservable, dies with the lambda) |
| D-92 | 2026-09-22 | **The revoke is a transaction the OWNER's own wallet sends** (wagmi `useSendTransaction` over `encodeRevoke` calldata the server supplies), and `POST /api/spend-permission/revoked` records it **only when `isRevoked` agrees on-chain** — the reported `txHash` is never taken as proof | `SpendPermissionManager.revoke` must be called by the permission's `account`, which is the owner's smart wallet, not the agent. Trusting a reported hash would let a caller mark a live permission revoked in Steward's own records while it still worked on-chain | `revokeAsSpender` from the executor (rejected: the agent giving up its own authority is a different, weaker guarantee and needs the agent wallet alive), trusting the txHash (rejected: unverified claim) |
| D-93 | 2026-09-22 | **Freezing cancels every pending approval**, writing an `APPROVAL_CANCELLED` audit row per approval, reusing `cancelPendingApprovals` from `@steward/db` | SECURITY §4 step 2 says so explicitly ("cancel all pending approvals and queued jobs for the wallet"). A pending approval is a standing permission to act; leaving it redeemable would contradict "act on nothing". `cancelApprovalsForPolicyChange` was not reused because its audit reason is the policy version, not the freeze | leaving approvals pending and relying on the executor's frozen re-check (rejected: the queue would still show live cards, and defence in depth is cheaper than one check) |
| D-94 | 2026-09-22 | **`apps/web/lib/wallet.ts` may build the agent `TxSender`** (`getAgentSender`) for the sweep path only, mirroring the worker's `senderFactory` | The sweep is the one thing the web app must be able to execute without the worker (I7). `cdp-only-in-wallet-bootstrap` already names this exact file as the only place in `apps/web` that may construct a CDP client, and `packages/wallet/src/executor.ts` is still the only module that calls `send` | duplicating the sender in the route (rejected: would need a new arch-rule exception), importing the worker (rejected: forbidden boundary) |
| D-95 | 2026-09-22 | **A step the owner cannot start yet renders no control at all**, and the modal renders no step list until `GET /api/freeze` has answered | Visual QA: a disabled `Button` is `bg-surface-2`, the step card's own colour, so it read as unexplained bold text; and a placeholder built from the dashboard's `frozen` flag told a frozen wallet "There is no spending permission to revoke" when it had one. A one-fetch "Checking what has already happened…" is honest; a guess is not | a distinct disabled style (rejected: invites pressing something that cannot work), keeping the optimistic placeholder (rejected: it stated something false about the owner's own money) |
| D-96 | 2026-09-22 | **The global Freeze control stays a button once frozen** (`aria-live` for the state change, never `role="status"`) | Freezing is step 1 of three; an owner who froze and closed the modal must be able to reopen it to revoke and sweep. Overriding the role would also stop assistive technology announcing it as a button | a separate "resume" entry point elsewhere (rejected: a second door to the same flow), leaving the dead chip (rejected: strands the owner mid-flow) |
| D-97 | 2026-09-22 | **Still no new dependency for 7.8.** Screenshots keep using the existing headless-Chrome/CDP script; the revoke and sweep steps poll with a plain `setTimeout` loop rather than a polling library | Consistent with D-84/D-89; react-query is already in the app but these are imperative one-shot flows inside a modal, not cache-backed reads | a polling/retry library (rejected: a `for` loop with a sleep is the whole requirement) |
| D-98 | 2026-09-22 | **7.9: 17 uses of `text-faint` on regular small uppercase labels (incl. the shared `Eyebrow` primitive) swapped to `text-muted`**, and `Balance`'s `aria-label` moved off its role-less `<span>` onto a `sr-only` text node | axe (`@axe-core/playwright`, run against the freeze modal while 7.10 was in progress) caught both as real WCAG failures: DESIGN.md's own contrast table marks `faint`-on-`ground` "AA large / UI" only (4.23:1, below the 4.5:1 regular-text floor), and `aria-label` is not a permitted attribute on a role-less span (4.1.2). Kept on 7.9's ledger even though 7.10 itself was dropped, because the bugs are real and in 7.9's own audit scope (DESIGN §12) | leaving `text-faint` and citing DESIGN's table as sufficient (rejected: the table's own "AA large/UI" caveat says it is not sufficient for this usage); adding a new contrast-checking dependency (rejected: axe already caught it, no need for a second tool) |
| D-99 | 2026-09-22 | **Task 7.10 (Playwright e2e) skipped by explicit human decision mid-session**, its in-progress work (test-mode signer, `playwright.config.ts`, four specs, `apps/web/lib/e2e.ts`, and the `wagmi.ts`/`useSigner.ts`/`package.json`/lockfile changes it needed) fully reverted rather than committed half-working | Human: "manual testing preferred over Playwright"; PHASES.md lists 7.10 as a SHOULD. The work was not yet green (2 of 3 remaining failures were test-harness bugs — a wrong chain-id hex constant, ambiguous `getByRole` locators — not product bugs), so per "never mark a phase complete with failing or skipped tests" the honest move was to discard it rather than land a partially-working suite | leaving the broken suite committed but excluded from the gate (rejected: dead, untested code in the tree); finishing it anyway (rejected: explicit human instruction to stop) |
| D-60 | 2026-09-21 | **A DEMO-only `MockUSDC` (6 decimals, owner-mintable) plus a `MockVault` over it**, deployed by the demo admin via CREATE2 and selected with shell `USDC_ADDRESS` / `MOCK_VAULT_ADDRESS` overrides | DEMO.md prescribes exactly this when the faucet is too small, and Circle's testnet USDC is rate-limited per CDP project — it blocked the live gate twice. It also unblocks Phase 9's rehearsals. Product code is unchanged: these are env values, and I11 already fences DEMO_MODE to chain 84532 where the UI must show the DEMO DATA banner | keep waiting on the faucet (rejected: not repeatable) |

## Known issues / risks
### Phase 6
- **RR-13 — PreChecks size proposals at the $1 parity when there is no oracle quote.**
  `microUsdToBase` converts `runwayBufferMicroUsd` / `perTxMicroUsd` with the quote when one exists
  and with $1.00 otherwise. That only decides *how big a proposal to write down*; the Policy Engine
  redoes the conversion properly and R08/R06/R10/R12 deny or escalate if the sizing was wrong. It is
  a heuristic that can produce a proposal the engine then refuses — never one it wrongly permits.
- **RR-17 — quiescence is now a property the tests pin, not an emergent one.** A tick with nothing
  to do writes one `NOOP` audit row and no decision row (D-59). That is the right record, but it
  means the timeline shows *actions*, not *attention*: "the agent looked and did nothing" is only in
  the audit chain, not in `agent_decisions`. Phase 7's UI should read the `NOOP` audit events if it
  wants to show liveness.
- **RR-14 — R17 and the deterministic path interact. FIXED, with a consequence worth knowing.**
  Deterministic proposals are a pure function of balances, so an action the engine refuses is
  rebuilt identically on the next tick. A live run produced 21 identical `pay_recipient` DENYs, all
  correctly refused by R07's rolling daily cap. PreChecks now take R17's `recentProposalHashes` and
  go quiet when the only available action is already inside that window. Nothing is weakened — R17
  denies a repeat anyway, so an action the engine *would* permit has a hash that is not in the set.
  **The consequence:** because obligations outrank yield (priority b before c), a stuck obligation
  parks the whole wallet until the window rolls or the policy changes. That is the right answer on
  its own terms — if payroll cannot be met, idle cash should not be locked into a vault — but it is
  a behaviour Phase 7 must surface, not hide: the `NOOP` audit row carries the reason.
- **RR-15 — the payroll-before-yield ordering differs from DEMO.md's narration.** PreChecks pay an
  obligation that is due *before* deploying idle cash (6.2 priority b before c), so a live run emits
  pull → pay → pull → deposit rather than DEMO.md's "pull 50k → deposit 44k → pay". The safer order
  was kept; Phase 9's demo script should either seed the obligation as due tomorrow or narrate the
  actual order.
- **RR-16 — `untrusted` is currently only the vault names plus whatever the caller injects.**
  `gather` fences every policy vault's on-chain `name` (a genuinely attacker-controlled string for
  any vault we did not deploy) and accepts `extraUntrusted` from the caller. There is no memo store
  yet, so the DEMO attack beat needs Phase 9's `scripts/demo/attack.ts` to supply the memo through
  that seam. RR-7 is therefore only half closed.
- **The `exec.confirm` job's visibility timeout is still pg-boss's default** while
  `confirmExecution` polls in-process for up to 3 minutes (carried from Phase 5). A worker restart
  mid-confirm leaves the row for `resumeCrashWindow` on the next boot, which is correct but slower
  than a matching `expireInSeconds` would be.
- **The retry backoff still sleeps in-process** (Phase 5 note, unchanged): up to 15 minutes inside
  one `execute()` call. It should become a pg-boss retry so a restart does not lose the schedule.
- **`loop.tick`'s DEMO half-step is best-effort.** One cron tick queues exactly one half-step at
  +30 s (`half: true`, so it cannot spawn another — D-59). If the worker restarts between the cron
  tick and the half-step, that 30-second slot is simply skipped.
- **`risk.scan` writes a vault snapshot every minute per wallet** with no retention. Fine at
  hackathon volume, unbounded growth in principle.
- **The SERV breaker is per-process.** A second worker instance would keep its own counter. The
  worker is single-instance in the MVP (ARCHITECTURE §7) and the advisory lock is what makes scaling
  safe; the breaker would need to move into the database first.
- **Two runs of the live script were lost to testnet funding, not to code.** The CDP faucet is
  rate-limited per project, and the first two runs each stranded their USDC at an ephemeral
  treasury. Fixed by D-58 and then by the DEMO MockUSDC pair (D-60); recorded because the Phase 9
  demo will hit the same faucet limit.
- **The live runner's `boss.stop({ graceful: true })` takes ~1 minute to drain** the cron workers
  after the watch window closes, so a `pnpm live:loop 10` process lives about 11 minutes. Cosmetic,
  but `apps/worker/src/index.ts`'s SIGTERM handler uses a bare `boss.stop()` and should get the
  same treatment plus a timeout before Phase 9 deploys it.
- **`MockUSDC` is mintable by the demo admin without limit.** That is the point, and it is fenced to
  DEMO_MODE on chain 84532 where the UI must show the DEMO DATA banner — but it means a demo
  treasury balance proves nothing about real funds, and Phase 9's copy must not imply otherwise.

### Phase 5
- **`.env.local` is missing `RECEIPT_HMAC_SECRET`, `DATABASE_URL` and `SESSION_SECRET`** (it carries
  only the CDP / SERV / RPC values). The live run worked around the first two (D-49), but **Phase 6
  cannot**: the web app signs receipts and the worker verifies them, so they must share one
  `RECEIPT_HMAC_SECRET`. **Human action:** add `RECEIPT_HMAC_SECRET` (32+ random bytes),
  `DATABASE_URL`, `SESSION_SECRET`, plus `MOCK_VAULT_ADDRESS`/`MOCK_PRICE_FEED_ADDRESS` from
  `docs/addresses.md`, to `.env.local`.
- **The MockPriceFeed quote was 41,828 s old during the live run**, so R12 (max age 60 s) would have
  denied every price-sized action. The run fell back to the I11 parity (fenced to 84532) and said so.
  Phase 6/9 need a `price.refresh` job that calls `setPrice` as the demo admin, or the demo will
  fail closed on stage.
- **The fork harness cannot batch.** An impersonated anvil EOA sends the calls of one action
  sequentially, so for `sweep_home` the last receipt shows the gross transfer rather than the net
  batch effect; the fork test therefore asserts the on-chain outcome instead of the log-based effect
  check. The live run (one batched user operation) covers the batched path.
- **Stale `anvil` processes break the fork suite.** A leftover anvil on port 8545/8546 from an
  aborted run serves a chain with previous state; the Phase 2 suite failed exactly that way once
  during this phase and passed after killing it. The suites should bind a random port (or probe and
  refuse) — not done.
- **The retry backoff sleeps in-process** (up to 15 minutes for four attempts). Correct and testable
  via the injected `sleep`, but Phase 6 should hand the backoff to pg-boss retries so a worker
  restart does not lose the schedule.
- **`reconcileExecution`'s lookback is capped at 5,000 blocks** (~2.7 h on Base). An older crash
  cannot be scanned automatically and must be reconciled by hand; the audit trail has the calls and
  the receipt nonce, so it is always possible, just manual.
- **`confirmExecution` polls in-process for up to 3 minutes.** Fine as a pg-boss job, but Phase 6.5
  should give the job a matching visibility timeout.
- **The notification body is plain text with no localisation or templating** — Phase 8.5 owns
  notifications properly; these rows exist so the breaker and the UNCERTAIN state are not silent.
- Phase 3's open item "`simulation.approvals` must actually be populated" is now **closed**:
  `extractApprovals` fills it from the calls the risk gate simulated, and the fork test asserts the
  deposit produces exactly `[{token: USDC, spender: VAULT, amount}]`.

### Phase 4
- **The verifier does not know about R20.** Live example D: the proposer correctly proposed
  `risk_exit`, and the verifier DISAGREEd because the exit reduces liquidity — which would turn a
  pre-authorised safety action into a DENY. Deterministic risk exits (`source='deterministic'`) skip
  R15 entirely so the demo path is safe, but a SERV-sourced `risk_exit` would be blocked. **Fix in
  Phase 6 with a verifier prompt v3** (one line: a risk exit is pre-authorised and is judged on the
  trigger, not on the liquidity it frees) and re-record the fixtures.
- **Examples A and C return `noop` live** (D-37). Phase 6 must supply the idle-cash trigger
  deterministically or add a `deployableNow` fact.
- **`packages/context` does not decide what is untrusted** (RR-7). Phase 6's gatherer must put every
  third-party string into `ContextInput.untrusted`; vault/token names are sanitized on the way in but
  only the `untrusted` list is screened.
- **The golden tests skip when fixtures are missing** rather than failing, so a deleted fixture
  directory quietly removes coverage. Deliberate (a fresh clone has no API key) but worth a CI flag.
- **`screenUntrusted` costs one SERV call per iteration with any untrusted text**, and the budget in
  SERV_REASONING §7 is ≤ 3 calls per actionable iteration. `propose` + `verify` + `screen` = 3, and a
  schema repair makes 4. Phase 6 should count the repair against the budget or accept 4.
- **`explain` is not rate-limited or async yet** — SERV_REASONING §7 says it should be non-blocking.
  Phase 6 owns that scheduling.

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
- **Phase 6 is complete and the Phase 7 *design pass v2* is done** (`docs/DESIGN.md` v2, the v2
  tokens, the Figtree/Geist Mono swap, and the rebuilt static `/preview` page). Waiting for the
  human to say "continue" before any screen is built.
- **Phase 7 build: Sonnet for 7.1-7.5, 7.7, 7.9, 7.10 using `docs/DESIGN.md`; Opus for 7.6 and 7.8.**
  Run `/model sonnet` for the Sonnet tasks. Every screen follows `docs/DESIGN.md` 11's handover
  rules - tokens only, `<Money />` only, the approval message verbatim, and glass only where 6
  allows it.
- **7.6, 7.7 and 7.8 are done (2026-09-22).** Next is **7.9 (Sonnet)**: mobile responsiveness and
  keyboard access for the approval and freeze flows (NFR-7), then **7.10** (Playwright e2e). See
  "Known issues / notes for 7.9-7.10" under Phase 7 part 4 for what each one inherits.
  **Phase 7 is NOT complete**: 7.9 and 7.10 remain, and Phase 8.1 still formally owns hardening the
  owner-path routes 7.8 built (rate limiting, session hardening, CSRF, worker-side revoke detection).
- Screenshots: `docs/design/shots/app/` now holds all 20 app screens at 390 and 1280 px in dark and
  light (80 files), including the 7.7 screens and the three S9 steps. Regenerate with
  `DEMO_MODE=true pnpm --filter @steward/web dev` then `node scripts/app-shots.mjs`.
  Fixture scenarios: `1`, `frozen`, `safe`, `paused`, `quiet`, `onboarding`, `sign-limit`,
  `sign-policy`, and (7.8) `freeze-revoke`, `freeze-sweep`.
- Do not start the Phase 7 build before the human says so.
- `.env.local` now carries everything the worker and the live runner need (verified by
  `pnpm live:env`, which prints variable NAMES only). `USDC_ADDRESS` and
  `SPEND_PERMISSION_MANAGER_ADDRESS` are absent and fall back to the verified defaults in
  `packages/shared/src/env.ts`.

### Public API of Phase 6 (what the Phase 7 UI and Phase 8 consume)
```ts
// apps/worker/src/loop.ts
runIteration(deps: DecisionLoopDeps, walletId: string, trigger: DecisionTrigger)
  => Promise<DecisionOutcome>
type DecisionTrigger = 'schedule'|'balance'|'obligation'|'risk'|'owner'|'approval'
type DecisionOutcome = { status: 'locked' }
                     | { status: 'skipped'; reason }
                     | { status: 'noop'; decisionId; reason }
                     | { status: 'failed'; code; message; decisionId? }
                     | ({ decisionId } & PipelineOutcome)
DISCRETIONARY_KINDS                     // the kinds SERV may choose (no risk_exit, D-52)

// apps/worker/src/pipeline.ts — build -> simulate -> evaluate -> ALLOW/ESCALATE/DENY
runPipeline(deps: PipelineDeps, input: PipelineInput) => Promise<PipelineOutcome>
type PipelineOutcome = { status:'executed'; verdict; execution }
                     | { status:'escalated'; verdict; approval }
                     | { status:'denied'; verdict }
                     | { status:'failed'; verdict?; code; message }
serializeEvaluationInput(i)             // what the VERDICT audit row stores for replay

// apps/worker/src/prechecks.ts — PURE
preChecks(input: PreCheckInput): PreCheck   // skip | noop | deterministic | discretionary
MIN_ACTION_BASE_UNITS = 100_000n ; PAYROLL_FLOAT_DAYS = 7

// apps/worker/src/gather.ts
gather(deps: GatherDeps, walletId): Promise<Result<Gathered, GatherError>>
buildContextOf(g, manager, allowMainnet)   // -> BuildContext for buildCalls/executor

// apps/worker/src/approvals.ts
verifyApprovalSignature(publicClient, { owner, message, signature })
executeApproval(deps, approvalId): Promise<Result<PipelineOutcome, ApprovalError>>
cancelApprovalsForPolicyChange(db, walletId, newVersion, now)   // call from /api/policy/activate
rejectApproval(db, approvalId, now)

// apps/worker/src/replay.ts — NFR-4
replay(db, decisionId, walletId): Promise<Result<ReplayResult, ReplayError>>
type ReplayResult = { decisionId; stored; replayed: Verdict; identical: boolean;
                      differences: string[]; auditRowId: number }

// apps/worker/src/lock.ts
tryWalletLock(pool, walletId) / withWalletLock(pool, walletId, fn)
LOOP_LOCK_NAMESPACE = 0x4C4F4F50          // distinct from the audit chain's 0x41554454

// apps/worker/src/jobs.ts
registerJobs(deps: JobDeps): Promise<void>
resumeCrashWindow({ boss, db, publicClient, now? })
  => { resumed; uncertain; neverSent }     // never sends
addOneMonth(dueDate: 'YYYY-MM-DD'): string // day clamped to 28
LOOP_TICK_QUEUE='loop.tick'  LOOP_RUN_QUEUE='loop.run'
OBLIGATIONS_SCAN_QUEUE='obligations.scan'  RISK_SCAN_QUEUE='risk.scan'
APPROVALS_EXPIRE_QUEUE='approvals.expire'  APPROVALS_EXECUTE_QUEUE='approvals.execute'
PRICE_REFRESH_QUEUE='price.refresh'        EXEC_CONFIRM_QUEUE='exec.confirm'

// apps/worker/src/runtime.ts
publicClientFor(env) / receiptKeyFor(env) / servClientFor(env) / priceAdapterFor(env, pc)
demoPriceRefresherFor(env) / senderFactory(env)
class ServBreaker    // SERV_FAILURE_THRESHOLD = 3, SERV_COOLDOWN_MS = 5 min
```

HTTP routes Phase 7 consumes (all owner-session authenticated, zod-validated, no secrets out):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/agent/run` | enqueues `loop.run`; 409 while frozen or breaker-open; `{ enqueued, jobId }` |
| GET | `/api/decisions?cursor=&limit=` | `{ decisions: [{ id, trigger, status, proposal, proposalHash, proposalSource, contextHash, screen, createdAt, verdict }], nextCursor }` |
| GET | `/api/decisions/:id` | `{ decision (incl. contextSnapshot, verifier, servMeta), verdict (all rule results), simulation, execution, approval, audit[] }` |
| GET | `/api/approvals?status=pending` | `{ approvals: [{ id, decisionId, proposalHash, status, message, expiresAt, decidedAt, proposal, rationale }] }` — **`message` is the literal text to sign; the UI must not rebuild it** |
| POST | `/api/approvals/:id/approve` | `{ signature }`; 409 `policy_version_changed`, 410 `expired`, 401 `bad_signature`, 403 `owner_mismatch`, 409 `not_pending` |
| POST | `/api/approvals/:id/reject` | no signature required (rejecting only ever prevents an action) |
| GET | `/api/wallet` | now also returns `degraded: boolean` (6.7) |

New in `@steward/shared`: `approvalMessage(input)` (SECURITY §5, verbatim) and `APPROVAL_TTL_MS`.
New in `@steward/db`: `listActiveWalletIds`, `listRecipients`, `listVaultRows`, `setVaultFlagged`,
`listObligationsDue`, `listObligationsUntil`, `ensureNextOccurrence`, `insertAgentDecision`,
`updateAgentDecision`, `getAgentDecision`, `listAgentDecisions`, `insertVerdict`,
`getVerdictForDecision`, `getSimulationForDecision`, `getPolicyVersion`, `insertApproval`,
`getApproval`, `listApprovals`, `decideApproval`, `expirePendingApprovals`,
`cancelPendingApprovals`, `listNotifications`, `recentDecisionProposalHashes`,
`pendingApprovalHashes`, `setWalletFrozen`, `listAuditForEntity`.
New in `@steward/wallet`: `createCdpClient`, `cdpTxSender`, `demoPriceRefresher` (DEMO-only, I11).

**Phase 8 must call `cancelApprovalsForPolicyChange` from `/api/policy/activate` and from the freeze
path** — the helper exists and is tested, but nothing calls it yet (the routes it belongs in are
Phase 7/8 work). Until then, a policy bump is still safe: `executeApproval` refuses a stale message
outright (`POLICY_VERSION_CHANGED`), so the cancellation is hygiene, not the control.

### Public API of `packages/risk` (what Phase 6 calls)
```ts
// 5.1 simulation — eth_simulateV1, never throws
simulateProposalCalls(input: SimulateInput): Promise<Result<SimulationResult, SimulateError>>
type SimulateInput = { publicClient; calls: readonly SimCall[]; from: Address; token: Address;
                       holders: { agent; treasury; recipient? } }
type SimulationResult = { ok: boolean; deltas: Delta[]; approvals: SimulatedApproval[];
                          blockNumber: bigint; gasUsed: bigint; error?: string }
type SimulateErrorCode = 'UNSUPPORTED' | 'TRANSPORT' | 'MALFORMED'
extractApprovals(calls): SimulatedApproval[]      // -> EvaluationInput.simulation.approvals (R18)
simulationRow({ decisionId, calls, callsHash, result })   // -> db.insertSimulation

// 5.2 prices
interface PriceAdapter { name; getPrice(token): Promise<Result<PriceQuoteResult>> }
mockPriceFeedAdapter({ publicClient, feed, token, chainId, demoMode }): Result<PriceAdapter>  // I11
priceSnapshotRow(token, quote)                    // -> db.insertPriceSnapshot

// 5.3 triggers — pure
detectRiskTriggers({ vaults: {vaultId,current,previous?}[], vaultDrawdownBps,
                     depegThresholdBps, assetMicroUsd? }): RiskTrigger[]
```

### Public API of the Phase 5 half of `@steward/wallet`
```ts
// 5.4 executor — the ONLY module that may broadcast a proposal's calls
execute(deps: ExecuteDeps, input: ExecuteInput): Promise<Result<ExecuteOutcome, ExecError>>
type ExecuteDeps  = { db; sender: TxSender; receiptKey: Uint8Array; now: () => Date; sleep? }
type ExecuteInput = { walletId; decisionId; proposal; policy; receipt: AllowReceipt;
                      buildContext: BuildContext; simulatedCallsHash: Hex }
type ExecuteOutcome = { status: 'submitted'; execution; calls }
                    | { status: 'duplicate'; execution }          // I10 — nothing sent
                    | { status: 'cancelled'; execution; reason }  // frozen/breaker — nothing sent
interface TxSender { getAddress(): Address; send(calls): Promise<{ userOpHash?; txHash? }> }

// 5.6 error taxonomy
classifyError(e): ExecError                       // { code, message, class: 'retryable'|'fatal' }
RETRY_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000] ; MAX_SEND_ATTEMPTS = 4

// 5.5 confirmer + 5.7 breaker
confirmExecution(deps: ConfirmDeps, input: ConfirmInput): Promise<Result<ConfirmOutcome, string>>
type ConfirmDeps  = { db; publicClient; now; sleep?; resolveTxHash?; timeoutMs?; pollIntervalMs? }
type ConfirmInput = { executionId; expectedDeltas; token; holders; obligationId?; counterpartyLabel? }
type ConfirmOutcome = {status:'confirmed'|'failed'|'timeout'|'settled'; …}   // timeout = UNCERTAIN
tripBreaker(db, walletId, reason, now): Promise<Result<true, string>>        // call on an R14 breach
observedDeltas(receipt, token, holders) / compareDeltas(expected, observed, toleranceBps)
BREAKER_FAILURE_THRESHOLD = 3 ; CONFIRM_TIMEOUT_MS = 180_000

// crash window (boot hook is Phase 6.6)
listCrashWindow(db, walletId?): Promise<ExecutionRow[]>          // pending + submitted
reconcileExecution(deps, execution, agentWalletAddress)
  => 'has-hash' | 'uncertain' | 'never-sent'                     // never sends

// 5.8 owner path
sweepHome(deps: SweepDeps, walletId): Promise<Result<{verdict; execution?}, SweepError>>
type SweepDeps = { db; publicClient; sender; receiptKey; now; decisionId;
                   spendPermissionManagerAddress; allowMainnet?; usdcQuote? }
assertAllowedTargets(calls, policy, ctx)          // now exported (the executor re-checks pre-send)
```
New in `@steward/db`: `claimExecutionSlot` (the atomic nonce burn + idempotent execution claim),
`getExecutionById`, `updateExecution`, `listUnresolvedExecutions`, `getWalletById`,
`bumpBreakerFailures`, `resetBreakerFailures`, `openBreaker`, `insertLedgerEntry`, `outflowsSince`,
`countExecutionsSince`, `recentProposalHashes`, `getActivePolicy`, `insertSimulation`,
`insertPriceSnapshot`, `insertVaultSnapshot`, `latestVaultSnapshot`, `insertNotification`,
`setObligationStatus`, `getUserIdForWallet`.
New in `apps/worker`: `registerConfirmJob({ boss, db, env })`, `EXEC_CONFIRM_QUEUE = 'exec.confirm'`,
`zConfirmJob` (the job payload schema — deltas travel as decimal strings).
New in `@steward/shared`: `SimulatedApproval` type, `MOCK_PRICE_FEED_ADDRESS` env var (optional).

### Public API of `packages/context` (what Phase 6 calls)
```ts
buildContext(input: ContextInput): Context        // pure: no I/O, no clock, no env
factIds(ctx: Context): string[]                   // -> EvaluationInput.contextFactIds (R19)
FACT_IDS                                          // the id vocabulary (F_BAL_*, F_VAULT_<id>_*, OBL_<id>, …)
sanitizeText(raw, max = 500): { text, signals }   // NFKC, strip invisible/control/TAG, neutralise
                                                  // markup, redact addresses + opaque tokens, truncate
sanitizeLabel(raw, max = 80): string
type ContextInput = {                             // Phase 6 fills this from db + wallet + risk
  now: Date; decimals: number;
  policySummary: readonly string[];               // renderPolicyAsSentences(policy)
  allowedKinds: readonly ProposalKind[];
  balances: { treasuryUsdc; agentUsdc; allowanceRemaining: bigint; allowancePeriodEnds?: Date };
  vaults: { id; name; positionBaseUnits: bigint; apyPct?; apySource?; flagged? }[];
  recipients: { id; label; scheduleDayOfMonth? }[];
  obligations: { id; recipientId; dueDate: Date; amountBaseUnits: bigint }[];
  priceUsdc: { microUsd: bigint; publishedAt: Date };
  outflowsLast24hBaseUnits: bigint;
  riskTriggers: { vaultId; trigger; observed }[];
  untrusted: { id; source; text }[];              // EVERY third-party string (RR-7)
}
type Context = { snapshotHash: Hex; now; facts: Fact[]; policySummary; allowedKinds;
                 vaults: {id,name}[]; recipients: {id,label}[]; untrusted: UntrustedItem[];
                 screen: { injectionSuspected: boolean; signals: string[] } }
```
`Fact.baseUnits` exists for the deterministic grounding check and is **stripped by the prompt
builder's allowlist** — the model only ever sees the display value.

### Public API of `packages/reasoning` (what Phase 6 calls)
```ts
// client
interface ServClient { complete(req: ServRequest): Promise<Result<ServResponse, ServError>> }
new LiveServClient({ apiKey: Secret<string>, baseURL, timeoutMs?, maxRetries?, backoffMs?, log?, sleep?, now? })
  .complete(req) / .listModels()                  // listModels uses the raw {items:[{modelId}]} shape (D-4)
new FixtureServClient(fixtures?, scripted?)       // replay by request hash; unknown => FIXTURE_MISSING
requestHash(req): Hex

// the five tasks — none of them throws; every failure degrades to the safe answer
compileMandate({ client, model, mandateText, binding: TemplateBinding })
  => { draft?: PolicyDraft; sentences: string[]; issues: PolicyIssue[]; assumptions: string[]; questions: string[]; meta? }
screenUntrusted({ client, model, items })
  => { injectionSuspected: boolean; signals: string[]; meta? }          // -> EvaluationInput.screen
propose({ client, model, ctx, usdcAddress, decimals })
  => { proposal: Proposal; issues: string[]; meta? }                    // never anything but NOOP on failure
verify({ client, model, ctx, proposal, decimals })
  => { verifier: { verdict: 'AGREE'|'DISAGREE'|'UNSURE'; reasons: string[] }; checkedFactIds; meta? }
explain({ client, model, verdict })
  => { text: string; fallback: boolean; meta? }

// deterministic pieces, usable without SERV
screenText(text, extraSignals?) / screenItems(items): { hit: boolean; signals: string[] }
mapProposal(servOutput, { ctx, usdcAddress, decimals }, rawTexts?)      // the IDs-only + grounding gate
noopProposal(rationale): Proposal
loadPrompt(name) / promptVersions(): Record<PromptName, number>         // store with each decision
contextPayload(ctx) / fenceUntrusted(items)                             // exactly what goes on the wire
SERV_SCHEMAS                                                            // the strict json_schema per task
type CallMeta = { requestIds: string[]; model; promptVersion; repaired; usage?; raw: string[] }
```
Phase 6 notes: `source` must be set by the loop, never by a model (RR-3). `meta.requestIds` are the
SERV request ids for `agent_decisions` / the timeline (V-12 asks for SERV usage evidence).
`meta.promptVersion` plus `ctx.snapshotHash` make a decision reproducible (NFR-4).

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
