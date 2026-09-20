# AGENTKIT INTEGRATION — Steward

Package: `packages/wallet`. Model: **Opus** (moves funds).

> AgentKit APIs evolve quickly. Every signature below is a **skeleton**; confirm against the
> installed version in Phase 0 (`VERIFY.md` V-03, V-04, V-07) and record the real names in
> `docs/agentkit-actions.json`.

## 1. What AgentKit does for us (and why each piece matters)

| AgentKit capability | Used for | Why necessary |
|---|---|---|
| `CdpSmartWalletProvider` | Per-owner Agent Operating Wallet (smart account on Base) | Wallet creation, key custody in CDP, gasless userOps via paymaster |
| `AgentKit.from({ walletProvider, actionProviders })` | Build the action registry | Uniform, versioned execution surface |
| `erc20ActionProvider` | `pay_recipient`, `sweep_home` (USDC transfer), balance reads | Token transfers |
| ERC-4626-compatible deposit/withdraw (e.g. `morphoActionProvider` against an ERC-4626 vault) | `vault_deposit`, `vault_withdraw`, `risk_exit` | Yield deployment. Verify it works with MockVault (V-07); fallback §5 |
| `pythActionProvider` | USDC price + publish time (mainnet/testnet where available) | Oracle for R12; fallback MockPriceFeed in DEMO_MODE |
| `walletActionProvider` | wallet details, native balance | Context + health |
| `walletProvider.sendTransaction` / `readContract` | `SpendPermissionManager.spend` (pull allowance), exact-amount approvals, share redemption | Generic calls not covered by providers |
| `x402ActionProvider` / x402 client (stretch) | pay x402 services within budget | Agent-to-service payments (FR-23) |

**Where AgentKit ends and Steward begins:** AgentKit signs and sends. Steward decides *whether*
(Policy Engine), *what exactly* (action registry resolving IDs → addresses), verifies *before*
(simulation) and *after* (confirmer, ledger). AgentKit has no built-in spend caps/allowlists/approvals;
all of that is Steward.

## 2. Bootstrap (skeleton)

```ts
// packages/wallet/src/agentkit.ts
import { AgentKit, CdpSmartWalletProvider, erc20ActionProvider, morphoActionProvider,
         pythActionProvider, walletActionProvider } from '@coinbase/agentkit';

export async function buildAgentKit(w: { cdpWalletRef?: string }) {
  const walletProvider = await CdpSmartWalletProvider.configureWithWallet({
    apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET.reveal(),
    walletSecret: env.CDP_WALLET_SECRET.reveal(),
    networkId: 'base-sepolia',
    // existing wallet reference/address for returning owners — field names per V-03
    paymasterUrl: env.CDP_PAYMASTER_URL,
  });
  const agentkit = await AgentKit.from({
    walletProvider,
    actionProviders: [erc20ActionProvider(), morphoActionProvider(), pythActionProvider(), walletActionProvider()],
  });
  return { agentkit, walletProvider, actions: indexActions(agentkit.getActions()) };
}
```
- `indexActions` builds a `Map<name, Action>`; startup asserts every name used in `actionRegistry.ts` exists.
- The `agentkit` instance is **never** passed to any LLM framework (I3). Do not install
  `@coinbase/agentkit-langchain` / `-vercel-ai-sdk` in `packages/wallet`.
- Persist the wallet reference (address + CDP identifier) in `wallets.agent_wallet_ref` on creation.

## 3. Action registry (kind → execution)

```ts
// packages/wallet/src/actionRegistry.ts   (static, reviewed code)
pull_allowance → walletProvider.sendTransaction(encode SpendPermissionManager.spend(permission, amount))
vault_deposit  → (1) erc20 approve(vault, exactAmount) (2) ERC-4626 deposit(amount, receiver=agentWallet)
                 via AgentKit morpho deposit action if compatible, else encoded call
vault_withdraw → ERC-4626 withdraw(amount, receiver=agentWallet, owner=agentWallet)
pay_recipient  → erc20 transfer(USDC, policy.recipients[id].address, amount)
sweep_home     → redeem all vault shares → erc20 transfer(all USDC, policy.treasuryAddress)
risk_exit      → vault_withdraw(max redeemable) → hold USDC in agent wallet; set vault.flagged=true; notify owner
```
Each entry exposes `buildCalls(proposal, policy, ctx): Call[]` (used by RiskGate simulation) and
`execute(...)`. **Simulation and execution must use the same `buildCalls` output** (single source).

## 4. Executor contract

```ts
execute(proposal, receipt): Promise<ExecutionResult>
 1. verifyReceipt (policy pkg) — else throw ReceiptInvalid (audit)
 2. db: insert receipt nonce (unique) + execution row status=PENDING keyed by (wallet, proposalHash)
    — if conflict: return existing execution (idempotent)
 3. re-read wallets.frozen — if frozen and kind≠sweep_home: mark CANCELLED
 4. calls = registry.buildCalls(...) ; assert hash(calls) == hash stored by RiskGate at simulation
 5. send via AgentKit/walletProvider; store userOp/tx hash immediately
 6. hand off to Confirmer (poll receipt, timeout 3 min) → CONFIRMED | FAILED | TIMEOUT
 7. on TIMEOUT: do NOT resend; confirmer keeps polling by hash; breaker counter +1 only on FAILED
```

## 5. MockVault fallback (testnet)

Base Sepolia may not have a suitable Morpho/Aave USDC vault. Phase 2 deploys `contracts/src/MockVault.sol`
(OpenZeppelin ERC4626 over testnet USDC, with an owner-settable "yield" drip for demo). If AgentKit's
morpho action does not accept an arbitrary ERC-4626 address (V-07), use encoded ERC-4626 calls through
`walletProvider.sendTransaction`. Record the choice in PROGRESS Decisions.

## 6. Spend Permission flow

1. **Owner grants** (web, owner's Coinbase Smart Wallet): build SpendPermission
   `{ account: treasury, spender: agentWallet, token: USDC, allowance, period, start, end, salt, extraData }`
   and request the owner's signature using the SDK helper (verify V-05 for `@base-org/account` or
   OnchainKit utilities). Store `{permission, signature}` in `spend_permissions`.
2. **First use** (worker): `approveWithSignature(permission, signature)` then `spend(permission, amount)`
   on SpendPermissionManager (or the SDK's `prepareSpendCallData` equivalent).
3. **Read remaining**: `getCurrentPeriod(permission)` → `allowance − spend` → `F_ALLOWANCE_REMAINING`.
4. **Revoke**: owner calls `revoke(permission)` from their wallet (Freeze flow returns the tx to sign).
   Worker also checks `isRevoked` each iteration → sets `spend_permissions.status='revoked'`.

## 7. Example end-to-end flow (idle cash)

```
owner treasury 182,000 USDC ──(spend permission 10,000/day)──►
  iteration 1: proposal pull_allowance 10,000 → ALLOW → spend() → agent wallet 10,000
  iteration 2: proposal vault_deposit v1 10,000 → ALLOW → approve(10,000) + deposit → shares
  audit: 2 CONTEXT, 2 PROPOSAL, 2 VERIFICATION, 2 VERDICT, 4 EXECUTION rows
```

## 8. x402 (stretch, Phase 8)

Only if V-11 verified. Paid HTTP calls go through `packages/wallet/src/x402.ts` which checks
`policy.x402.allowedHosts` + daily budget via a Policy Engine rule set (`X01–X03`) before paying.
