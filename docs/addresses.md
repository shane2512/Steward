# Verified addresses (Base Sepolia, chainId 84532)

| Name | Address | Verified how | Source |
|---|---|---|---|
| USDC (Circle test, 6 dec) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | on-chain: code present, symbol USDC, decimals 6 (2026-09-20) | https://x.com/circle/status/1810639685322223898 , faucet https://faucet.circle.com |
| SpendPermissionManager | `0xf85210B21cC50302F477BA56686d2019dC9b67Ad` | on-chain code present; equals `SPEND_PERMISSION_MANAGER_ADDRESS` in @coinbase/cdp-sdk 1.56.0 | https://github.com/coinbase/spend-permissions |
| PublicERC6492Validator | `0xcfCE48B757601F3f351CB6f434CB0517aEEE293D` | on-chain code present | https://github.com/coinbase/spend-permissions |
| Spike agent smart wallet (throwaway) | `0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14` | created via CDP, name `steward-spike` | spikes/agentkit-smoke.ts |
| Spike agent owner (CDP server acct, throwaway) | `0xba916bc0884EdfE90b64BCD0AB1F3905c153e9ae` | CDP `steward-spike-owner` | spikes/agentkit-smoke.ts |

MockVault / MockPriceFeed: not deployed yet (Phase 2).
