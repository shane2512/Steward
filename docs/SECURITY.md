# SECURITY — Steward

**Principle:** the agent has enough authority to be useful, and never more than necessary.
**Rule:** reasoning proposes, code disposes. This document has the highest precedence of all specs.

## 1. Assets to protect

1. Owner treasury funds (USDC, other stables)
2. Agent operating wallet funds + vault shares
3. Spend Permission authority (allowance)
4. CDP / SERV / HMAC secrets
5. Integrity of policy, recipients, and audit log
6. Owner session (SIWE cookie)

## 2. Threat model

| ID | Threat | Vector | Primary control | Backup control |
|---|---|---|---|---|
| T1 | Prompt injection | Malicious text in memo fields, token names, external data, vault metadata | Untrusted-text fencing + InjectionScreen; LLM has no write tools | Policy Engine allowlists; on-chain allowance cap |
| T2 | Excessive agency | Model proposes out-of-mandate action | Policy `autonomousActions` + thresholds | Escalation; allowance cap |
| T3 | Address poisoning | Look-alike address in history/context | Exact-match recipient allowlist (R05); agent cannot add recipients | Owner signs recipient additions |
| T4 | Malicious contract | Proposal targets unknown contract | Contract allowlist (R04) | Simulation delta check (R11) |
| T5 | Unlimited approvals | Agent approves spender for max | Approvals only exact-amount, only to allowlisted vaults, revoked after use | R18 |
| T6 | Agent wallet key compromise | CDP credential leak | Exposure bound (allowance + agent balance) | Freeze → revoke spend permission on-chain |
| T7 | Owner session hijack | Stolen cookie | Sensitive ops require fresh wallet signature (policy, recipients, approvals) | Short session TTL, SameSite=strict |
| T8 | SERV wrong/hallucinated reasoning | Bad allocation / invented facts | Shadow verifier + cited fact IDs must exist | Policy Engine hard rules |
| T9 | Replay / duplicate execution | Retry after timeout | Idempotency key = proposal hash; single-use receipt nonce | Rate limiter |
| T10 | Execution loop | Bug triggers repeated actions | Rate limit (R14) + circuit breaker auto-freeze | Daily cap (R07) |
| T11 | Stale / manipulated prices | Oracle outage | Freshness check (R12), deny on stale | Stables-only scope |
| T12 | Depeg / vault exploit | Market event | `risk_exit` pre-authorized safety action | Notification + owner freeze |
| T13 | Secrets leak via logs/prompts | Logging | pino redaction; prompt builder allowlist of fields | Secret-scan in CI |
| T14 | Audit tampering | DB write | Append-only trigger; hash chain on audit rows | Periodic export |
| T15 | Demo override abuse | DEMO_MODE on mainnet | I11: demo only on 84532 | Startup assertion |
| T16 | Malicious owner instruction | Owner writes unsafe mandate | System ceilings in mandate validator | Explicit warnings in policy review |
| T17 | Permission escalation via received assets | Airdropped NFT/token "unlocks" features | No code path grants authority based on holdings | Token allowlist |

## 3. The five layers

### Layer 1 — Custody separation
- Owner treasury keys never touch Steward.
- Agent operating wallet holds only what it pulled within the allowance, plus vault shares.
- `sweep_home` destination = owner treasury, stored at onboarding, immutable except via owner-signed change.
- UI shows **Maximum at risk** = agent USDC balance + vault share value + remaining period allowance.

