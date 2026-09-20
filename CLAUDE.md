# CLAUDE.md — Steward Operating Manual for Claude Code

> Read this file at the start of EVERY session, before touching code.
> This repository is built **only** from the specs in `/docs`. Do not invent scope.

## 1. What we are building (one paragraph)

**Steward** is a non-custodial-by-design, agent-operated stablecoin treasury for crypto-native
startups, DAOs and solo founders. The owner writes a plain-English **Mandate**. Steward compiles it
into a machine **Policy**, then runs an autonomous loop that keeps idle USDC productive (ERC-4626
vault deposits/withdrawals), pays allowlisted recipients on schedule, and exits risky positions
(depeg guard). **SERV Reasoning proposes; deterministic code disposes.** An LLM output can never
move funds by itself: every proposal passes a pure Policy Engine, a risk/simulation gate, and is
capped on-chain by a Coinbase **Spend Permission**. Execution happens through **Coinbase AgentKit**.
Tagline: *"The self-driving treasury that can't run off with the money."*

Hackathon: SERV Hackathon by OpenServ — **AgentKit track**. Judging: Creativity, User-readiness,
Revenue potential. But we build for production quality; the hackathon is prototype #1.

## 2. Source of truth & read order

1. `CLAUDE.md` (this file) — invariants and workflow
2. `docs/PHASES.md` — the ONLY build plan. Work phase by phase.
3. `docs/PROGRESS.md` — current state; update it at the end of every work session
4. The docs listed under "Read first" for the current phase

Full doc index:

| File | Purpose |
|---|---|
| `docs/PRD.md` | Product requirements, scope, functional requirements (FR-*) |
| `docs/ARCHITECTURE.md` | System design, monorepo layout, stack, runtime flows, env vars |
| `docs/SECURITY.md` | Threat model, custody model, 5 security layers, failure matrix |
| `docs/POLICY_ENGINE.md` | Policy schema, rule catalogue (R-*), verdicts, allow-receipts |
| `docs/SERV_REASONING.md` | SERV client, reasoning tasks, prompts, schemas, validation |
| `docs/AGENTKIT_INTEGRATION.md` | AgentKit setup, action mapping, spend permission flow |
| `docs/DATA_MODEL.md` | Database tables, fields, relations, constraints |
| `docs/API.md` | HTTP routes (web) and internal service interfaces |
| `docs/UX_FLOWS.md` | Screens, states, copy rules, edge cases |
| `docs/TESTING.md` | Test strategy, adversarial corpus, exit-gate commands |
| `docs/DEMO.md` | 3-minute hackathon demo script + seeding + attack scripts |
| `docs/VERIFY.md` | External facts that MUST be verified before relying on them |
| `docs/PROGRESS.md` | Living status log + decision log (ADR-lite) |

**Conflict resolution** (higher wins): `SECURITY.md` > `POLICY_ENGINE.md` > `ARCHITECTURE.md` >
`PRD.md` > everything else. If specs are ambiguous, choose the **safer** option, implement it,
and record the decision in `docs/PROGRESS.md` → Decisions.

## 3. Non-negotiable invariants

Breaking any of these is a failed phase, regardless of tests passing.

- **I1 — Reasoning never touches funds.** Only `packages/wallet/src/executor.ts` may invoke AgentKit
  *write* actions, and only with a valid, unexpired, unused `AllowReceipt` from the Policy Engine.
- **I2 — Policy Engine is pure.** `packages/policy` has no network I/O, no LLM imports, no
  `Date.now()` (clock is injected), no randomness, no env access. Enforced by `pnpm check:arch`.
- **I3 — The LLM gets no write tools.** Never pass AgentKit write actions to any LLM tool-calling
  API. Context gathering is deterministic code.
- **I4 — Exact-match destinations.** Recipients/contracts must match the allowlist by checksummed
  address equality. No ENS resolution at execution time, no prefix/suffix "similarity".
- **I5 — Fail closed.** Verdict precedence `DENY > ESCALATE > ALLOW`. Unknown kind, parse error,
  stale data, thrown exception ⇒ `DENY` or `NOOP`. Never default to `ALLOW`.
- **I6 — Append-only audit.** Every context snapshot, proposal, verification, verdict, execution,
  approval, freeze and revocation writes an `audit_log` row. DB trigger blocks UPDATE/DELETE.
- **I7 — Owner always wins.** Freeze, revoke and sweep-home work even if the LLM, SERV, or the
  worker is down. They never call the reasoning layer.
- **I8 — Testnet by default.** Chain = Base Sepolia (84532). Code refuses chain 8453 unless
  `STEWARD_ALLOW_MAINNET=true` AND the Phase 9 mainnet gate in `PHASES.md` is signed off by the human.
