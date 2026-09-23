# Steward

**The self-driving treasury that can't run off with the money.**

Steward is a non-custodial-by-design, agent-operated stablecoin treasury for crypto-native startups,
DAOs and solo founders. The owner writes a plain-English **Mandate**. Steward compiles it into a
machine **Policy**, then runs an autonomous loop that keeps idle USDC productive (ERC-4626 vault
deposits/withdrawals), pays allowlisted recipients on schedule, and exits risky positions (depeg
guard). **SERV Reasoning proposes; deterministic code disposes.** An LLM output can never move funds
by itself: every proposal passes a pure Policy Engine, a risk/simulation gate, and is capped on-chain
by a Coinbase **Spend Permission**. Execution happens through **Coinbase AgentKit**.

Built for the SERV Hackathon by OpenServ (AgentKit track), and beyond a hackathon prototype: every
invariant below is enforced by tests and by `pnpm check:arch`, not by convention.

## Architecture

```
 Owner (browser, Coinbase Smart Wallet passkey)
   │  SIWE auth · grant Spend Permission · sign Policy · sign approvals · FREEZE
   ▼
┌──────────────────────── apps/web (Next.js App Router) ────────────────────────┐
│  UI: onboarding, mandate editor, policy review, dashboard, timeline, approvals │
│  API routes: /api/auth, /api/mandate, /api/policy, /api/approvals, /api/freeze │
└──────────────┬───────────────────────────────────────────────┬────────────────┘
               │ Postgres (Drizzle)                            │ owner-path (no LLM)
               ▼                                               ▼
┌──────────────────────── apps/worker (Node) ───────────────────────────────────┐
│ Scheduler (pg-boss) ─► DecisionLoop per wallet                                 │
│   1 ContextBuilder (packages/context)  — balances, vault positions, prices,   │
│        obligations, allowance, recent spend, untrusted external text (fenced) │
│   2 PreChecks (deterministic)          — frozen? breaker? nothing to do? NOOP │
│   3 InjectionScreen (packages/reasoning) — heuristics + SERV classifier       │
│   4 Proposer (SERV)                    — schema-forced Proposal JSON          │
│   5 ShadowVerifier (SERV, independent) — AGREE / DISAGREE / UNSURE            │
│   6 PolicyEngine (packages/policy, PURE) — ALLOW / ESCALATE / DENY + codes    │
│   7 RiskGate (packages/risk)           — viem simulation + oracle freshness   │
│   8 Receipt signer                     — HMAC AllowReceipt (short TTL)        │
│   9 Executor (packages/wallet)         — verifies receipt ─► AgentKit actions │
│  10 Confirmer                          — waits for receipt, reconciles ledger │
│  every step ─► audit_log (append-only, hash-chained)                          │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               ▼
        Coinbase AgentKit (CdpSmartWalletProvider + action providers)
                               ▼
   Agent Operating Wallet (CDP smart account, gasless via paymaster on Base)
       ▲ pulls ≤ allowance via SpendPermissionManager.spend()
       │
   Owner Treasury (Coinbase Smart Wallet) ──── Base Sepolia (84532)
       ▲ sweep_home always returns funds here (immutable destination)
       │
   ERC-4626 vault (MockVault on testnet; Morpho/Aave-class vault on mainnet)
```