### Layer 2 — On-chain authority cap (Spend Permission)
- Token: USDC only (MVP). Allowance per period (default: 10,000 USDC / 1 day in demo). Start/end timestamps.
- Only the agent wallet is the spender. Revocable by the owner at any time from their wallet
  (and via Steward's Freeze flow which prompts the revoke transaction).
- Even a fully compromised backend cannot pull more than the allowance.

### Layer 3 — Deterministic Policy Engine
- Pure function; see `POLICY_ENGINE.md` for all rules.
- Hard ceilings the mandate can never exceed (system constants): see `POLICY_ENGINE.md` §5.
- Only source of `AllowReceipt`. Executor refuses without a valid receipt.

### Layer 4 — Risk gate
- Simulate exact calls from the agent wallet via `eth_call`; compare token balance deltas to the
  proposal's declared expected deltas (tolerance 0.5% for vault share math, exact for transfers).
- Price freshness ≤ 60 s; stables must be within `depegThresholdBps` of $1 for inflows.
- Contract code must exist at target; target in allowlist.

### Layer 5 — Reasoning integrity
- **Fencing:** all untrusted text (memos, token names/symbols, external API text, vault names)
  is placed inside `<untrusted_data id="...">` blocks with an explicit instruction that it is data.
  Fenced text is truncated (≤ 500 chars each) and stripped of control/zero-width characters.
- **InjectionScreen:** deterministic heuristics (imperatives like "ignore previous", "send all",
  hex addresses not in allowlist, base64/morse/leet patterns) + SERV classifier call. A flag does
  not block NOOP/safety actions but forces ESCALATE/DENY for any value-moving proposal (R16).
- **Grounding:** proposals cite `factIds`; every cited ID must exist in the context snapshot,
  every numeric param must be ≤ the fact it depends on (checked deterministically).
- **Shadow verifier:** independent prompt, sees proposal + context, not proposer's chain of thought.
  `DISAGREE` ⇒ DENY; `UNSURE` ⇒ ESCALATE (R15).
- **Schema forcing:** zod-validated output; one repair retry; then NOOP.
- Use SERV-native PromptGuard / Shadow Agents **in addition** if verified available (V-09). Never instead.

## 4. Owner control path (I7)

`POST /api/freeze` (session + fresh signature):
1. Set `wallets.frozen = true` (executor checks before every send, and receipt verify checks too).
2. Cancel all pending approvals and queued jobs for the wallet.
3. Return an unsigned `revoke` transaction for the owner's wallet to sign (Spend Permission revoke).
4. Offer `sweep_home`: executor sends all agent USDC + redeems vault shares → owner treasury.
   Sweep is allowed while frozen; it is the **only** action allowed while frozen, and only via owner request.
This path imports no reasoning code (enforced by `check:arch`).

Unfreeze requires owner signature and resets the circuit breaker.

## 5. Approvals

- Approval message (EIP-191) — exact format:
  `Steward approval\nWallet: {walletId}\nProposal: {proposalHash}\nPolicy: v{version}\nExpires: {iso}`
- Server verifies signer == owner address (smart wallet signatures via viem `verifyMessage`,
  which supports ERC-1271/6492 — verify V-10).
- Approved proposals still pass all hard rules (allowlists, ceilings, simulation). Approval only
  lifts `ESCALATE` rules (R10, R02-escalatable kinds, R15 UNSURE), never `DENY` rules.

## 6. Secrets & logging

- Env parsed with zod; secrets typed as `Secret<string>` wrapper whose `toString()` returns `[REDACTED]`.
- pino redact paths: `*.apiKey`, `*.secret`, `*.signature`, `*.privateKey`, `authorization`, `cookie`.
- Prompts built from an explicit field allowlist; unit test asserts no env value substring appears in any prompt.
- CI: gitleaks (or equivalent) on every commit.

## 7. Audit log integrity

- `audit_log` rows: `prev_hash`, `row_hash = sha256(prev_hash || canonical_json(payload))`.
- Postgres trigger raises on UPDATE/DELETE.
- `/api/audit/verify` recomputes the chain.

## 8. Failure & attack response matrix

| Scenario | System response |
|---|---|
| Agent makes wrong decision | Verifier/Policy catch → DENY/ESCALATE; if executed within limits, loss bounded by caps; owner notified; decision reviewable |
| Malicious owner instruction | Mandate validator clamps to ceilings; warns on risky settings; logs |
| Owner wallet compromised | Out of Steward scope; Steward cannot move owner funds; attacker could revoke/grant — recipient changes require signature and trigger 24h cooldown (should-have) |
| Agent key compromised | Max loss = exposure bound; freeze + revoke; rotate CDP keys |
| Malicious contract | R04 DENY + simulation mismatch |
| Phishing site | Steward UI only signs typed, human-readable messages; approval message format is fixed |
| Address poisoning | R05 exact match; agent cannot add recipients |
| Token approval exploit | Exact-amount approvals only, revoke after deposit (R18) |
| Insufficient balance | Proposer sees balances; R08/R06; simulation fails → DENY, no retry loop |
| Gas spike / congestion | Paymaster-sponsored; if sponsorship fails → backoff (1,2,4,8 min), max 4, then mark FAILED + notify |
| Failed transaction | Confirmer records FAILED; breaker counter +1; ledger not updated |
| Duplicate transaction | Unique `(wallet_id, proposal_hash)`; nonce unique; executor idempotent |
| Execution loop | R14 rate limit; breaker opens after 3 consecutive failures or 10 actions/hour → auto-freeze + notify |
| SERV incorrect reasoning | Grounding + verifier + policy; SERV timeouts → NOOP |
| AgentKit failure | Execution FAILED, no retry for non-idempotent errors without re-simulation |
| API outage (SERV/RPC) | NOOP; safety actions (risk_exit) use deterministic pre-check path not requiring SERV |
| DB outage | Worker halts (cannot audit ⇒ cannot act). Never act without audit write. |
| Immediate revoke | Freeze flow §4 |
| Recover funds | Sweep home; on-chain revoke; owner can also revoke directly in their Coinbase wallet |

## 9. Known limitations (be honest in demo & docs)

- MVP agent wallet is a CDP server-controlled smart account → Steward operator could theoretically
  move funds within the exposure bound. Mitigation: bound + revoke + production move to session keys.
- Vault risk (smart-contract risk of the vault itself) is not eliminated; allowlist only vetted vaults.
- LLM classifiers are probabilistic; they are never the last line of defense.