- **I9 — Secrets.** Only in `.env.local` (git-ignored). Never logged (pino redaction), never
  included in LLM prompts, never returned by APIs.
- **I10 — Idempotency.** Every execution is keyed by `proposal_hash`; receipt nonces are single-use
  (unique DB constraint). Retries reuse the key.
- **I11 — Demo overrides are fenced.** Mock prices/rates only when `DEMO_MODE=true` AND chainId is
  84532. The UI shows a persistent "DEMO DATA" banner when active.
- **I12 — Money math.** Token amounts are `bigint` base units. USD values are integer micro-USD
  (`bigint`, 6 decimals). No JS `number` for money, anywhere.

## 4. Model policy (Sonnet vs Opus)

Each phase in `docs/PHASES.md` declares a **Model**. Before starting work:

1. Check which model you are running as.
2. If it does not match the phase's required model, **stop** and tell the human:
   *"Phase N requires <Opus|Sonnet>. Please run `/model opus` (or `/model sonnet`) and re-prompt."*
3. Some phases list **sub-task overrides** (e.g. a Sonnet phase with one Opus task). Treat those the same way.

Rule of thumb used to assign models:

| Use **Opus** (critical) | Use **Sonnet** (low → medium criticality) |
|---|---|
| Anything that can move, lock or lose funds | Scaffolding, config, tooling |
| Policy Engine rules and receipt crypto | DB schema boilerplate, CRUD APIs |
| Executor, spend permissions, key handling | UI screens, styling, copy |
| LLM prompt/validation boundary (injection defense) | Notifications, logging plumbing |
| Security review gates, adversarial testing | Docs, demo scripts, seed data |
| Failure/recovery logic (freeze, idempotency) | Refactors with full test coverage |

## 5. Workflow for every phase

1. Read `docs/PROGRESS.md` to find the current phase. Never skip a phase.
2. Confirm the model (Section 4).
3. Read the phase's "Read first" docs.
4. Write a short plan into `docs/PROGRESS.md` under the phase heading (task checklist).
5. Implement tasks **in the listed order**. Write tests alongside code, not after.
6. Run the phase's **Exit Gate** commands. All must pass.
7. For phases marked **Opus review gate**, perform the listed review checklist and record findings.
8. Update `docs/PROGRESS.md` (done items, decisions, known issues, next step).
9. Commit: `phase-N: <summary>` (conventional, small commits during the phase are fine).
10. **Stop and report** to the human: what was built, gate results, open risks.
    Do not start the next phase until the human says so.

## 6. Commands (defined in Phase 1)

```bash
pnpm install          # install workspace
pnpm dev              # web (3000) + worker, with local Postgres via docker compose
pnpm build            # build all packages/apps
pnpm typecheck        # tsc --noEmit across workspace
pnpm lint             # eslint
pnpm test             # vitest unit + integration
pnpm test:adversarial # prompt-injection & attack corpus (Phase 4+)
pnpm test:e2e         # playwright (Phase 7+)
pnpm check:arch       # dependency-cruiser: enforces I1/I2/I3 import boundaries
pnpm db:migrate       # drizzle migrations
pnpm db:seed:demo     # demo seed (Phase 9)
pnpm contracts:test   # forge test (Phase 2+)
```

## 7. Coding standards

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`, no `@ts-ignore` without a comment + issue.
- Validate every external boundary with **zod** (HTTP input, LLM output, env, RPC responses, DB JSON).
- Return `Result<T, E>` (discriminated union) from domain functions; throw only for programmer errors.
- Logging: `pino`, structured, with redaction paths for keys/secrets/signatures.
- Addresses: always `getAddress()` (viem) checksummed before storing or comparing.
- Pure functions for anything testable; side effects at the edges.
- Every new module gets tests. Policy Engine target: 100% branch coverage.
- No new dependency without a one-line justification in `PROGRESS.md` → Decisions.

## 8. When things don't match reality

External APIs (AgentKit, CDP, SERV, Spend Permissions) evolve fast. Items in `docs/VERIFY.md`
**must** be verified in Phase 0. If reality differs:
- Use the documented **fallback** in `VERIFY.md`.
- If no fallback fits, stop and ask the human. Do not silently weaken a security invariant to make an API work.

## 9. Things you must never do

- Never give an LLM a tool that can sign or send transactions.
- Never add "temporary" bypasses of the Policy Engine (including for demos or tests against real RPC).
- Never store or print private keys, CDP secrets, wallet secrets, or SIWE session secrets.
- Never use mainnet funds. Never hardcode an address that was not verified in `VERIFY.md`.
- Never mark a phase complete with failing or skipped tests.
- Never expand scope beyond `PRD.md` without the human's approval.
