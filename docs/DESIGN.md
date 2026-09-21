# DESIGN — Steward

Status: v1.0, design pass for Phase 7 (2026-09-21). Authority: this file governs Phase 7 UI work.
It does not override `SECURITY.md`, `POLICY_ENGINE.md` or `UX_FLOWS.md` — where `UX_FLOWS.md` fixes
copy or structure, it wins and this file only says how it looks.

Reference research: `docs/design/refs/REFERENCE.md` (Solflare, Coinbase Wallet, Rainbow, sampled live).

---

## 1. The idea

Steward is a wallet that operates itself inside a fence the owner drew. Every screen has to answer
three questions at a glance: **what can it touch, what did it do, how do I stop it.**

So the design's one memorable device is **the limit line**: a 2px `ink` wall standing on a capsule
track, with the track continuing past it as recessed ground Steward may never reach. It marks the
boundary between the money the agent can touch and the money it cannot, and it appears on the
allowance meter and on the runway-vs-buffer bar. It is the only ornament in the system, and it is
not ornament — it is the product's core fact drawn once and reused.

A limit line only earns its place when the limit sits *inside* the range. A meter whose limit is
simply the end of its own track gets no line: the track end is the line. That is why the allowance
meter is drawn at **cap × ~1.15**, so the wall is visible and the dead ground beyond it is legible —
the first version put the tick at 100% and it disappeared into the track's edge.

Everything around it stays quiet: one accent, hairline rules, tabular figures, sentence case, no
gradients behind text, no decorative cards.

### Principles

1. **A number is a promise.** Money is always `amount TOKEN ($usd)`, tabular figures, minor units
   dimmed. The same number never renders two ways in two places.
2. **Cards are objects, rows are records.** A card is used only for a thing that exists (the
   treasury, an approval, a recipient). Anything that is a log, a list of rules, or a sequence is
   rows on one surface with hairlines — never a grid of identical rounded cards.
3. **Glass marks "this floats above your money", nothing else.** See §6.
4. **Certainty is styled, uncertainty is stated.** Stale, degraded, mocked and parked states get
   visible words on the surface that is wrong, not a global apology banner.
5. **Freeze is always one reach away and never shouts until pressed.**
6. **Nothing moves unless the person moved it.** See §8.

### Inherited vs. original

| Inherited from the wallet grammar | Original to Steward |
|---|---|
| Balance-first hierarchy; giant figure with dimmed minor units | The limit line and the whole allowance/at-risk vocabulary |
| Equal-weight action row directly under the balance | Verdict-led decision rows (glyph gutter + sentence + rule chips) |
| Row lists with tabular right-aligned amounts | The literal-signing-message block (mono, copyable, never rebuilt) |
| Pill controls, generous card radii, hairline separators | Palette, typography, the narrow centred column, the parked/degraded states |

Explicitly **not** taken from Solflare: its yellow, FK Grotesk, its mark, illustrations, photography,
marketing colour blocks, tracked-out ALL-CAPS micro labels, and its layouts.

---

## 2. Palette

Two themes. Both are driven by `prefers-color-scheme` **and** overridable with `data-theme="light|dark"`
on `<html>`. Light is the default and the one the demo runs in.

### Named base (6)

| Token | Light | Dark | Role |
|---|---|---|---|
| `ground` | `#F2F4F7` | `#070A0F` | page background |
| `surface` | `#FFFFFF` | `#131923` | solid card / sheet / row container |
| `ink` | `#0F141B` | `#E7EDF6` | primary text |
| `muted` | `#5A6472` | `#98A3B4` | secondary text, labels, dimmed minor units |
| `line` | `#DDE2EA` | `#232B38` | hairline separators (decorative) |
| `seal` | `#2A46A6` | `#8FA8F5` | brand, primary action, focus ring, link |

Plus `line-strong` (`#77818F` / `#586679`) for **interactive** boundaries — inputs, unfilled
buttons, checkbox edges — which must clear 3:1.

### Semantic (3)

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `ok` | `#14713F` | `#4ED18C` | ALLOW, executed, healthy, within limit |
| `warn` | `#8A5300` | `#E3B15A` | ESCALATE, needs you, ≥80% of a limit, stale/degraded |
| `stop` | `#B3261E` | `#FF8A80` | DENY, blocked, frozen, breaker tripped, over limit |

Colour is never the only signal: every verdict carries a glyph and a word as well (WCAG 1.4.1).

### Why this palette and not the obvious one