Full design detail: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`.

## Security model

**SERV Reasoning proposes; deterministic code disposes.** The reasoning layer never holds a write
tool (`packages/wallet` is the only package `check:arch` lets construct a CDP client, enforced by
dependency-cruiser fixtures, not convention); every proposal is re-derived and re-checked by a pure
Policy Engine (`packages/policy`, 100% branch coverage, no network I/O, no clock, no randomness) and
capped on-chain by a Coinbase Spend Permission the owner signs directly. Verdict precedence is fixed:
`DENY > ESCALATE > ALLOW`, and every unknown/parse-error/stale-data case fails closed.

`docs/SECURITY_REVIEW.md` is the formal Phase 8 review: **no HIGH finding, the review gate PASSES.**
Its own words on what the custody model actually guarantees:

> Worst case is not zero. It is bounded. An attacker who fully compromises the Steward operator —
> the CDP credentials _and_ the receipt HMAC key — can move, at most, the agent wallet's USDC
> balance, plus the value of the vault shares the agent holds, plus whatever is left of the current
> period's allowance. That figure is not hidden: it is computed by `maxAtRisk` and shown to the
> owner on the dashboard as **"Maximum at risk."**

A fully compromised backend still cannot exceed the allowance — proven on-chain, not just argued:
Phase 2's live run rejected a spend attempted after revoke (see Evidence below). Removing the bound
entirely (session keys / ERC-7715 on the owner's own account, so funds never leave it) is the named
production path (`ARCHITECTURE.md` §4 OQ-2) and is not built in this MVP.

The adversarial prompt-injection corpus (`packages/reasoning/adversarial`) runs 60 cases (48
malicious, 12 benign): **guarantee 48/48 (100%) blocked or safely NOOP'd**, benign false-positive
rate 0/12. `pnpm test:adversarial` re-runs it.

## How SERV and AgentKit are used

- **SERV Reasoning** (`docs/SERV_REASONING.md`) compiles the plain-English mandate into a policy
  draft, proposes each iteration's action as schema-forced JSON, runs an independent shadow verifier
  that can DISAGREE with its own proposer, and classifies untrusted third-party text for injection —
  deterministic heuristics run first and a hit alone is enough to flag; SERV can only ever _add_
  signals, never clear one. Every SERV call's request id is stored on the decision row and shown in
  the timeline (evidence it actually ran, not simulated): live smoke recorded request ids such as
  `chatcmpl-EQQdqQmT2F6v6LPbfFTfixVagIUg3` (propose) and `chatcmpl-EQQdvc8Xzc00P1YVjmI99rLj8EjDS`
  (screen) against `https://inference-api.openserv.ai/v1` — full table in `docs/PROGRESS.md` Phase 4.
- **Coinbase AgentKit** (`docs/AGENTKIT_INTEGRATION.md`) is the only path anything ever sends a
  transaction through: `buildAgentKit` in `packages/wallet` never hands its bundle to an LLM (I3),
  and `packages/wallet/src/executor.ts` is the sole caller, gated on a valid, unexpired, unused
  `AllowReceipt`. Real Base Sepolia evidence: a gasless self-transfer user op
  `0xcf17df480a9d61122a19c476520e44d18e9d1452a8f60345ee7023598b162dd4` confirmed with 0 ETH in the
  wallet and no paymaster URL set; a real Spend Permission approve
  `0xa403d31bb0c3164106d0e1c3cc69f79e01b67cd1392636f38aa61c2c9906dd6c`, a real agent spend
  `0xb832ce0a2af4457bbbb3dff3191b23adb53eee15f8f5a86c4f2abe275981386c`, and a real owner revoke
  `0x57caacd5d5f71499a8e3239f2af8745d23a0d0bff526f5542d197f073d13bc92` after which the chain itself
  rejected any further spend. Full list in `docs/PROGRESS.md`'s Phase 0/2 verification log (V-04, V-05).

