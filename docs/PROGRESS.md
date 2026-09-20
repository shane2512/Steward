# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: 0 — in progress (0.1 done; blocked on human-provided credentials for spikes)
Required model: Sonnet
Last updated: 2026-09-20

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| D-1 | 2026-09-20 | AgentKit fires an un-awaited telemetry POST (wallet address, network) to cca-lite.coinbase.com at wallet-provider init; a non-2xx becomes an unhandledRejection that crashes Node 22. Worker installs a process-level `unhandledRejection` logger; no opt-out flag exists in 0.10.4. Only public data is sent. | Crash found in spike | Patch package (rejected) |
| D-2 | 2026-09-20 | PROPOSED (human OK needed, Phase 2): vault deposit/withdraw built as exact-bigint encoded ERC-4626 calls via `walletProvider.sendTransaction` in `actionRegistry.ts`, not AgentKit Morpho actions | Morpho actions take decimal strings and are Morpho-specific; MockVault is plain ERC-4626; I12 | Morpho action for real Morpho vaults later |
| D-3 | 2026-09-20 | PROPOSED: `provisionAgentWallet` uses CDP client getOrCreate (named owner + named smart account keyed by userId), then passes `owner` into `CdpSmartWalletProvider` | Provider cannot create named wallets; idempotency | none |
| D-4 | 2026-09-20 | PROPOSED spec fix: SERV `models.list()` unusable; validate model via raw `GET /v1/models` (`items[].modelId`); system message required | V-01 finding | none |
| 0 | Verification spike & repo bootstrap | Sonnet | ◐ | | |
| 1 | Monorepo foundation, DB, auth | Sonnet | ☐ | | |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | Opus | ☐ | | |
| 3 | Policy Engine & mandate validator | Opus | ☐ | | |
| 4 | SERV reasoning & injection defenses | Opus | ☐ | | |
| 5 | Risk gate, executor, confirmer | Opus | ☐ | | |
| 6 | Decision loop, scheduler, obligations, risk exits | Opus | ☐ | | |
| 7 | Web app UX | Sonnet (+Opus sub-tasks) | ☐ | | |
| 8 | Owner controls, notifications, hardening, security review | Opus (+Sonnet sub-tasks) | ☐ | | |
| 9 | Demo, deployment, docs, submission | Sonnet (+Opus gate) | ☐ | | |

## Current phase plan
- [x] 0.1 git init, .gitignore, .nvmrc, README stub
- [~] 0.2 spikes (serv, agentkit, usdc done; spend-permission + verify-sig await human signature): serv-smoke, agentkit-smoke, spend-permission-smoke, usdc-and-price, verify-sig (need credentials)
- [ ] 0.2 docs research: V-09, V-11, V-12, V-14 (+ V-05 docs side)
- [ ] 0.3 record every result in Verification log
- [ ] 0.4 stop and ask human if any fallback weakens a security layer (esp. V-05)
- [ ] 0.5 docs/agentkit-actions.json, docs/addresses.md
- [ ] 0.6 propose spec diffs as Decisions

