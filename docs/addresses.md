# Verified addresses (Base Sepolia, chainId 84532)

| Name | Address | Verified how | Source |
|---|---|---|---|
| USDC (Circle test, 6 dec) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | on-chain: code present, symbol USDC, decimals 6 (2026-09-20) | https://x.com/circle/status/1810639685322223898 , faucet https://faucet.circle.com |
| SpendPermissionManager | `0xf85210B21cC50302F477BA56686d2019dC9b67Ad` | on-chain code present; equals `SPEND_PERMISSION_MANAGER_ADDRESS` in @coinbase/cdp-sdk 1.56.0; cross-checked against the vendored ABI by `packages/wallet/test/abi.test.ts` | https://github.com/coinbase/spend-permissions |
| PublicERC6492Validator | `0xcfCE48B757601F3f351CB6f434CB0517aEEE293D` | on-chain code present | https://github.com/coinbase/spend-permissions |
| Deterministic deployment proxy (CREATE2) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | on-chain: the canonical 69-byte Arachnid proxy; used by `scripts/live/deploy-contracts.ts` | https://github.com/Arachnid/deterministic-deployment-proxy |
| **MockVault** (ERC-4626 over USDC) | `0x3741f0da6dFFfFD8Be2353e326a49E41a3396485` | deployed 2026-09-21, tx `0xf140e9d80d907038118d5d4e4dd3a0538d43ef1e81b7bc5f054afaa1b8c151bb`; on-chain: 5241 bytes of code, `owner()` == demo admin, `asset()` == USDC, `decimals()` == 6 | `contracts/src/MockVault.sol`, `scripts/live/deploy-contracts.ts` |
| **MockPriceFeed** | `0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69` | deployed 2026-09-21, tx `0x2eddcedbf196f5289dbe1266bf67d8d75e0c8f52f057946a0567d8d028754ff5`; on-chain: 1112 bytes of code, `owner()` == demo admin, price == $1.000000 | `contracts/src/MockPriceFeed.sol` |
| **Demo admin** (owns both mocks) | `0xC388F1602dF570289825ac907a1C3D80A2916924` | CDP server account `steward-demo-admin` — no private key on disk; demo scripts call `simulateYield`/`simulateLoss`/`setPrice` through CDP | `scripts/live/lib.ts` |
| Live-test agent wallet (Phase 2 e2e) | `0xE967db385aF313Cc6CA006a745fc929A201F58A2` | CDP smart account, names `sto-…`/`sta-…` derived from a fixed test userId (D-3) | `scripts/live/spend-permission-e2e.ts` |
| Spike agent smart wallet (throwaway) | `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14` | created via CDP, name `steward-spike` | spikes/agentkit-smoke.ts |
| Spike agent owner (CDP server acct, throwaway) | `0xba916bc0884EdfE90b64BCD0AB1F3905c153e9ae` | CDP `steward-spike-owner` | spikes/agentkit-smoke.ts |

Both mocks are deployed via CREATE2 with salt `0x…01`, so redeploying the same bytecode is a no-op and
the addresses are reproducible. Basescan source verification was not performed (optional per PHASES 2.1);
the on-chain checks above are run by the deploy script itself and printed on every run.

Put these in `.env.local`:

```
MOCK_VAULT_ADDRESS=0x3741f0da6dFFfFD8Be2353e326a49E41a3396485
MOCK_PRICE_FEED_ADDRESS=0xea0183F799ffCfE2f5bFd831EBfdc9f064fddf69
```

## DEMO-only token pair (Phase 6, deployed 2026-09-21)

Circle's testnet USDC comes from a CDP faucet that is rate-limited per project — not enough for an
unattended loop run or a rehearsed demo. DEMO.md anticipates this ("200,000 via MockUSDC if faucet
limits are too small — then USDC_ADDRESS points to MockUSDC; banner says DEMO DATA").

| Name | Address | Verified how | Source |
|---|---|---|---|
| **MockUSDC** (6 dec, owner-mintable) | `0x1ba0af42256425d1F9Eb03aA804048593E23926a` | deployed 2026-09-21, tx `0x7ac19b140293bd94dd84ae415dd26ff87ae82ee60e1349c1e1661f1740b9ffef`; on-chain: `decimals()` == 6, `symbol()` == mUSDC, `owner()` == demo admin | `contracts/src/MockUSDC.sol`, `scripts/live/deploy-demo-token.ts` |
| **MockVault over MockUSDC** | `0xc1eb5AF474e99Dd78e8137bd9164A522C60A7Be1` | deployed 2026-09-21, tx `0x8af4efc5d245d8f071a06b614f7181f32de8fa24fbfde1fef9b0998d14766023`; on-chain: `asset()` == MockUSDC, `owner()` == demo admin, `decimals()` == 6 | same |

Both deployed via CREATE2 with salt `0x…02` (the real-USDC pair above uses `0x…01`), so the two sets
coexist and redeploying is a no-op. **Use these only with `DEMO_MODE=true` on chain 84532**, where
I11 fences the demo overrides and the UI must show the DEMO DATA banner:

```
USDC_ADDRESS=0x1ba0af42256425d1F9Eb03aA804048593E23926a
MOCK_VAULT_ADDRESS=0xc1eb5AF474e99Dd78e8137bd9164A522C60A7Be1
```

Mint more at any time: `STEWARD_LIVE=1 npx tsx scripts/live/deploy-demo-token.ts <to> <wholeTokens>`.