The three semantics are load-bearing in a policy product, so the brand accent may not be green,
amber or red. That leaves blue/violet/teal. Teal-cyan on blue-black is Coinbase Wallet; yellow is
Solflare. A deep registrar-ink indigo (`seal`) is left, and it is used as **ink and structure**
rather than as a bright fill — filled `seal` appears on exactly one control per screen.

A bronze accent for the allowance meter was drafted and cut: the meter's colour is *semantic*
(`seal` → `warn` at 80% → `stop` at 100%), which is better information than a decorative accent,
and it keeps the palette to one hue plus the three states.

### Contrast (computed, sRGB, WCAG 2.1)

All text pairs are AA at minimum; most are AAA.

| Pair | Light | Dark |
|---|---|---|
| `ink` on `ground` | 16.77 | 16.84 |
| `ink` on `surface` | 18.48 | 14.98 |
| `muted` on `surface` | 6.00 | 6.91 |
| `seal` on `surface` | 8.32 | 7.63 |
| `ok` on `surface` | 6.06 | 9.09 |
| `warn` on `surface` | 6.33 | 8.99 |
| `stop` on `surface` | 6.54 | 7.72 |
| `line-strong` on `surface` (UI boundary, needs 3.0) | 3.95 | 3.02 |
| Filled primary: text on `seal` | 8.32 (white) | 8.58 (`ground`) |
| Filled danger: text on `stop` | 6.54 (white) | 8.68 (`ground`) |

**Glass surfaces, worst case.** Glass is only ever laid over `ground`…`line` (never over imagery or
a gradient — see §6), so the composite is bounded. At α = 0.72 the composite range is
`#FBFCFD`…`#F5F7F9` (light) and `#10151D`…`#171E29` (dark):

| Text on glass, worst backdrop | Light | Dark |
|---|---|---|
| `ink` | 17.21 | 14.23 |
| `muted` | 5.59 | 6.56 |
| `seal` | 7.74 | 7.25 |

---

## 3. Typography

Two families, both OFL, both loaded through `next/font/google` with `display: swap` and a subset.

- **Public Sans** — UI, headings, money. Chosen deliberately: it is a Libre-Franklin-derived
  grotesque commissioned for US government services, i.e. drawn for plain-language, high-trust,
  accessibility-audited interfaces. It has true tabular figures and a variable weight axis. It is
  not the reflex family (Inter / Geist / Satoshi) and it is not Solflare's FK Grotesk.
- **IBM Plex Mono** — **machine data only**: addresses, tx and proposal hashes, rule codes (`R07`),
  policy JSON, and the literal EIP-191 message to sign. Mono is forbidden for prose labels, eyebrows
  or decorative micro-type; if a human wrote it, it is not mono.

### Scale

| Role | Size / line-height | Weight | Tracking | Notes |
|---|---|---|---|---|
| `balance` | 40 / 1.0 (mobile) · 48 / 1.0 (≥640) | 700 | −0.02em | tabular, slashed zero |
| `h1` | 28 / 1.15 | 700 | −0.015em | |
| `h2` | 20 / 1.3 | 600 | −0.01em | |
| `h3` | 17 / 1.35 | 600 | 0 | row titles |
| `body` | 16 / 1.55 | 400 | 0 | max **68ch** |
| `small` | 14 / 1.5 | 400 | 0 | secondary row text |
| `label` | 12.5 / 1.4 | 500 | 0 | sentence case, `muted` — **never ALL CAPS** |
| `mono` | 13 / 1.6 | 400 | 0 | machine data |

### Money rendering (one rule, everywhere)

```
font-variant-numeric: tabular-nums slashed-zero;
```
`10,000` at full size and `ink`; `.00` at `0.72em` and `muted`; ` USDC` at `small`/`muted`;
`($10,000.00)` at `small`/`muted` on the line beneath. Negative amounts take a real minus (−), not
a hyphen. Base units are formatted from `bigint` — no `number` ever reaches the formatter (I12).

### Banned typographic defaults

Tracked-out ALL-CAPS eyebrows; a single word in a headline coloured or italicised; `A · B · C`
middle-dot meta strings; `WORD — fragment` labels; `→` appended to button text; `01 / 02 / 03`
markers except in the onboarding wizard and the freeze flow, which genuinely *are* sequences.

---

## 4. Space, radius, elevation

**Space** (4px base): `1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40 14=56 18=72`.
Card padding 20 mobile / 24 desktop. Row height min 56 (comfortably over the 44px target).
Section gap 24 mobile / 32 desktop.

