# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: **Phase 2 in progress (Opus)**; Phase 1 complete 2026-09-20
Required model: Phase 2 = Opus
Last updated: 2026-09-20

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| 0 | Verification spike & repo bootstrap | Sonnet | ✅ | 2026-09-20 | V-10 partial (no real Smart Wallet), V-13 false->MockPriceFeed, V-09 fallback; human approved carrying V-10 to Phase 1.8/7.6 | | |
| 1 | Monorepo foundation, DB, auth | Sonnet (+Opus 1.9) | ✅ | 2026-09-20 | Gate green: typecheck 9/9, lint clean, check:arch 53 modules/63 deps 0 violations, test 7 files/43 tests |
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

## Known issues / risks
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
- **Phase 1 is complete; waiting for the human to say "continue". Phase 2 (wallet layer) requires Opus (`/model opus`).**
- Phase 2 must also resolve the PROPOSED decisions D-2, D-3 and D-5 with the human.
- Audit writer API for later phases: `appendAudit(db, { walletId?, actor, event, entityType?, entityId?, payload, createdAt? }) => Promise<Result<AuditRow, AuditError>>` and `verifyChain(db, walletId | null) => Promise<Result<{rows, head}, {rowId, reason, expected, actual}>>`, exported from `@steward/db`. Never insert into `audit_log` directly. Payload must contain no secret-looking keys (D-16).
- Hackathon deadline Sep 28 00:00 UTC (8 days): keep MUST scope tight.
