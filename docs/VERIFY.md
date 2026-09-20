# VERIFY — external facts to confirm in Phase 0

Research was done in Sept 2026 but these APIs move fast. For each item: check official docs / installed
package types, record result + date + source link in `docs/PROGRESS.md` → Verification log.
**Do not rely on any item until it is marked VERIFIED.**

| ID | Claim to verify | How | Fallback if false |
|---|---|---|---|
| V-01 | SERV Reasoning is OpenAI-compatible at `https://inference-api.openserv.ai/v1` | OpenServ docs; smoke call with `openai` SDK | Use documented OpenServ SDK/endpoint; wrap behind `ServClient` interface |
| V-02 | Model id `gpt-5.4-mini` (or current recommended) is available | `models.list()` or docs | Use recommended default; set in env |
| V-03 | `@coinbase/agentkit` exports `CdpSmartWalletProvider`; exact config field names; how to reload an existing wallet | Package types + CDP docs | Use `CdpEvmWalletProvider` + separate smart account, document change |
| V-04 | Gasless on Base Sepolia via CDP paymaster for smart wallet | Docs + tx test | Fund agent wallet with Sepolia ETH from faucet; show gas in UI |
| V-05 | Spend Permissions: manager contract address on Base Sepolia; SDK helper for owner signature; `approveWithSignature`/`spend`/`revoke`/`getCurrentPeriod`/`isRevoked` ABI | Base/CDP Spend Permissions docs + GitHub `coinbase/spend-permissions` | If unavailable: owner transfers a capped float to agent wallet manually (degrades Layer 2; flag prominently) |
| V-06 | Testnet USDC address on Base Sepolia + faucet limits | Circle/CDP docs | Deploy MockUSDC (6 decimals) under DEMO_MODE |
| V-07 | AgentKit morpho (or other) action accepts arbitrary ERC-4626 vault address | Read provider source | Encoded ERC-4626 calls via `walletProvider.sendTransaction` |
| V-08 | SERV supports `response_format: json_schema` | Smoke test | Prompted JSON + zod + repair retry |
| V-09 | SERV PromptGuard / Shadow Agents / decision trails are exposed via API | Docs | Rely on own screen + verifier only (already designed) |
| V-10 | viem `verifyMessage` validates Coinbase Smart Wallet signatures (ERC-1271/6492) on Base Sepolia | Test with real wallet | Use `publicClient.verifyMessage` with universal validator; else OnchainKit util |
| V-11 | x402 client/action provider in AgentKit for stretch FR-23 | Docs | Drop FR-23 |
| V-12 | Hackathon submission rules: SERV usage proof, OpenServ platform registration, deadlines, repo/video requirements | Official hackathon page | Ask human |
| V-13 | Pyth availability on Base Sepolia via AgentKit `pythActionProvider` | Docs/test | MockPriceFeed under DEMO_MODE; Pyth on mainnet only |
| V-14 | OnchainKit / wagmi Coinbase Smart Wallet connector current package names | Docs | Use wagmi `coinbaseWallet({ preference: 'smartWalletOnly' })` |