**Radius**: `sm 8` (chips, inputs), `md 12` (rows, small cards), `lg 18` (cards, balance card),
`xl 24` (sheets, modals; mobile sheets are `24 24 0 0`), `pill 999` (buttons, status pills, meters).
Radii are concentric — a chip inside a `lg` card at 16px inset uses `sm`, not `lg`.

**Elevation** — three levels only.

| Level | Light | Dark | Used for |
|---|---|---|---|
| `e0` | none, `1px line` border | none, `1px line` border | rows, tables, forms, policy sentences |
| `e1` | `0 1px 2px rgba(15,20,27,.06)` + `1px line` | `1px` lightened border only | cards |
| `e2` | `0 16px 40px -12px rgba(15,20,27,.22)` + `1px line` | `0 16px 40px -12px rgba(0,0,0,.6)` + `1px line-strong` | sheets, modals, the sticky header when scrolled |

Shadows do not read on dark grounds, so dark mode expresses elevation with border luminance instead.
There is no fourth level and no coloured shadow anywhere.

---

## 5. Motion

- Motion answers an action, never announces a page. No scroll-reveal, no staggered section
  entrances, no hover transforms on cards.
- Durations: 120ms (state/colour), 180ms (popover, chip), 240ms (sheet/modal). Easing
  `cubic-bezier(.32,.72,0,1)` for enter, `cubic-bezier(.4,0,1,1)` for exit.
- Sheets slide from the bottom on mobile, fade+8px rise on desktop. Modals fade the scrim only.
- The **one** non-user-triggered motion in the product: the status pill's 2px dot performs a slow
  2.4s breathing opacity cycle while the agent is running. It stops on `idle`, `degraded`, `frozen`
  and under reduced motion (where it becomes a static filled dot).
- `@media (prefers-reduced-motion: reduce)` → all durations 0.01ms, no transforms, opacity swaps only.

---

## 6. Glass policy

"Liquid glass" is a **signal**, not a texture. It means: *this layer is temporarily above your money
and will go away*. If a surface is permanent or holds dense data, it is solid.

### Allowed (4 places, no more)