## Verification log (Phase 0)
| ID | Result | Evidence (link/file) | Date |
|---|---|---|---|
| V-01 | VERIFIED | `spikes/serv-smoke.ts`: chat.completions works at https://inference-api.openserv.ai/v1 with Bearer key. Quirks: `/models` is NOT OpenAI-shaped (`{items:[{modelId,...}]}` so `openai.models.list()` returns []); requests need a system/developer message. Docs: https://docs.openserv.ai/serv-reasoning/api/chat-completions | 2026-09-20 |
| V-02 | VERIFIED | `gpt-5.4-mini` works. Catalog also has serv-mini/nano/standard/swift/pro/ultra, gpt-5.4/5.5, claude-*, gemini-* (raw `GET /v1/models`) | 2026-09-20 |
| V-08 | VERIFIED | `response_format: json_schema` (strict) honored; returned `{"kind":"NOOP","reason":"smoke"}`. SERV request id `chatcmpl-EQEWzVgkVIRZVZjdbwp9ADCg1pbbe` (no x-request-id header; use body `id`) | 2026-09-20 |
| V-03 | VERIFIED | @coinbase/agentkit 0.10.4 `CdpSmartWalletProvider.configureWithWallet({apiKeyId,apiKeySecret,walletSecret,networkId,owner,smartAccountName,address,paymasterUrl,rpcUrl})`. Reload = pass `owner` + `smartAccountName` (or `address`). It cannot create a NAMED wallet: create via `cdp.evm.getOrCreateAccount({name})` + `getOrCreateSmartAccount({name,owner})` then pass `owner`. Spike wallet `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14` | 2026-09-20 |
| V-04 | VERIFIED | Gasless on base-sepolia with 0 ETH and no paymasterUrl set: 0-value self-transfer userOp `0xcf17df480a9d61122a19c476520e44d18e9d1452a8f60345ee7023598b162dd4` -> tx `0x7e84b2c28692f2c4b98062899137ab263e9863be8af9c5694e1d0649d94d0a4a`, status complete | 2026-09-20 |
| V-07 | VERIFIED (with caveat) | 14 real action names in `docs/agentkit-actions.json`. `MorphoActionProvider_deposit/withdraw` accept any `vaultAddress`, but take decimal-string whole units (float-ish, I12) and are Morpho-specific. See Decision D-2 | 2026-09-20 |
| V-05 | PARTIAL: static checks VERIFIED; live spend/revoke PENDING human signature | Manager `0xf85210B21cC50302F477BA56686d2019dC9b67Ad` has code on 84532 and equals SDK constant; ERC6492 validator `0xcfCE48B757601F3f351CB6f434CB0517aEEE293D` has code; ABI (cdp-sdk `SPEND_PERMISSION_MANAGER_ABI`) has approveWithSignature, spend, revoke, revokeAsSpender, getCurrentPeriod, isRevoked, isApproved, isValid; EIP-712 domain read on-chain = "Spend Permission Manager" v"1" chain 84532. cdp-sdk also has `useSpendPermission` | 2026-09-20 |
| V-06 | VERIFIED | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on 84532: symbol USDC, 6 decimals; owner wallet holds 20 USDC from faucet | 2026-09-20 |
| V-13 | FALSE -> fallback | AgentKit Pyth action: `fetch_price_feed` HTTP 400, `fetch_price` 401 (Hermes `updates/price/latest` returns "unauthorized" without key). Fallback: MockPriceFeed in DEMO_MODE (chain 84532 only, I11); revisit Pyth with a keyed endpoint for mainnet | 2026-09-20 |
| V-14 | VERIFIED (docs) | wagmi `coinbaseWallet({ appName, preference: 'smartWalletOnly' })` https://wagmi.sh/core/api/connectors/coinbaseWallet ; `@coinbase/wallet-sdk` `createCoinbaseWalletSDK({preference:{options:'smartWalletOnly'}})` used in spike | 2026-09-20 |
| V-11 | VERIFIED (provider exists) | `x402ActionProvider` in AgentKit 0.10.4; supports base-sepolia; actions discover_x402_services, make_http_request, retry | 2026-09-20 |
| V-10 | PENDING human signature | script ready (`spend-permission-smoke.ts verify-msg`) | |
| V-09 | OPEN | not yet researched | |
| V-12 | OPEN | no official rules page found via search; need URL from human | 2026-09-20 |

## Decisions (ADR-lite)
| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|

## Known issues / risks
- Local pnpm is 11.25 (spec says 9); Node 22.13.1, Docker 29.6.2, Foundry 1.5.1 present.
- Repo root contains duplicate copies of the spec .md files, `steward-claude-code-specs/` and the .zip; `docs/` is canonical. Zip and unpacked folder are git-ignored; root duplicates left untouched pending human OK to delete.
- No `.env.local` present yet; credentials needed for spikes.

## Next step
- Human provides Phase 0 prerequisites; then write and run spikes.
