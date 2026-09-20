# UX FLOWS — Steward

Design language: calm, "bank-grade", trustworthy. One accent color, lots of whitespace, numbers in
tabular figures. Every screen answers: *what is the agent allowed to do, what did it do, and how do I stop it?*
The **Freeze** button is visible on every authenticated screen (top-right, red outline).

## Copy rules
- Say "Steward" or "your agent", never "the AI".
- Always show amounts with token + USD, e.g. `10,000 USDC ($10,000)`.
- Explain limits in sentences ("Steward can move at most 10,000 USDC per day from your wallet").
- Errors say what happened, whether money moved, and what to do next.

## Screens

### S1 Landing (`/`)
Hero: "The self-driving treasury that can't run off with the money." Three proof points: earns on idle
cash · pays your team on time · blocked-attack counter (demo). CTA: "Connect wallet".

### S2 Connect & sign-in (`/connect`)
Coinbase Smart Wallet (passkey) → SIWE. States: connecting, wrong network (auto-switch to Base Sepolia),
signature rejected (retry), unsupported wallet (explain).

### S3 Onboarding wizard (`/onboarding`, 5 steps, progress bar, resumable)
1. **Meet Steward** — 3 bullets on how safety works (reasoning proposes / code disposes / you can freeze anytime).
2. **Create agent wallet** — provisions; shows agent address with copy + "This wallet only ever holds what you allow."
3. **Write your mandate** — template chips + textarea with example; "Compile" → shows compiled rules as sentences,
   assumptions, and questions. Issues (ceiling violations) shown inline with fix suggestions. Edit & recompile loop.
4. **Set the spending limit** — Spend Permission: allowance/day slider, end date; "Maximum at risk" computed live.
   Sign in wallet. Edge: user rejects → stay on step with explanation.
5. **Sign your policy** — final review; sign; activate. Then "Fund your treasury" help (faucet link on testnet).

### S4 Dashboard (`/app`)
- Top cards: Treasury USDC · Working in vaults (+ APY) · Liquid runway vs buffer (bar) · Maximum at risk · Allowance left today.
- Status pill: `Active` / `Waiting for approval (n)` / `Frozen` / `Breaker tripped`.
- "Next up": upcoming obligations (7 days).
- Recent activity (last 5 timeline items) + "View all".
- Security widget: attacks blocked, last check time.

### S5 Timeline (`/app/activity`)
Each item: icon by status, one-line explanation (SERV explain), amount, time. Expand → tabs:
Context (facts) · Proposal · Verifier · Policy checks (each rule code with ✓ / ⚠ / ✕ and sentence) · Simulation deltas · Transaction (explorer link).
Denied security events are red with a "Why was this blocked?" section.

### S6 Approvals (`/app/approvals`) + approval sheet
Card: action sentence, amounts, simulation "You'll see these changes", rationale, triggered rules, expiry countdown.
Buttons: Approve (wallet signature) / Reject. Edge: expired → disabled + "Ask Steward to re-evaluate".
Policy changed since proposal → auto-cancelled with explanation.

### S7 Policy (`/app/policy`)
Sentences view + JSON view (read-only). "Edit mandate" → recompile → diff view (added/removed/changed rules) → sign new version.

### S8 Recipients (`/app/recipients`)
List, add (label, address with checksum validation, max per payment, optional monthly schedule).
Address-add confirmation shows first 6/last 6 chars *and* a full-address visual chunking; requires signature.
Warn if address resembles an existing recipient (similar prefix/suffix) — poisoning heuristic (UI only).

### S9 Freeze flow (modal, global)
Step 1 "Freeze now" (instant, signature) → "Steward is stopped. No further actions will be taken."
Step 2 "Revoke spending permission" (wallet tx). Step 3 "Bring funds home" (sweep) with progress.
Each step shows done/failed with retry. Unfreeze lives in Settings with a signature.

### S10 Settings (`/app/settings`)
Notifications (Telegram link), export audit (CSV/JSON), verify audit chain, unfreeze, close account.

### S11 Account closure
Checklist: freeze → revoke → sweep → export → delete personal data (audit rows retained anonymized per policy).

## Global states & edge cases
- DEMO banner when DEMO_MODE (I11).
- Worker offline > 10 min: yellow banner "Steward is paused (service issue). Your funds are safe; nothing will move."
- SERV unavailable: "Running in safe mode — scheduled payments and risk exits only."
- RPC issues: stale-data indicator on cards (last updated time).
- Mobile: dashboard cards stack; approval sheet full-screen; freeze accessible from header.
