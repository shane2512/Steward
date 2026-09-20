# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: 1 — in progress (Phase 0 closed 2026-09-20)
Required model: Sonnet (task 1.9 Opus)
Last updated: 2026-09-20

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| 0 | Verification spike & repo bootstrap | Sonnet | ✅ | 2026-09-20 | V-10 partial (no real Smart Wallet), V-13 false->MockPriceFeed, V-09 fallback; human approved carrying V-10 to Phase 1.8/7.6 | | |
| 1 | Monorepo foundation, DB, auth | Sonnet (+Opus 1.9) | ◐ | | |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | Opus | ☐ | | |
| 3 | Policy Engine & mandate validator | Opus | ☐ | | |
| 4 | SERV reasoning & injection defenses | Opus | ☐ | | |
| 5 | Risk gate, executor, confirmer | Opus | ☐ | | |
| 6 | Decision loop, scheduler, obligations, risk exits | Opus | ☐ | | |
| 7 | Web app UX | Sonnet (+Opus sub-tasks) | ☐ | | |
| 8 | Owner controls, notifications, hardening, security review | Opus (+Sonnet sub-tasks) | ☐ | | |
| 9 | Demo, deployment, docs, submission | Sonnet (+Opus gate) | ☐ | | |

## Current phase plan (Phase 1)
- [x] 1.1 workspace+turbo+tsconfig/eslint/prettier/vitest
- [x] 1.2 root scripts
- [x] 1.3 dependency-cruiser + violation fixture
- [x] 1.4 packages/shared
- [x] 1.5 docker-compose + packages/db (all tables)
- [x] 1.6 constraints/indexes
- [x] 1.7 apps/web + apps/worker skeleton
- [x] 1.8 SIWE auth
- [ ] 1.9 (Opus) audit log hash chain
- [x] 1.10 CI

