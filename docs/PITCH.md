# PITCH — Steward, a 3-minute deck outline

This is a **slide-by-slide outline**, not a built deck: bullets to script the human-recorded backup
video against (Phase 9.6). The live demo itself follows `docs/DEMO.md`'s beat timing exactly; this
outline is the narration around it plus the three slides `DEMO.md` doesn't cover (business model,
roadmap, close). Every claim below cites real evidence already recorded in `docs/PROGRESS.md` or
`docs/SECURITY_REVIEW.md` — nothing here is a generic pitch-deck assertion.

**Recording the actual video is a human task** (a screen capture over a live/rehearsed run of
`docs/DEMO.md`, narrated against this outline) — not attempted by this pass. What's built is the
script to record against, plus the `/demo` checklist and `scripts/demo/*` that make the run
repeatable.

---

## Slide 1 — Problem (0:00–0:20)

- Crypto-native startups, DAOs and solo founders sit on idle USDC treasuries. Two failure modes at
  once: capital earns 0% doing nothing, *and* payroll/vendor payouts are a manual spreadsheet
  operation someone has to remember to run.
- The tempting fix — "give an agent the wallet" — creates a new, worse failure mode: an LLM that can
  sign transactions can be prompt-injected into signing the wrong one. AgentKit gives agents hands;
  nothing stops them being someone else's hands.
- **Visual**: the DEMO.md beat 0:00 screen — a plain wallet, 200k USDC earning 0%, a spreadsheet of
  payouts.

## Slide 2 — Demo (0:20–2:45)

Run live, exactly as scripted in `docs/DEMO.md`. Six beats, six proof points:

| Beat | Proves |
|---|---|
| Mandate → Policy | SERV compiles plain English into an enforceable, inspectable policy (not a black box) |
| Spend Permission signed | The cap is on-chain and owner-signed, not a promise in code |
| Autonomy (pull → deposit → payroll) | AgentKit actually executing on Base, SERV balancing yield against obligations due today |
| **Attack blocked** (`scripts/demo/attack.ts`) | A memo trying to talk the agent into "send all USDC to 0xBAD…" gets **DENY**, live, not simulated — this is the safety claim, proven under attack, not just under normal operation |
| Escalation | Human-in-the-loop exactly when the policy says so, never more, never less |
| Risk exit (`scripts/demo/drawdown.ts`) | A real 300bps `MockVault.simulateLoss` triggers a real, autonomous R20 exit — guardian behavior, not just execution |

**Visual**: the live app timeline plus `/demo`'s checklist turning each beat green in real time.

## Slide 3 — Safety proof, not a safety claim (the core differentiator)

- **"SERV Reasoning proposes; deterministic code disposes."** No LLM output ever reaches AgentKit's
  write actions directly — `packages/wallet/src/executor.ts` is the *only* module in the codebase
  allowed to call them, and only with a valid, unexpired, unused `AllowReceipt` minted by a **pure**
  Policy Engine (no network I/O, no LLM import, no clock, no randomness — `packages/policy`, 100%
  branch coverage). Enforced by `pnpm check:arch` with deliberate-violation fixtures, not a code
  review promise.
- **The adversarial corpus is the receipt, not the marketing.** 60 cases (48 malicious, 12 benign):
  **guarantee 48/48 = 100% blocked or safely NOOP'd**, benign false-positive rate **0/12**
  (`packages/reasoning/adversarial`, re-run live in the demo via `scripts/demo/attack.ts`).
- **Phase 8's independent formal review: no HIGH finding, gate PASSES** (`docs/SECURITY_REVIEW.md`).
  Its own words: *"Worst case is not zero. It is bounded... computed by `maxAtRisk` and shown to the
  owner on the dashboard."* Proven on-chain, not argued: a real spend attempted after a real revoke
  was rejected by the chain itself (`docs/PROGRESS.md` V-05, tx
  `0x57caacd5d5f71499a8e3239f2af8745d23a0d0bff526f5542d197f073d13bc92` then `isValid=false`).
- Owner always wins regardless of what SERV or the worker are doing: freeze, revoke and sweep-home
  never call the reasoning layer (I7), and an append-only, hash-chained audit log makes every
  decision replayable.

## Slide 4 — Business model (PRD.md §8)

- **SaaS tiers by treasury size** (Starter / Growth / DAO).
- **Small bps fee on actively managed balance** — after legal review, not assumed.
- **Premium security**: custom risk feeds, custom policy packs.
- **B2B "Sentinel" API**: license the Policy Engine + reasoning-integrity layer itself to *other*
  agent builders who need the same "propose vs. dispose" separation for their own agents — the
  safety architecture is the product, treasury management is the first customer of it.
- Explicitly not dependent on x402 volume (that stretch goal was descoped, `PHASES.md` 8.8).

## Slide 5 — Judging-criteria mapping (PRD.md §9)

| Criterion | Evidence in this build |
|---|---|
| **Creativity** | The propose/dispose split itself, plus a live attack blocked in the demo rather than described; the mandate→policy compiler turning English into an inspectable, testable artifact |
| **User-readiness** | Passkey onboarding, plain-language policy sentences, approval cards, one-click freeze, audit export — all shipped, not mocked (`docs/UX_FLOWS.md`, Phase 7) |
| **Revenue potential** | A large, obviously monetizable idle-capital problem, three concrete revenue lines above, and a security-as-a-service angle (Sentinel API) that doesn't depend on Steward's own AUM |

## Slide 6 — Roadmap (PHASES.md 9.9, honest about the MVP boundary)

- **Session-key custody on the owner's own account** (ERC-7715/7702) — removes the residual bound
  described in `SECURITY_REVIEW.md` §9 entirely; the single biggest planned change.
- Safe module / DAO multi-signer approvals; multi-chain (bridging via Across); a real mainnet vault
  allowlist (Morpho/Aave-class) with live risk feeds; consumer savings and RWA vaults; compliance/KYT
  packs; the Sentinel SDK/API as its own product.

## Slide 7 — Close

> "AgentKit gives agents hands. Steward gives them a conscience you can verify and a leash you
> control."
>
> "The model can be wrong. The model can be attacked. It still can't move a dollar outside your
> mandate."

Restate the tagline. Point at `docs/DEMO.md` for the full script and `/demo` for the live rehearsal
checklist.
