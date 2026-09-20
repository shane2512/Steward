# PRD — Steward

Status: v1.0 (hackathon prototype → production path) · Owner: founder · Track: SERV Hackathon / AgentKit

## 1. Summary

Steward is an autonomous treasury operator for stablecoin treasuries. It keeps idle capital
productive, pays recurring obligations, and reacts to risk — under a plain-English mandate that a
deterministic policy layer and on-chain spend permissions make **impossible to exceed**, even if the
reasoning model is wrong or attacked.

**Thesis:** *Reasoning proposes, code disposes.*

## 2. Problem

1. **Idle capital.** Onchain treasuries hold large stablecoin balances that earn nothing because
   allocating, rebalancing and monitoring are manual and time-consuming.
2. **Manual operations.** Payroll, vendor payouts and top-ups are done by hand, one signature at a time.
3. **Agents with wallets are unsafe today.** Coinbase AgentKit explicitly does not enforce spend
   caps, human approval, or destination allowlists — that is left to the developer. Real incidents
   (e.g. prompt-injection drains of agent-linked wallets in 2026) show "excessive agency" is the
   failure mode (OWASP LLM01 prompt injection, LLM06 excessive agency).
4. **No accountability.** Nobody can answer "why did the bot move $80k?" in an auditable way.

## 3. Target users & personas

| Persona | Description | Job-to-be-done |
|---|---|---|
| **Maya — solo founder** (primary for MVP) | Runs a small crypto-native company; $50k–$2M USDC on Base | "Keep runway safe, earn on the rest, pay my contractors on the 1st, don't make me babysit it." |
| **DAO ops lead** | Manages a multisig treasury | "Diversify and deploy reserves under governance-approved rules with an audit trail." |
| **Agent builder** (Phase-4 platform) | Ships agents that need wallets | "Give my agent a wallet that can't be talked into draining itself." |

## 4. Goals / Non-goals

**Goals (MVP)**
- G1: Owner can go from zero to an operating, policy-bounded treasury agent in < 5 minutes.
- G2: Agent autonomously deploys idle USDC above a runway buffer into an allowlisted ERC-4626 vault.
- G3: Agent pays allowlisted recipients on a schedule.
- G4: Agent exits a vault position when a risk signal fires (vault share-price drawdown or asset depeg).
- G5: Any action above threshold or outside autonomy scope is escalated for signed owner approval.
- G6: A live prompt-injection attack is visibly blocked with an audit entry.
- G7: Owner can freeze + revoke + sweep home in one action, independent of the AI.
- G8: Every decision is explained and auditable.

**Non-goals (MVP)**
- Trading volatile assets, leverage, LPing, perps.
- Multi-chain (Base Sepolia only; Base mainnet behind gate).
- Custodying user funds in any pooled way. No fiat on/off-ramp.
- Consumer savings product (Phase-3 roadmap).
- Charging fees on testnet.

## 5. Scope — Functional requirements

Numbered so tests and phases can reference them.

### Onboarding & wallets
- **FR-1** Owner signs in with wallet (SIWE) using Coinbase Smart Wallet (passkey). No seed phrase shown.
- **FR-2** On first sign-in, Steward provisions a per-owner **Agent Operating Wallet** (AgentKit `CdpSmartWalletProvider`).
- **FR-3** Owner grants a **Spend Permission** from their treasury smart wallet to the agent wallet (token=USDC, allowance per period, period, start/end). Shown in plain language before signing.
- **FR-4** Dashboard shows treasury balance, agent-wallet balance, vault positions, allowance remaining.

### Mandate & policy
- **FR-5** Owner writes a Mandate in English or picks a template (Startup Operating, DAO Reserve, Creator).
- **FR-6** SERV compiles the Mandate into a draft `Policy` JSON; deterministic validator enforces system ceilings.
- **FR-7** Owner reviews the compiled Policy in plain language (each rule rendered as a sentence) and confirms by signing. Policy is versioned; only one active version.
- **FR-8** Recipients (payees) are added only by the owner via UI with signed confirmation; the agent can never add recipients.