## Verification log (Phase 0)
| ID | Result | Evidence (link/file) | Date |
|---|---|---|---|
| V-01 | VERIFIED | `spikes/serv-smoke.ts`: chat.completions works at https://inference-api.openserv.ai/v1 with Bearer key. Quirks: `/models` is NOT OpenAI-shaped (`{items:[{modelId,...}]}` so `openai.models.list()` returns []); requests need a system/developer message. Docs: https://docs.openserv.ai/serv-reasoning/api/chat-completions | 2026-09-20 |
| V-02 | VERIFIED | `gpt-5.4-mini` works. Catalog also has serv-mini/nano/standard/swift/pro/ultra, gpt-5.4/5.5, claude-*, gemini-* (raw `GET /v1/models`) | 2026-09-20 |
| V-08 | VERIFIED | `response_format: json_schema` (strict) honored; returned `{"kind":"NOOP","reason":"smoke"}`. SERV request id `chatcmpl-EQEWzVgkVIRZVZjdbwp9ADCg1pbbe` (no x-request-id header; use body `id`) | 2026-09-20 |
| V-03 | VERIFIED | @coinbase/agentkit 0.10.4 `CdpSmartWalletProvider.configureWithWallet({apiKeyId,apiKeySecret,walletSecret,networkId,owner,smartAccountName,address,paymasterUrl,rpcUrl})`. Reload = pass `owner` + `smartAccountName` (or `address`). It cannot create a NAMED wallet: create via `cdp.evm.getOrCreateAccount({name})` + `getOrCreateSmartAccount({name,owner})` then pass `owner`. Spike wallet `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14` | 2026-09-20 |
| V-04 | VERIFIED | Gasless on base-sepolia with 0 ETH and no paymasterUrl set: 0-value self-transfer userOp `0xcf17df480a9d61122a19c476520e44d18e9d1452a8f60345ee7023598b162dd4` -> tx `0x7e84b2c28692f2c4b98062899137ab263e9863be8af9c5694e1d0649d94d0a4a`, status complete | 2026-09-20 |
| V-07 | VERIFIED (with caveat) | 14 real action names in `docs/agentkit-actions.json`. `MorphoActionProvider_deposit/withdraw` accept any `vaultAddress`, but take decimal-string whole units (float-ish, I12) and are Morpho-specific. See Decision D-2 | 2026-09-20 |
| V-05 | VERIFIED (via CDP-owned treasury, fallback B; passkey/Smart-Wallet signing path still untested) | `spikes/spend-permission-cdp.ts` on 84532: treasury smart acct `0x96E06701D4b606D27efE683fE5F46731E45008a4` (must be created with `enableSpendPermissions:true`, else API error "Smart account must have two owners") -> agent `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14`. createSpendPermission tx `0x4fc2d8f67aa47244cf85bd802dec929aadc0daeb73ff8684a7f082ff47871a84`; agent spend 1 USDC tx `0xe6d744046b6c3efc3e11b6e7ef0fb056adbd31e5ec7ff0f4a34c926f20e33bd0`; owner revoke tx `0x57caacd5d5f71499a8e3239f2af8745d23a0d0bff526f5542d197f073d13bc92`; then `isRevoked=true`, `isValid=false`, post-revoke spend reverted. Manager `0xf85210B21cC50302F477BA56686d2019dC9b67Ad`; ABI has approveWithSignature/spend/revoke/revokeAsSpender/getCurrentPeriod/isRevoked/isApproved/isValid; EIP-712 domain "Spend Permission Manager" v1. Faucet gives only 1 USDC per request to CDP accounts | 2026-09-20 |
| V-06 | VERIFIED | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on 84532: symbol USDC, 6 decimals; owner wallet holds 20 USDC from faucet | 2026-09-20 |
| V-13 | FALSE -> fallback | AgentKit Pyth action: `fetch_price_feed` HTTP 400, `fetch_price` 401 (Hermes `updates/price/latest` returns "unauthorized" without key). Fallback: MockPriceFeed in DEMO_MODE (chain 84532 only, I11); revisit Pyth with a keyed endpoint for mainnet | 2026-09-20 |
| V-14 | VERIFIED (docs) | wagmi `coinbaseWallet({ appName, preference: 'smartWalletOnly' })` https://wagmi.sh/core/api/connectors/coinbaseWallet ; `@coinbase/wallet-sdk` `createCoinbaseWalletSDK({preference:{options:'smartWalletOnly'}})` used in spike | 2026-09-20 |
| V-11 | VERIFIED (provider exists) | `x402ActionProvider` in AgentKit 0.10.4; supports base-sepolia; actions discover_x402_services, make_http_request, retry | 2026-09-20 |
| V-10 | PARTIAL | viem `verifyMessage` returned true for an EOA (Coinbase Wallet phone app, 65-byte sig). NOT yet tested with a real Coinbase Smart Wallet (ERC-1271/6492): human could not create a passkey wallet at keys.coinbase.com (only old wallet offered). Carry into Phase 1.8/7.6 with a real Smart Wallet | 2026-09-20 |
| V-09 | NOT CONFIRMED -> fallback | PromptGuard / Shadow Agents / decision trails appear in OpenServ marketing/console (https://console.openserv.ai/, https://docs.openserv.ai/what-is-serv) but no API parameter or response field is documented in the chat-completions reference. Fallback: own screen + verifier (already designed); Phase 4.11 skipped | 2026-09-20 |
| V-12 | VERIFIED | https://www.openserv.ai/hackathon : AgentKit track; hackathon Sep 14-28 2026; submissions close **Sep 28 00:00 UTC**; submission = public X post tagging @openservai (name, concept, images, GitHub/demo links) + submission form; project must be new, functional, demonstrable; judged on creativity, user-readiness, revenue potential; human must enable data collection at console.openserv.ai/settings/organization (prompts shared with OpenServ -> keep secrets/PII out, NFR-5). No explicit OpenServ agent registration requirement found | 2026-09-20 |

## Decisions (ADR-lite)
| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| D-1 | 2026-09-20 | AgentKit fires an un-awaited telemetry POST (wallet address, network) to cca-lite.coinbase.com at wallet-provider init; a non-2xx becomes an unhandledRejection that crashes Node 22. Worker installs a process-level `unhandledRejection` logger; no opt-out flag exists in 0.10.4. Only public data is sent. | Crash found in spike | Patch package (rejected) |
| D-2 | 2026-09-20 | PROPOSED (human OK needed, Phase 2): vault deposit/withdraw built as exact-bigint encoded ERC-4626 calls via `walletProvider.sendTransaction` in `actionRegistry.ts`, not AgentKit Morpho actions | Morpho actions take decimal strings and are Morpho-specific; MockVault is plain ERC-4626; I12 | Morpho action for real Morpho vaults later |
| D-3 | 2026-09-20 | PROPOSED: `provisionAgentWallet` uses CDP client getOrCreate (named owner + named smart account keyed by userId), then passes `owner` into `CdpSmartWalletProvider` | Provider cannot create named wallets; idempotency | none |
| D-4 | 2026-09-20 | PROPOSED spec fix: SERV `models.list()` unusable; validate model via raw `GET /v1/models` (`items[].modelId`); system message required | V-01 finding | none |
| D-5 | 2026-09-20 | PROPOSED (needs human OK): a wallet that signs via plain ECDSA (EOA / Coinbase Wallet app) cannot grant spend permissions. Onboarding must require a Coinbase Smart Wallet (`smartWalletOnly`) and reject EOAs (detect via signature/1271 path or `getCode`+connector) | Found during V-05 live test | none |
| D-6 | 2026-09-20 | pnpm 11.25 used instead of pnpm 9 (`packageManager: pnpm@11.25.0`). pnpm 11 blocks dependency build scripts: approved only `esbuild` and `sharp` via `allowBuilds` in pnpm-workspace.yaml (pnpm 11 key; `onlyBuiltDependencies` is the pnpm 9/10 name) | Installed locally; spec version is stale | Install pnpm 9 |
| D-7 | 2026-09-20 | Deps added (Phase 1): turbo (task runner), typescript, vitest + fast-check (tests/property tests), eslint + typescript-eslint + @eslint/js (lint), prettier, dependency-cruiser (I1/I2/I3 boundaries), zod (boundaries), pino (redacting logs), viem (checksums, SIWE, chain client), @noble/hashes (sha256 canonical hash; policy-pure), drizzle-orm + drizzle-kit + pg (schema/migrations; pg over postgres.js for pg-boss/drizzle parity), pg-boss (queue, no extra infra), next + react + react-dom + tailwindcss + @tailwindcss/postcss + postcss (web skeleton), iron-session (session cookie), clsx + tailwind-merge (shadcn `cn` helper), tsx (run TS in worker/migrate), @types/* | Each per ARCHITECTURE §3 / PHASES 1.x | - |
| D-8 | 2026-09-20 | SIWE uses viem/siwe (parse/validate/nonce) + injected `publicClient.verifyMessage` verifier; the `siwe` npm package (ethers peer) is NOT added. Nonce lives in the iron-session cookie (5 min TTL, cleared on success), so no nonce table. Domain is taken from the request host, chainId must equal CHAIN_ID. Only EOA-tested (V-10 partial); D-5 EOA rejection NOT implemented (TODO in apps/web/lib/siwe.ts) | Fewer deps, no schema drift from DATA_MODEL | `siwe` package; DB nonce table |
| D-9 | 2026-09-20 | audit_log columns follow DATA_MODEL exactly (`id` bigserial, `prev_hash`, `row_hash`, `created_at`, ...); no separate `seq`/`hash` columns: `id` is the chain order. Trigger and writer are task 1.9 | Spec is source of truth | Add seq column |
| D-10 | 2026-09-20 | Local Postgres host port is 5433 (5432 taken by a local Postgres). DB tests use database `steward_test` on the same server, dropped/recreated per test file; they FAIL (never skip) if Postgres is unreachable | Port conflict; no silent passes | - |
| D-11 | 2026-09-20 | UUID PKs use gen_random_uuid() (v4); Postgres 16 has no native v7. Order by created_at | No extension needed | uuid-ossp / app-side v7 |
| D-12 | 2026-09-20 | env parsing: empty string treated as unset; SESSION_SECRET >= 32 chars; CHAIN_ID 8453 needs STEWARD_ALLOW_MAINNET (I8); DEMO_MODE only on 84532 (I11). Lookup that changed code: zod 4 `.default()` on a transformed enum takes the OUTPUT type (`.default(false)`) | I8/I11 fail-closed | - |
| D-13 | 2026-09-20 | Stray CLAUDE.md that appeared at repo root is git-ignored (`/CLAUDE.md`); docs/CLAUDE.md is canonical | Avoid duplicate manual | - |

## Known issues / risks
- Phase 1 open: 1.9 (audit trigger, audit.ts writer, verifyChain, tamper/concurrency tests) assigned to Opus; Phase 1 NOT complete until done.
- SIWE only tested with EOAs; ERC-1271/6492 path via publicClient.verifyMessage untested with a real Smart Wallet (V-10 partial, D-5 open).
- `pnpm dev` runs `docker compose up -d --wait` then migrates; needs Docker Desktop running. First `docker pull postgres:16` was flaky (EOF), retried OK.
- CI workflow (.github/workflows/ci.yml) written but not run remotely.
- shadcn/ui: minimal init only (components.json, lib/utils.ts, empty components/ui); no components generated yet.
- Local pnpm is 11.25 (spec says 9); Node 22.13.1, Docker 29.6.2, Foundry 1.5.1 present.
- Repo root contains duplicate copies of the spec .md files, `steward-claude-code-specs/` and the .zip; `docs/` is canonical. Zip and unpacked folder are git-ignored; root duplicates left untouched pending human OK to delete.
- No `.env.local` present yet; credentials needed for spikes.

## Next step
- Phase 1. Hackathon deadline Sep 28 00:00 UTC (8 days): keep MUST scope tight.