| Surface | Spec |
|---|---|
| Sticky app header (S4's only Freeze entry point) | `bg: surface/72%`, `backdrop-filter: blur(20px) saturate(160%)`, bottom `1px line`. Transparent (no blur, no border) until `scrollY > 8`. |
| Bottom sheets / modals (approval sheet, freeze modal, recipient confirmation) | `bg: surface/76%`, `blur(28px) saturate(160%)`, `1px line-strong` inner hairline, `e2`. Scrim: the `.scrim` token (`color-mix(in srgb, ground 60%, transparent)`), never a Tailwind opacity modifier — those resolve in oklab and cannot be contrast-checked in sRGB. |
| The balance card — the single hero surface | `bg: surface/72%`, `blur(24px)`, `1px line`, `e1`, sitting on a soft radial of `seal` at 6% alpha. This is the only place in the product with a coloured wash, and no text below 16px sits on it. |
| Toasts / the DEMO DATA banner | `bg: surface/80%`, `blur(16px)`. |

### Forbidden (always solid `surface`)

Decision timeline rows · policy sentence lists · rule-check tables · every form, input and slider ·
the recipients list · policy JSON view · audit export screens · settings · anything with text below
16px · anything a screenshot might be taken of for an audit.

A translucent layer's alpha is **never below 0.72**, and nothing but flat `ground`…`line` tokens may
sit behind a glass surface — no photos, no gradients, no video. That is what makes the contrast
figures in §2 valid rather than aspirational.

### Fallbacks (all three, in this order)

```css
.glass { background: var(--surface); }                 /* 1. solid by default   */
@supports (backdrop-filter: blur(1px)) {               /* 2. opt in when able   */
  .glass { background: color-mix(in srgb, var(--surface) 72%, transparent);
           backdrop-filter: blur(20px) saturate(160%); }
}
@media (prefers-reduced-transparency: reduce), (forced-colors: active) {
  .glass { background: var(--surface); backdrop-filter: none; }   /* 3. opt back out */
}
```
Under `forced-colors`, borders switch to `CanvasText` and the coloured wash is removed.

---

## 7. Component inventory

Every component below is what Phase 7 builds. Names are the component names to use.

| Component | Behaviour |
|---|---|
| `BalanceCard` | Glass hero. Label "Treasury" → balance (money rule) → delta line → `AllowanceMeter` → `MaxAtRiskChip` → equal-weight action row (Add funds · Activity · Recipients). Freeze is **not** repeated here: it lives in the header and only there, so there is one red control per screen. |
| `AllowanceMeter` | Pill track drawn at **cap × 1.15**, so the **limit line** stands at ~86% with recessed ground after it. Fill = amount used today; `seal`, `warn` ≥80%, `stop` ≥100%. Caption: "5,800 of today's 10,000 USDC limit used. Steward stops at the line." `role="meter"` with `aria-valuenow/min/max/valuetext`. |
| `RunwayBar` | Same track, limit line at the buffer floor. Caption names runway in months. |
| `MaxAtRiskChip` | Pill, `line-strong` border, no fill. "Maximum at risk 12,400 USDC" + info affordance explaining agent balance + vault position + allowance remaining. |
| `StatusPill` | `running` (dot breathes, `ok`) · `idle` (static dot, `muted`) · `degraded` (`warn`, "Safe mode — scheduled payments and risk exits only") · `frozen` (`stop`, "Frozen") · `parked` (`warn`, RR-14) · `breaker` (`stop`). Lives in an `aria-live="polite"` region; the live region announces the word, not the colour. |
| `ParkedNotice` | **RR-14.** When the latest `NOOP` audit row carries a stuck-obligation reason, a solid `warn`-bordered notice sits directly under the balance card: "Steward is holding still. It can't pay {recipient} ({amount}) inside today's limit, and it won't deploy idle cash while a payment is due. Nothing is wrong with your funds." + "See why" → the decision detail. This is never hidden behind an expander. |
| `DemoBanner` | I11. Full-width, sticky under the header, glass, `warn` border, text "Demo data — prices and rates are simulated on Base Sepolia." Present whenever `DEMO_MODE && chainId === 84532`. Not dismissible. |
| `DecisionRow` | Solid row. 20px glyph gutter (✓ `ok` / ⚠ `warn` / ✕ `stop` / · `muted` for noop) · one-sentence explanation (`h3` weight 500) · relative time (`small`/`muted`) · right-aligned amount. Expands in place to Context / Proposal / Verifier / Policy checks / Simulation / Transaction. Denied rows get a `stop` left edge (2px) and a "Why was this blocked?" block. |
| `RuleChip` | `R07` in mono + the rule sentence + glyph. `sm` radius, `line-strong` border, tinted background only for `stop`. Never a bare code without its sentence. |
| `ApprovalCard` / `ApprovalSheet` | Card on the list, glass sheet when opened (full-screen on mobile). Order: action sentence → amounts → "You'll see these changes" simulation deltas → rationale → triggered `RuleChip`s → expiry countdown → `SigningMessage` → Approve / Reject. |
| `SigningMessage` | **The literal `message` string from `GET /api/approvals`, rendered verbatim in mono, `pre-wrap`, solid surface, with a copy button.** The UI must never rebuild or reformat it (SECURITY §5). Above it, one line: "This is exactly what your wallet will show you." |
| `FreezeButton` | Header, right — the product's only Freeze entry point. Outline only: `stop` text + `stop` border, transparent fill, pill, min 44×44. Never filled, never animated, no icon-only version. |
| `FreezeModal` | Glass, `e2`. Three numbered steps (a genuine sequence): 1 Freeze now · 2 Revoke spending permission · 3 Bring funds home. Each step shows idle / running / done / failed + retry. The step-1 button is the only filled `stop` control in the product. Confirmation text: "Steward is stopped. No further actions will be taken." |
| `Empty` | Icon-free. One `h2` line + one `body` line + one primary action. "No activity yet. Steward checks your treasury every five minutes and will explain anything it does here." |
| `ErrorState` | What happened · **whether money moved** · what to do next. Never apologises, never says "Oops". `stop` border on a solid surface. |
| `Loading` | Skeletons only where the shape is known (balance, rows), matching the real layout's metrics so nothing shifts. No spinners except inside a pressed button. Skeletons are `line` at 1.6s ease-in-out opacity, disabled under reduced motion. |
| `StaleBadge` | Inline on the card whose data is old: "Updated 6 min ago" in `warn`. Per-card, never global. |
| `Money` | The single formatter component. Takes `bigint` base units + decimals + optional micro-USD. Nothing else formats money. |

### Copy voice

Sentence case everywhere. Plain verbs. "Steward" or "your agent", never "the AI". One name per
action through the whole flow — the button that says **Freeze** produces the word **Frozen**; the
button that says **Approve** produces **Approved**. Amounts always carry token *and* USD. Errors
state what happened, whether money moved, and the next step. Nothing apologises.

---

## 8. Layout

**Mobile-first, and the desktop keeps the phone.** A wallet is a phone object; a 1200px dashboard
would make it feel like an admin console and undermine the "it is your wallet" framing.

- Base column: `min(100% - 32px, 440px)`, centred, at every breakpoint.
- **Wide variant** (`max 1040px`, two columns) only on `/app/activity` and `/app/policy`, where a
  detail pane genuinely earns the width. Everything else stays 440.
- Alignment: left-aligned throughout, except the balance figure and its label block, which are
  centred on the balance card only (the wallet convention), and amounts in rows, which are right
  aligned to a tabular column.
- Sticky header, 56px, glass: wordmark left · `StatusPill` centre · `FreezeButton` right.
- Mobile: no bottom tab bar in MVP — the balance card's action row is the navigation.

### Wordmark

Set "Steward" in Public Sans 600 at `-0.02em`, with the **limit line** as the mark: a 2px `seal`
rule under the final three letters, stopping short of the `d` — the fence that does not reach the
end. No logo file, no icon, no gradient. Original to us.

---

## 9. Wireframes

### S1 Landing `/` (mobile 390)

```
┌──────────────────────────────┐
│ Steward            Connect   │  header, transparent until scroll
├──────────────────────────────┤
│                              │
│  The self-driving treasury   │  h1, 28/700, 2 lines, left
│  that can't run off with     │
│  the money.                  │
│                              │
│  Steward keeps your idle     │  body, 68ch max
│  USDC working, pays your     │
│  team on schedule, and       │
│  cannot exceed the limit     │
│  you signed.                 │
│                              │
│  [ Connect wallet ]          │  filled seal, pill, 48h, full width
│                              │
│ ┌──────────────────────────┐ │  the hero proof — a live-looking
│ │ Treasury                 │ │  BalanceCard with the limit line,
│ │      124,000.00 USDC     │ │  static and labelled "Example"
│ │ Steward can move at most │ │
│ │ ▓▓▓▓▓▓░░░░░│░░░░░░░░░░   │ │  ← the limit line, the one device
│ │ 10,000 USDC a day        │ │
│ └──────────────────────────┘ │
│                              │
│  Earns on idle cash          │  three rows, hairlines, no cards,
│  ───────────────────────────  │  no icons, no numbered markers
│  Pays your team on time      │
│  ───────────────────────────  │
│  Attacks blocked      1,204  │  tabular, right
│                              │
└──────────────────────────────┘
```
Desktop: same 440 column, centred, with the headline allowed to 560 above it. No hero image, no
feature grid, no gradient wash.

### S2 Connect `/connect`

```
┌──────────────────────────────┐
│ Steward                      │
├──────────────────────────────┤
│  Connect your wallet         │  h1
│  Steward never sees a seed   │  body/muted
│  phrase and never holds      │
│  your funds.                 │
│ ┌──────────────────────────┐ │
│ │ Coinbase Smart Wallet    │ │  row, 56h, solid, chevron
│ │ Passkey — no extension   │ │
│ └──────────────────────────┘ │
│                              │
│  States (replace the row):   │
│  · Connecting…  skeleton row │
│  · Wrong network → inline    │
│    notice + [ Switch to      │
│    Base Sepolia ]            │
│  · Signature rejected →      │
│    "You declined the         │
│    signature. Nothing was    │
│    sent." [ Try again ]      │
│  · Unsupported wallet →      │
│    explanation + link        │
└──────────────────────────────┘
```

### S3 Onboarding `/onboarding` (5 steps — a real sequence, so numbered)

```
┌──────────────────────────────┐
│ Steward              Step 3/5│
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ │  2px seal progress rule
├──────────────────────────────┤
│  Write your mandate          │  h1
│  Plain English. Steward      │
│  turns it into rules you     │
│  approve before anything     │
│  runs.                       │
│                              │
│  [Startup] [DAO] [Creator]   │  template chips, sm radius
│ ┌──────────────────────────┐ │
│ │ Keep six months of       │ │  textarea, SOLID, line-strong
│ │ runway liquid…           │ │  border, 8 rows, 16px text
│ └──────────────────────────┘ │
│  [ Compile ]                 │
│  ── after compile ──         │
│  Rules                       │  h2
│  · Steward can move at most  │  sentence list, solid rows,
│    10,000 USDC a day.        │  hairlines — NOT cards
│  · Steward can only pay      │
│    recipients you added.     │
│  Assumptions                 │
│  · Buffer means liquid USDC. │
│  Questions                   │
│  · Should vendor payments    │
│    count toward the cap?     │
│  Issues                      │
│ ┌──────────────────────────┐ │  stop-bordered solid notice
│ │ ✕ R-CEIL  A daily cap of │ │  inline at the rule it affects
│ │   500,000 exceeds the    │ │
│ │   system ceiling.        │ │
│ │   Try 100,000 or less.   │ │
│ └──────────────────────────┘ │
│  [ Edit mandate ] [Recompile]│
└──────────────────────────────┘
```
Step 4 (spending limit) is the same column: allowance slider (solid), end-date input, then a live
`MaxAtRiskChip` and the sentence "Steward can move at most 10,000 USDC per day until 31 Dec 2026.
The most it could ever hold is 12,400 USDC." Then the signing sheet.

### S4 Dashboard `/app` (mobile 390 — the primary screen)

```
┌──────────────────────────────┐
│ Steward   ● Running   Freeze │  glass header, 56h
├──────────────────────────────┤
│ Demo data — prices and rates │  DemoBanner (I11), glass, warn
│ are simulated on Base Sep.   │
├──────────────────────────────┤
│ ┌ ── glass, lg radius ─────┐ │
│ │ Treasury                 │ │  label 12.5 muted, centred
│ │                          │ │
│ │     124,000.00 USDC      │ │  balance 40/700, .00 dimmed
│ │      ($124,000.00)       │ │  small/muted
│ │                          │ │
│ │ Allowance left today     │ │
│ │ ▓▓▓▓▓▓░░░░░│░░░░░░░░░░░  │ │  AllowanceMeter + limit line
│ │ 4,200 of 10,000 USDC     │ │
│ │                          │ │
│ │ ( Maximum at risk        │ │  MaxAtRiskChip, outline pill
│ │   12,400 USDC  ⓘ )       │ │
│ │                          │ │
│ │ [Add funds][Activity][❄] │ │  equal-weight row, pill, 44h
│ └──────────────────────────┘ │
│                              │
│ ⚠ Steward is holding still.  │  ParkedNotice (RR-14) — solid,
│   It can't pay Acme (8,000   │  warn border. Only when parked.
│   USDC) inside today's limit │
│   and won't deploy idle cash │
│   while a payment is due.    │
│   Nothing is wrong with your │
│   funds.  See why            │
│                              │
│ Working in vaults            │  h2
│ ┌──────────────────────────┐ │  solid card, e1
│ │ Aave USDC        44,000  │ │  rows, tabular right
│ │ 4.8% APY · updated 2m    │ │
│ └──────────────────────────┘ │
│                              │
│ Liquid runway                │  h2
│ ▓▓▓▓▓▓▓▓▓▓▓│░░░░░░░░░░░░░░  │  RunwayBar, limit line = buffer
│ 7.4 months · buffer 6.0      │
│                              │
│ Next up                      │  h2
│ Acme Design   1 Oct   8,000  │  rows, hairlines
│ Payroll       5 Oct  22,400  │
│                              │
│ Recent activity   View all   │
│ ✓ Deposited 44,000 to Aave   │  DecisionRows, solid
│ ⚠ Waiting for you: pay Acme  │
│ ✕ Blocked a payment to an    │
│   address not on your list   │
│                              │
│ Attacks blocked 3 · checked  │  small/muted, no card
│ 40 seconds ago               │
└──────────────────────────────┘
```
Desktop: identical 440 column. The only change is the header gains the wordmark's full lockup and
the action row sits on one line.

### S5 Timeline `/app/activity` (wide variant)

```
mobile 390                         desktop 1040 (two columns)
┌──────────────────────────┐       ┌──────────────┬──────────────────────┐
│ Activity                 │       │ Activity     │ Deposited 44,000     │
│ [All][Allowed][Blocked]  │       │ [filters]    │ 12:04 · R00 R03 R07  │
│ ✓ Deposited 44,000 USDC  │       │ ✓ Deposit…   │ ┌──────────────────┐ │
│   to Aave     12:04      │       │ ⚠ Waiting…   │ │Context│Proposal│…│ │
│ ─────────────────────────│       │ ✕ Blocked…   │ └──────────────────┘ │
│ ⚠ Waiting for you        │       │ · No action  │ Policy checks        │
│   pay Acme 8,000  11:59  │       │              │ ✓ R00 Kind allowed   │
│ ─────────────────────────│       │              │ ✓ R03 Recipient on   │
│ ┃✕ Blocked a payment to  │       │              │      your list       │
│ ┃  an address not on     │       │              │ ✕ R07 Over today's   │
│ ┃  your list     11:47   │       │              │      limit           │
│ ┃  Why was this blocked? │       │              │ Transaction 0x9a…3f  │
└──────────────────────────┘       └──────────────┴──────────────────────┘
```
Expanded tabs, in order: Context · Proposal · Verifier · Policy checks · Simulation · Transaction.
Every rule renders as `RuleChip` (code + sentence). No tab is a card grid.

### S6 Approvals `/app/approvals` + sheet

```
list (440)                         sheet (glass, full-screen ≤640)
┌──────────────────────────┐       ┌──────────────────────────────┐
│ Waiting for you      (1) │       │ ✕                            │
│ ┌──────────────────────┐ │       │ Pay Acme Design              │  h1
│ │ Pay Acme Design      │ │       │ 8,000.00 USDC ($8,000.00)    │  money
│ │ 8,000.00 USDC        │ │       │                              │
│ │ Expires in 5h 12m    │ │       │ You'll see these changes     │  h2
│ │ [ Review ]           │ │       │ Agent wallet  −8,000.00 USDC │  rows
│ └──────────────────────┘ │       │ Acme Design   +8,000.00 USDC │
│                          │       │                              │
│ expired:                 │       │ Why Steward proposed this    │  h2
│ [ Review ] disabled +    │       │ The 1 Oct invoice is due and │
│ "This expired. Ask       │       │ sits above the amount it can │
│  Steward to re-evaluate."│       │ pay on its own.              │
│                          │       │                              │
│ policy changed:          │       │ Rules that triggered         │  h2
│ "Your policy changed, so │       │ ⚠ R10 Above autonomous limit │  RuleChips
│  Steward cancelled this. │       │ ✓ R03 Recipient on your list │
│  It will re-evaluate on  │       │                              │
│  the next check."        │       │ What you will sign           │  h2
└──────────────────────────┘       │ ┌──────────────────────────┐ │
                                   │ │Steward approval          │ │  SOLID,
                                   │ │Wallet: 7f3c…             │ │  mono,
                                   │ │Proposal: 0x9a41…         │ │  verbatim,
                                   │ │Policy: v3                │ │  copy btn
                                   │ │Expires: 2026-09-21T18:…  │ │
                                   │ └──────────────────────────┘ │
                                   │ This is exactly what your    │
                                   │ wallet will show you.        │
                                   │ Expires in 5h 12m            │  warn <1h
                                   │ [   Approve   ] [  Reject  ] │  48h, 12 gap
                                   └──────────────────────────────┘
```

### S7 Policy `/app/policy` (wide variant)

Left: sentences, one per solid row, grouped by heading (Limits · Recipients · Vaults · Risk).
Right: read-only JSON in mono on a solid surface with a copy button. A `Sentences | JSON` segmented
control on mobile. "Edit mandate" → recompile → diff view: added rows get an `ok` left edge, removed
rows `stop` + strikethrough, changed rows `warn` with before/after on two lines. Then the signing
sheet. Never a side-by-side diff on mobile.

### S8 Recipients `/app/recipients`

```
┌──────────────────────────────┐
│ Recipients        [ Add ]    │
│ Acme Design                  │  rows, solid
│ 0x7f3c…9a41 · max 10,000     │  address in mono
│ ─────────────────────────────│
│ Add (sheet):                 │
│  Label        [__________]   │  solid inputs, line-strong
│  Address      [__________]   │  mono input
│  Max per payment [_______]   │
│  Monthly on day  [_______]   │
│ ┌──────────────────────────┐ │  confirmation block, solid
│ │ 0x7f3c 9d21 88ab c410    │ │  full address, 4-char chunks,
│ │ 6e5f 1a2b 3c4d 5e6f 9a41 │ │  mono, first/last 6 in ink,
│ │ Checksum valid           │ │  middle in muted
│ └──────────────────────────┘ │
│ ⚠ This looks like Acme Ops   │  poisoning heuristic, warn,
│   (0x7f3c…9a4f). Check every │  never blocks — warns
│   character before signing.  │
│ [ Sign and add recipient ]   │
└──────────────────────────────┘
```

### S9 Freeze (modal, global — reachable from every authenticated screen)

```
┌──────────────────────────────┐
│ ▒▒▒▒▒ scrim ground/60 ▒▒▒▒▒▒ │
│ ┌ glass, xl radius, e2 ────┐ │
│ │ Stop Steward             │ │  h1 — not "Emergency!"
│ │ Freezing stops every     │ │
│ │ action immediately. Your │ │
│ │ funds stay where they    │ │
│ │ are and you can undo     │ │
│ │ this in Settings.        │ │
│ │                          │ │
│ │ 1 Freeze now             │ │  genuine sequence
│ │   [ Freeze now ]         │ │  ← the ONLY filled stop button
│ │ 2 Revoke spending        │ │
│ │   permission             │ │
│ │   [ Revoke ] (outline)   │ │
│ │ 3 Bring funds home       │ │
│ │   [ Sweep ]   (outline)  │ │
│ │                          │ │
│ │ done →  ✓ Frozen at      │ │
│ │           14:02          │ │
│ │ failed → ✕ Revoke failed.│ │
│ │   Nothing moved.         │ │
│ │   [ Try again ]          │ │
│ │                          │ │
│ │ [ Close ]                │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
After step 1, the whole app chrome switches: `StatusPill` → `frozen` (`stop`), the balance card
loses its `seal` wash, and a persistent solid bar reads "Steward is stopped. No further actions will
be taken. Unfreeze in Settings."

### S10 Settings `/app/settings`

Grouped solid rows: Notifications (Telegram link) · Export audit (CSV / JSON) · Verify audit chain
(runs and shows "365 rows verified, chain intact" or the first bad row) · Unfreeze (signature) ·
Close account. Destructive rows are last, with `stop` text and no fill.

### S11 Account closure

A single checklist on one solid card — a genuine sequence, so numbered: 1 Freeze · 2 Revoke ·
3 Bring funds home · 4 Export audit · 5 Delete personal data. Each line shows done / pending and
cannot be reached out of order. Footer: "Audit rows are kept, with your personal details removed."

### Global states

- Worker offline > 10 min → solid `warn` bar under the header: "Steward is paused (service issue).
  Your funds are safe; nothing will move."
- `degraded: true` from `GET /api/wallet` → `StatusPill` = `degraded` + the sentence "Safe mode —
  scheduled payments and risk exits only."
- Stale RPC → per-card `StaleBadge`, never a global banner.

---

## 10. Accessibility floor

Non-negotiable for Phase 7 (NFR-7).

- **Focus**: `outline: 2px solid seal; outline-offset: 2px` on every interactive element. Never
  removed, never replaced with a shadow. Visible in both themes (seal clears 3:1 on both grounds).
- **Targets**: 44×44 minimum, including the freeze button, the status pill's info affordance and
  every row chevron. Rows are 56px tall.
- **Keyboard**: approve and freeze are both fully operable from the keyboard with no pointer.
  Sheets and modals trap focus, restore it on close, close on Escape, and have their heading as
  `aria-labelledby`. The freeze button is the last stop in the header landmark and is reachable in
  ≤ 3 tabs from the top of any authenticated page; a skip link jumps to main content.
- **Announcements**: agent status, approval counts and freeze completion sit in `aria-live="polite"`
  regions that announce words ("Frozen", "Waiting for you: 1"), not colours. Errors use
  `aria-live="assertive"` once, then stop.
- **Meters**: `role="meter"` with `aria-valuetext` in the same sentence the caption uses.
- **Colour independence**: every verdict is glyph + word + colour.
- **Motion / transparency**: `prefers-reduced-motion` and `prefers-reduced-transparency` respected
  as in §5 and §6; `forced-colors` supported.
- **Text**: body is 16px, never below 12.5px anywhere, and the layout survives 200% zoom and
  400% reflow at 320px width without horizontal scroll.

---

## 11. Handover rules for Phase 7 engineers

1. Tokens live in `apps/web/app/globals.css` under `@theme`. Do not hardcode a hex in a component.
2. All money goes through `<Money />`. Never `Number(...)` a base-unit value (I12).
3. The approval message is rendered from the API's `message` field verbatim. Rebuilding it is a
   security bug, not a style bug (SECURITY §5).
4. The freeze path's components import nothing from reasoning, policy or executor packages (I7,
   `pnpm check:arch`).
5. `DEMO DATA` is driven by server state, never a client constant (I11).
6. Before adding a card, ask whether the content is an object or a record. Records are rows.
7. Before adding glass, check §6's allowed list. If it is not on the list, it is solid.
8. `docs/design/preview` (`/preview`) is the living reference; keep it in sync when a component
   changes.