### Autonomous operation
- **FR-9** Worker runs the decision loop on triggers: schedule (every 5 min in demo, configurable), balance change, obligation due, price/risk event.
- **FR-10** Proposer (SERV) outputs a schema-valid `Proposal` or `NOOP`.
- **FR-11** Shadow Verifier (independent SERV call) returns `AGREE | DISAGREE | UNSURE` with reasons.
- **FR-12** Policy Engine returns `ALLOW | ESCALATE | DENY` with rule codes.
- **FR-13** Risk gate simulates the exact calls and checks balance deltas + oracle freshness.
- **FR-14** Executor performs ALLOWed actions via AgentKit and records tx hash, status, gas.
- **FR-15** Supported action kinds: `pull_allowance`, `vault_deposit`, `vault_withdraw`, `pay_recipient`, `sweep_home`, `risk_exit`, `noop`, `escalate`.

### Approvals, safety, owner control
- **FR-16** Escalations create an Approval card with: action, simulation deltas, rationale, rule codes, expiry (default 24h). Owner approves by signing an EIP-191 message bound to the proposal hash.
- **FR-17** Emergency **Freeze**: stops the agent immediately (DB flag checked by executor), then offers on-chain revoke of the spend permission and sweep of the agent wallet back to treasury.
- **FR-18** Circuit breaker auto-freezes after K consecutive failures or rate-limit breach.
- **FR-19** Owner can withdraw/sweep at any time; never blocked by agent state.

### Transparency
- **FR-20** Decision timeline: each loop iteration shows context summary, proposal, verification, verdict, execution.
- **FR-21** Audit log export (CSV + JSON).
- **FR-22** Notifications: in-app (MVP), Telegram (should-have).

### Payments to services (stretch)
- **FR-23** (Stretch, Phase 8) Agent can pay x402-protected HTTP endpoints within a daily micro-budget and host allowlist.

## 6. Non-functional requirements

- **NFR-1 Security**: all invariants in `CLAUDE.md` §3; Policy Engine 100% branch coverage.
- **NFR-2 Latency**: loop iteration (excluding chain confirmation) p95 < 20 s; policy eval < 50 ms.
- **NFR-3 Reliability**: worker crash-safe; resumes pending executions idempotently.
- **NFR-4 Auditability**: every decision reproducible from stored context snapshot + policy version.
- **NFR-5 Privacy**: no secrets/PII in prompts; SERV receives only treasury facts required.
- **NFR-6 Cost**: ≤ 3 SERV calls per loop iteration that produces an action; 1 when NOOP-able by deterministic pre-check.
- **NFR-7 Accessibility**: WCAG AA contrast, keyboard navigable approval flow.

## 7. Success metrics

Hackathon: live demo completes all 6 beats in `DEMO.md` without manual intervention.
Product: % of treasury delegated (key adoption metric), escalations-approved ratio, blocked-attack
count, realized yield vs idle baseline, time-to-first-autonomous-action, zero policy violations.

## 8. Monetization (not built in MVP, designed for)

- SaaS tiers by treasury size (Starter / Growth / DAO).
- Small bps fee on actively managed balance (only after legal review).
- Premium security (risk feeds, custom policy packs).
- B2B "Sentinel" API: the Policy Engine + reasoning-integrity layer for other agent builders.
Explicitly **not** relying on x402 volume.

## 9. Judging-criteria mapping

| Criterion | How Steward shows it |
|---|---|
| Creativity | "Reasoning proposes, code disposes" + live attack blocked + mandate→policy compiler |
| User-readiness | Passkey onboarding, plain-language policy, approvals, freeze, audit export |
| Revenue potential | Clear SaaS/AUM/B2B path on a large idle-capital problem |

## 10. Open questions (track in PROGRESS.md)

- OQ-1 Exact hackathon submission requirements (OpenServ platform registration?) → `VERIFY.md` V-12.
- OQ-2 Production custody: session keys on owner account (ERC-7715/7702) vs agent operating wallet.
- OQ-3 Legal review for managed-yield fee.