## Setup

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install
docker compose up -d --wait      # Postgres on localhost:5433
pnpm db:migrate
pnpm dev                          # web (:3000) + worker
```

Environment variables go in a git-ignored `.env.local` at the repo root — names only, values are
never checked in or logged (I9):

`DATABASE_URL`, `SESSION_SECRET`, `RECEIPT_HMAC_SECRET`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`CDP_WALLET_SECRET`, `CDP_PAYMASTER_URL`, `SERV_API_KEY`, `SERV_BASE_URL`, `SERV_MODEL_PROPOSER`,
`SERV_MODEL_VERIFIER`, `RPC_URL_BASE_SEPOLIA`, `USDC_ADDRESS`, `SPEND_PERMISSION_MANAGER_ADDRESS`,
`MOCK_VAULT_ADDRESS`, `MOCK_PRICE_FEED_ADDRESS`, `DEMO_MODE`, `CHAIN_ID`, `STEWARD_ALLOW_MAINNET`,
`TELEGRAM_BOT_TOKEN`. `scripts/live/env-check.ts` (`pnpm live:env`) prints which names are present —
never a value.

Gates: `pnpm typecheck && pnpm lint && pnpm check:arch && pnpm test && pnpm test:adversarial`.

## Demo

The full 3-minute script, seeding values and attack scenarios are in `docs/DEMO.md`. To rehearse:

```bash
DEMO_MODE=true CHAIN_ID=84532 pnpm db:seed:demo   # demo owner, Alex/Priya, obligations due today, policy
STEWARD_LIVE=1 pnpm demo:attack                   # live: injection-blocked beat (must DENY/NOOP)
STEWARD_LIVE=1 pnpm demo:drawdown                 # live: MockVault.simulateLoss(300bps) -> R20 exit
pnpm demo:reset                                   # clears prior-run state, unfreezes, re-seeds
```

Open `/demo` (not linked from the app's own navigation — it's an internal rehearsal aid) for a live
checklist of every beat in `docs/DEMO.md`, read from the same `/api/dashboard` the real dashboard
uses.

## Known limitations

Honestly, not sold short (see `docs/SECURITY.md` §9 and `docs/SECURITY_REVIEW.md` §6/§9 in full):

- **The agent operating wallet is CDP server-controlled**, not a session key on the owner's own
  account. The bound above (`maxAtRisk`) is real and enforced, but it is a bound, not zero exposure.
  The production fix (session keys / ERC-7715 on the owner's account) is designed, not built.
- **No 24-hour cooldown on recipient/policy changes yet** (finding F-1, MEDIUM): an attacker holding
  the owner's _wallet_ could add a recipient and pay it in the same hour, bounded only by the per-tx/
  daily caps and remaining allowance. Spec'd as rule R22, not yet built.
- **No live browser click-test of the Coinbase Smart Wallet passkey flow.** Every spend-permission
  and executor path is proven against real Base Sepolia transactions from scripts, not from a human
  clicking through the actual wallet-connect popup.
- **Audit-tail truncation is a formally accepted residual risk for the MVP** (finding F-9): the
  hash chain detects edits and insertions, not a truncation of its own tail by someone holding
  database-owner credentials — which the application role does not have. `SECURITY_REVIEW.md` §6.1
  has the production plan (a second DB role; an external periodic anchor).
- **Vault smart-contract risk is not eliminated** — the allowlist only admits vetted vaults; R20's
  drawdown/depeg exit is a reaction, not a guarantee the vault itself is safe.
- **LLM classifiers are probabilistic** and are never the last line of defense — the deterministic
  heuristics and the Policy Engine are.
- **DEMO_MODE data proves nothing about real funds.** `MockUSDC`/`MockVault`/`MockPriceFeed` are
  fenced to `DEMO_MODE=true` and chain 84532 only (I11), with a persistent "DEMO DATA" banner.
- Rate limiting and the SERV circuit breaker are per-process (`docs/PROGRESS.md` D-107 and
  `SECURITY_REVIEW.md` §7); a shared store is needed before horizontal scale-out.

## Roadmap (not built)

Session-key custody on the owner's own account (ERC-7715/7702), a Safe module for DAO multi-signer
approvals, multi-chain support, a Sentinel API for other agent builders, consumer savings and RWA
vaults, compliance/KYT packs. See `docs/PHASES.md` 9.9 and `docs/PITCH.md` for the pitch on these.

## Docs

`docs/PRD.md` · `docs/ARCHITECTURE.md` · `docs/SECURITY.md` · `docs/SECURITY_REVIEW.md` ·
`docs/POLICY_ENGINE.md` · `docs/SERV_REASONING.md` · `docs/AGENTKIT_INTEGRATION.md` ·
`docs/DATA_MODEL.md` · `docs/API.md` · `docs/UX_FLOWS.md` · `docs/TESTING.md` · `docs/DEMO.md` ·
`docs/PITCH.md` · `docs/VERIFY.md` · `docs/PROGRESS.md`.
