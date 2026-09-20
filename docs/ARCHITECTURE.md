# ARCHITECTURE — Steward

## 1. System diagram

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
│  every step ─► audit_log (append-only)                                         │
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

SERV Reasoning endpoint: OpenAI-compatible, `https://inference-api.openserv.ai/v1` (verify: `VERIFY.md` V-01).

## 2. Monorepo layout

```
steward/
├─ CLAUDE.md
├─ docs/                      # all specs (this folder)
├─ apps/
│  ├─ web/                    # Next.js 15, App Router, Tailwind, wagmi, OnchainKit
│  └─ worker/                 # Node 22, decision loop, scheduler, confirmer
├─ packages/
│  ├─ shared/                 # zod schemas, types, constants, money utils, Result type
│  ├─ db/                     # drizzle schema, migrations, repositories, audit writer
│  ├─ policy/                 # PURE policy engine + mandate validator (no I/O!)
│  ├─ reasoning/              # SERV client, prompts, proposer, verifier, compiler, screen
│  ├─ context/                # context builder, fact IDs, untrusted-text fencing
│  ├─ risk/                   # simulation (viem), oracle adapters, risk scoring
│  └─ wallet/                 # AgentKit bootstrap, action registry, executor, spend perms
├─ contracts/                 # Foundry: MockVault (ERC-4626), MockPriceFeed (demo)
├─ scripts/                   # demo seed, attack injection, vault-drawdown trigger
├─ docker-compose.yml         # postgres 16
└─ .dependency-cruiser.cjs    # import-boundary enforcement
```

### Import boundaries (enforced by `pnpm check:arch`)

| Package | May import | Must NOT import |
|---|---|---|
| `policy` | `shared` | anything else (no viem clients, no db, no reasoning, no wallet, no fetch) |
| `reasoning` | `shared`, `context` (types only) | `wallet`, `db` write repos |
| `wallet` | `shared`, `policy` (receipt verify), `db` | `reasoning` |
| `risk` | `shared` | `reasoning`, `wallet` |
| `apps/web` owner-path routes (`/api/freeze`, `/api/sweep`) | `wallet`, `db`, `shared` | `reasoning` |

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22) | AgentKit TS SDK is primary; one language end to end |
| Package mgr | pnpm workspaces + turbo | fast, simple monorepo |
| Web | Next.js 15 App Router + Tailwind + shadcn/ui | fast UI, API routes co-located |
| Wallet UI | wagmi + viem + OnchainKit + Coinbase Smart Wallet | passkeys, Spend Permission signing |
| Auth | SIWE + iron-session (httpOnly cookie) | wallet-native auth |
| Agent execution | `@coinbase/agentkit` (`CdpSmartWalletProvider`) | required by track; gasless smart wallet |
| Reasoning | SERV via `openai` SDK with custom `baseURL` | OpenAI-compatible |
| Validation | zod | boundaries |
| DB | Postgres 16 + Drizzle ORM | relational audit data, triggers |
| Queue/scheduler | pg-boss | no extra infra (uses Postgres) |
| Chain client | viem | simulation, reads, encoding |
| Contracts | Foundry | MockVault/MockPriceFeed for testnet demo |
| Tests | vitest, fast-check, Playwright, anvil | unit/property/e2e/fork |
| Logging | pino (+ redaction) | structured |
| Observability | OpenTelemetry → console/Sentry (optional) | traces per loop iteration |
| Hosting | Vercel (web), Railway/Fly (worker), Neon (Postgres) | cheap and quick |

## 4. Custody model (MVP) — read with SECURITY.md

- **Owner Treasury**: owner's Coinbase Smart Wallet. Steward never holds its keys.
- **Agent Operating Wallet**: a CDP smart account created by AgentKit, one per owner. Its signing
  secret lives with CDP (server wallet). Steward backend can instruct it.
- **Bridge between them**: a Coinbase **Spend Permission** granted by the owner treasury to the agent
  wallet (USDC, `allowance` per `period`). The agent pulls funds with `SpendPermissionManager.spend`.
- **Exposure bound**: worst case loss ≈ agent-wallet balance + remaining allowance in current period
  (+ vault shares held by agent wallet). This is shown to the owner as "Maximum at risk".
- **Home**: `sweep_home` destination is always the owner treasury address stored at onboarding,
  never changeable by the agent or by any LLM output.
- **Production path (OQ-2)**: move to session keys / ERC-7715 permissions on the owner account so
  funds never leave the owner's account. Designed for, not built in MVP.

## 5. Runtime flow — one decision-loop iteration

```
trigger(walletId, reason)
 → lock(walletId)                           # pg advisory lock; one loop per wallet
 → if frozen or breaker_open → audit(SKIPPED) → unlock
 → ctx = ContextBuilder.build(walletId)     # facts with IDs + snapshot hash
 → audit(CONTEXT, ctx.hash)
 → pre = PreChecks(ctx, policy)             # deterministic: obvious NOOP? mandatory safety action?
 → screen = InjectionScreen(ctx.untrusted)  # flags attached to ctx
 → proposal = Proposer(ctx, policy)         # SERV → zod-validated Proposal | NOOP
 → audit(PROPOSAL)
 → if NOOP → done
 → verdict_v = ShadowVerifier(ctx, policy, proposal)  # SERV, separate prompt
 → audit(VERIFICATION)
 → sim = RiskGate.simulate(proposal, ctx)   # viem eth_call, deltas, oracle freshness
 → verdict = PolicyEngine.evaluate({policy, proposal, ctx.state, sim, verifier:verdict_v,
                                    screen, now, ledger})   # PURE
 → audit(VERDICT, rule codes)
 → ALLOW    → receipt = sign(proposalHash, policyVersion, nonce, expiresAt=now+120s)
              → Executor.execute(proposal, receipt)  → audit(EXECUTION_SUBMITTED)
              → Confirmer waits → audit(EXECUTION_CONFIRMED|FAILED) → ledger update
 → ESCALATE → approvals.create(expires 24h) → notify owner
 → DENY     → notify if security-relevant (injection, poisoned address)
 → unlock
```

Approval path: owner signs → `/api/approvals/:id/approve` verifies signature over proposal hash →
re-runs PolicyEngine with `ownerApproval` present (still must pass hard rules) → receipt → Executor.

## 6. Environment variables

Put in `.env.local` (never committed). `.env.example` lists names only.

| Var | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | all | Postgres |
| `CHAIN_ID` | all | `84532` default |
| `RPC_URL_BASE_SEPOLIA` | worker, web | public or provider RPC |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` / `CDP_WALLET_SECRET` | worker | AgentKit/CDP (names: verify V-03) |
| `CDP_PAYMASTER_URL` | worker | gasless (verify V-04) |
| `SERV_API_KEY` | worker, web(compile only) | SERV Reasoning |
| `SERV_BASE_URL` | worker | default `https://inference-api.openserv.ai/v1` |
| `SERV_MODEL_PROPOSER` / `SERV_MODEL_VERIFIER` | worker | default `gpt-5.4-mini` (verify V-02) |
| `RECEIPT_HMAC_SECRET` | worker, web | 32+ random bytes |
| `SESSION_SECRET` | web | iron-session |
| `USDC_ADDRESS` | all | from VERIFY V-06 |
| `SPEND_PERMISSION_MANAGER_ADDRESS` | all | from VERIFY V-05 |
| `MOCK_VAULT_ADDRESS` | all | deployed in Phase 2 |
| `DEMO_MODE` | all | `true` only on testnet |
| `STEWARD_ALLOW_MAINNET` | all | must be unset until Phase 9 gate |
| `TELEGRAM_BOT_TOKEN` | worker | optional |

Env is parsed once with zod in `packages/shared/src/env.ts`; startup fails on missing/invalid vars.

## 7. Deployment

- Local: `docker compose up -d` (Postgres) → `pnpm db:migrate` → `pnpm dev`.
- Hackathon: web on Vercel, worker on Railway/Fly (single instance), Neon Postgres.
- Worker is single-instance in MVP; advisory locks make it safe to scale later.
