# DESIGN — Steward

Status: **v2.0** — Solflare-referenced redesign (2026-09-22). Authority: this file governs Phase 7 UI
work. It does not override `SECURITY.md`, `POLICY_ENGINE.md` or `UX_FLOWS.md` — where `UX_FLOWS.md`
fixes copy or structure, it wins and this file only says how it looks.

Measured reference: `docs/design/refs/REFERENCE.md`. The client's own screenshots live in
`docs/design/Photos/` and are **git-ignored** (third-party app art is never committed).

---

## v2 changelog — what changed and why

The client supplied 26 screenshots of the Solflare mobile app and asked for **the same style and the
same UI language, with the yellow replaced by a light green**, adapted to Steward's context. v1 was a
light-first, blue-sealed, editorial-leaning system of our own invention. v2 replaces it.

| # | Changed | Why |
|---|---|---|
| 1 | **Default theme flipped to dark.** All 26 reference frames are dark. Light is now the alternate, not the source of truth. | Match the reference. |
| 2 | **Whole neutral ramp replaced** with the measured values: ground `#090C11`, surfaces `#111419` / `#1B1E23` / `#24272F`, hairline `#2A2D31`, muted `#B3B6BE`. | Measured from the frames, not invented. |
| 3 | **Accent: blue `--seal` retired → light green `#AEF07A`** with near-black ink on it, in exactly the 8 roles the yellow occupied. | The client's core instruction. |
| 4 | **Verdict green moved off the accent hue** to teal `#2FD9A6`, and every verdict now carries an icon + a word. | The brand accent is now green; "green = safe" by colour alone would be ambiguous. See §4. |
| 5 | **Radii grew and became pill-first**: cards 24, sheets 28-top, rows 20, controls fully rounded. v1's 8/12/18/24 squircle scale is gone. | The reference is pill-first; v1 read as a document, not a wallet. |
| 6 | **Balance-first home** with a 5-across circular action row, a bottom tab bar and full-bleed pressed rows. v1's header-nav + card-grid dashboard is gone. | The reference's core grammar. |
| 7 | **Fonts: Public Sans + IBM Plex Mono → Figtree + Geist Mono.** | Figtree's single-storey `g`, tall x-height and geometric-humanist build are the closest free/OFL match to the reference's FK Grotesk. See `PROGRESS.md` D-65. |
| 8 | **The limit-line meter device survives**, restyled onto the new ramp. | It is ours, it is the one thing in the product that explains the whole idea, and it tested well. |
| 9 | Glass policy unchanged in spirit, re-scoped to the new surfaces. | Still "only where needed". |

**What v2 does *not* take from the reference:** its name, wordmark, blackletter `S`, mascot and
skeleton artwork, card renders, photography, copy, or any image asset. Steward ships its own mark,
its own accent, and its own words. We replicate **layout patterns, proportions, hierarchy, radii,
spacing and surface treatment** — the shared grammar of every wallet — and nothing that identifies
someone else's brand.

---

## 1. The idea

Steward is a treasury that runs itself inside a fence the owner drew. The interface has one job:
make the fence visible at all times, and make stopping the agent the easiest thing on screen.

### Principles

1. **Balance first, fence second, everything else third.** The first screenful answers "how much do
   I have, how much may Steward move, and can I stop it".
2. **The agent proposes, the fence disposes.** Every row that represents an agent action shows the
   verdict that let it through, as an icon plus a word. Never colour alone.
3. **Calm until it matters.** One accent. No ambient motion except while the agent is actually
   running. Freeze is always present and always quiet until pressed.
4. **Dense data is solid.** Glass is for chrome and for things that float. Numbers, rules and forms
   sit on opaque surfaces so they can be read.
5. **Nothing decorative claims to be data.** No fake charts, no invented precision, no status dots
   that mean nothing.

### The one device: the limit line

A horizontal meter whose track is split by a 2px vertical rule. Left of the rule is the spend
permission Steward may use; right of the rule, recessed to ground colour, is money it can never
touch. The fill is the accent. The rule is ink. It appears on the dashboard, in the approval sheet
and in policy explanations, and nowhere else. It is original to Steward.

---

## 2. Palette

All values measured or computed. Dark is the default; light is the alternate. One accent, page-wide.

### Neutral ramp — dark (default)

| Token | Hex | Use |
|---|---|---|
| `ground` | `#090C11` | page background |
| `surface` | `#111419` | tab bar, sheets, popovers, sticky header base |
| `surface-2` | `#1B1E23` | cards, icon chips, disabled controls, token pills |
| `surface-3` | `#24272F` | circular action buttons, pressed/hover rows, segmented-active |
| `line` | `#2A2D31` | hairlines, input borders, dimmed minor units |
| `line-strong` | `#5A616B` | control boundaries that must be seen (3.13:1 on ground) |
| `ink` | `#FFFFFF` | primary text |
| `muted` | `#B3B6BE` | secondary text, inactive tab labels, placeholders |
| `faint` | `#7E838D` | eyebrow labels, timestamps, grabber |

### Neutral ramp — light (alternate)

`ground #F4F6FA` · `surface #FFFFFF` · `surface-2 #EEF1F6` · `surface-3 #E4E8EF` ·
`line #D6DBE4` · `line-strong #5A6270` · `ink #0B0F16` · `muted #525A68` · `faint #6E7684`.

### Accent

| Token | Hex | Notes |
|---|---|---|
| `accent` | **`#AEF07A`** | hue 94°, L 0.727. Replaces the reference's `#FFEF46` (hue 55°, L 0.834) at near-identical luminance, so the whole value structure of the reference survives the swap. |
| `accent-press` | `#98DE5F` | hover / pressed / active |
| `on-accent` | `#0B120B` | the only text colour ever placed on the accent. 14.06:1. |
| `accent-ink` | `#3F6B1A` | accent-*coloured text* in the **light** theme only (5.83:1). In light, the accent is a fill, never a text colour. |

**The 8 accent roles** (the complete list, inherited one-for-one from the reference):
primary CTA fill · bottom-tab active indicator (a 3px bar *above* the tab) · underline-tab active
rule · toggle "on" track · unread dot · top-of-page loading bar · the brand mark · the limit-line
fill. Outside those eight, the accent does not appear. It is never a surface tint, never body text,
and **never a status**.

### Semantic (never the accent)

| Token | Dark | Light | Always paired with |
|---|---|---|---|
| `allow` | `#2FD9A6` (teal) | `#067A59` | a **filled** check glyph + the word "Allowed" |
| `escalate` | `#FFB020` (amber) | `#8A5300` | an **outlined** ring glyph + the word "Needs you" |
| `deny` | `#FF6A5E` (red) | `#C42A1B` | a **filled** slash glyph + the word "Denied" |
| `deny-fill` | `#D92D1E` | `#C42A1B` | filled danger control, white label (4.83:1 / 5.68:1) |
| `info` | `#7C8CFF` | `#3B45C9` | neutral notices, links |

---

## 3. Typography

**Figtree** (OFL, variable, `next/font/google`) for everything. **Geist Mono** (OFL,
`next/font/google`) for addresses, hashes, tx ids and the eyebrow micro-labels. No third family.

Figtree is the substitute for the reference's FK Grotesk: single-storey `g`, tall x-height,
geometric-humanist grotesk, lining figures. It is free, variable, and loaded through `next/font` so
there is no render-blocking `<link>`.

### Scale

| Token | px / line-height | Weight | Use |
|---|---|---|---|
| `balance` | 44 / 1.0, `-0.02em` | 700 | the treasury figure. Minor units dimmed to `line`. |
| `balance-lg` | 52 / 1.0 | 700 | desktop balance |
| `h1` | 28 / 1.15, `-0.015em` | 700 | screen titles on full-screen states |
| `h2` | 20 / 1.3 | 700 | sheet titles, empty-state titles |
| `h3` | 17 / 1.35 | 600 | list-row primary |
| `body` | 16 / 1.55 | 400 | prose, max 65ch |
| `small` | 15 / 1.5 | 400 | list-row secondary, sheet body |
| `label` | 11 / 1.4, `0.12em`, uppercase | 600 | eyebrows (`BALANCE`, `RECIPIENTS`) — Geist Mono |
| `mono` | 13 / 1.6 | 400 | addresses, hashes, amounts in detail rows |

### Money, one rule everywhere

`10,000 USDC ($10,000)` — token amount first with its symbol, USD in parentheses. Always
`font-variant-numeric: tabular-nums slashed-zero`. On the balance card only, the minor units are
rendered in `line` colour at the same size (`$12,480` bright, `.00` dim), exactly as the reference
does it. Never round. Never use a JS `number` to produce it.

### Banned

No `Inter`. No serif anywhere. No all-caps beyond the `label` token. No em-dashes (`—`) or en-dashes
in any visible string — use a plain hyphen. No emoji. No gradient text. No text shadows. No orphan
words in headlines (`text-wrap: balance` on h1/h2).

---

## 4. The accent-vs-verdict conflict, solved

The brand accent is now green. Our "allowed" verdict was green. Left alone, a green pill would mean
either "brand" or "safe" and the user could not tell which. Resolution, in force everywhere:

1. **Verdicts are never the accent.** `allow` is teal `#2FD9A6`, hue 160°, measured ΔE 41 from the
   accent — a different hue family, not a shade of it.
2. **Every verdict carries a glyph and a word.** `Allowed` / `Needs you` / `Denied`. Colour is the
   third channel, never the first.
3. **Glyph fill is a second non-colour channel.** `allow` is a filled disc, `escalate` is an
   outlined ring, `deny` is a filled disc with a slash. Distinguishable in greyscale.
4. **The accent never means "safe".** It means "this is the primary thing to press" or "this is
   Steward". An accent-filled button inside an approval sheet says *approve*, not *this is fine*.
5. **Verified under simulated deuteranopia** (Brettel/Viénot matrix, `scratchpad/color.py`):
   accent `#AEF07A` → `#DFDF7D`, allow `#2FD9A6` → `#BBBBA9`. ΔE between them after simulation is
   **42** — still clearly separable. Amber and red converge under the same simulation (`#CBCB06` vs
   `#9C9C1B`), which is precisely why rule 2 exists and is not optional.

## 5. Freeze

Freeze is on every authenticated screen, in the sticky header, right-aligned.

- **Resting:** a fully-rounded outlined control. `deny` text and icon, `deny` border at 40% alpha,
  transparent fill. Calm. It does not compete with the accent.
- **Hover/focus:** border to full `deny`, fill `deny` at 12%.
- **Pressed:** opens the freeze modal, never acts directly.
- **In the modal:** the confirm control is filled `deny-fill` with white text (4.83:1 dark,
  5.68:1 light). It is the only filled red in the product.
- **When frozen:** the header control becomes a filled `deny-fill` chip reading "Frozen", a
  persistent banner sits under the header, and the balance card's action row is disabled with the
  reason inline. `aria-live="assertive"` announces the state change.
- Freeze never calls the reasoning layer, so it never shows a loading state longer than the
  round-trip to our own API.

---

## 6. Space, radius, elevation

Spacing scale: `4 8 12 16 20 24 32 40 48 64`. Side gutter is **16** at every width. Row pitch 52.
Section gap 32.

| Radius | px | Applied to |
|---|---|---|
| `pill` | 999 | buttons, chips, toggles, segmented controls, action circles, avatars |
| `xl` | 28 | bottom-sheet top corners |
| `lg` | 24 | balance card, modals, hero cards |
| `md` | 20 | list-row pressed fill, inputs, popovers, mini stat cards |
| `sm` | 12 | icon chips inside rows, inline code |

Concentric rule: a child inside a padded container gets `parent radius - padding`. A 24px card with
16px padding holds 8px children; do not nest two 24s.

Elevation is **surface colour, not shadow**. `ground → surface → surface-2 → surface-3` is the
entire ladder. The only shadows in the product: `e2` under a sheet or modal
(`0 -24px 48px -12px rgb(0 0 0 / .55)` dark, `/.18` light) and a 1px inset top highlight on glass.
No `shadow-md`, no coloured glows, no drop shadows on cards.

---

## 7. Motion

`--ease-enter: cubic-bezier(0.32, 0.72, 0, 1)` · `--ease-exit: cubic-bezier(0.4, 0, 1, 1)`.

| Thing | Duration | Motion |
|---|---|---|
| Press feedback | 120ms | `scale(0.97)` on the pressed element |
| Row hover/press fill | 160ms | background only |
| Sheet in | 320ms enter | `translateY(100%) → 0`, scrim fades |
| Modal in | 220ms enter | `scale(0.96) → 1` + scrim |
| Tab switch | 200ms | the accent indicator slides; content cross-fades |
| Loading | — | a 3px accent bar pinned to the top of the page, indeterminate |
| Agent running | 2.4s loop | the status pill's dot breathes 1 → 0.35 opacity |

Nothing else moves. No scroll-hijack, no parallax, no marquee, no entrance staggers on a treasury
dashboard. Everything animates `transform` / `opacity` only. All of it collapses under
`prefers-reduced-motion: reduce`; the breathing dot becomes static.

---

## 8. Glass policy

Glass is a material for things that float over content. It is not a decoration.

**Allowed, and nowhere else:**
1. the sticky header (56px),
2. the balance card,
3. sheets and modals — approval, freeze, add-recipient, confirmations,
4. toasts.

**Always solid:** the timeline, policy sentences, rule tables, every form and input, settings rows,
positions list, the tab bar, empty and error states. If a user has to read a number off it, it is
opaque.

Construction: `background: color-mix(in srgb, var(--surface) 72%, transparent)` +
`backdrop-filter: blur(20px) saturate(160%)` + a 1px `inset 0 1px 0 rgb(255 255 255 / .06)` top
highlight for edge refraction. Sheets use 76% / 28px.

**Three fallbacks, in this order** (all already in `globals.css`):
`@supports (backdrop-filter: blur(1px))` gates the whole effect on;
`@media (prefers-reduced-transparency: reduce)` returns every glass surface to opaque `surface`;
`@media (forced-colors: active)` does the same and drops the accent wash.
The contrast table in §12 is computed against the **opaque** value, so the floor holds in all four
cases.

---

## 9. Component inventory

Each entry: anatomy, then states.

| Component | Anatomy | States |
|---|---|---|
| `AppHeader` | 56px, glass, sticky. Avatar-or-mark left · `StatusPill` centre · `FreezeButton` right. | default · frozen · degraded |
| `BalanceCard` | 24r glass card, 140px. Eyebrow `TREASURY` · balance with dimmed minor units · delta line · `AllowanceMeter` at the foot. | loading (skeleton) · stale (muted + "as of") · frozen (dimmed) · demo (banner above) |
| `ActionRow` | 4 circular 34px `surface-3` buttons + 15/600 labels: Approvals · Recipients · Activity · Add funds. | default · badge count on Approvals · disabled-with-reason when frozen |
| `AllowanceMeter` | The limit line. Track `line`, fill `accent`, recessed `ground` beyond, 2px `ink` rule at the cap. Caption: `2,400 USDC of 10,000 used today`. | under · near cap (fill `escalate`) · at cap (fill `deny`, caption explains) |
| `StatusPill` | Pill, `surface-2`, 8px dot + label. Dot breathes only while running. | idle · running · escalating · frozen · degraded |
| `FreezeButton` | Outlined pill, `deny`. | resting · hover · pressed · frozen |
| `ListRow` | 52px pitch, full-bleed. 24px glyph · 17/600 primary + 15/400 muted secondary · right slot (amount, verdict, chevron, toggle, external-link glyph). | default · pressed (`surface-3`, 20r) · selected · disabled |
| `VerdictBadge` | Glyph + word + colour, per §4. | allow · escalate · deny |
| `TimelineRow` | `ListRow` + timestamp in `mono faint` + `VerdictBadge`. Expands in place. | collapsed · expanded · pending · failed |
| `TimelineDetail` | Inside the expanded row, solid `surface-2`, 20r: the proposal sentence, the rule checks as a list of `VerdictBadge` + rule id + one line each, the simulation result, then the tx link in `mono`. | — |
| `ApprovalSheet` | Bottom sheet, 28r top, glass, grabber. Title · the **literal message to be signed** in `mono` on solid `surface-2` · recipient with full checksummed address · amount in the money rule · `AllowanceMeter` showing the effect · rule checks · Approve (accent) / Reject (ghost). | idle · submitting · expired · error |
| `FreezeModal` | Centre modal, 24r, glass, scrim. What freezing does, in three plain lines. Confirm = `deny-fill`, white. | idle · submitting · done |
| `AddRecipientSheet` | Bottom sheet. Label input · address input (`mono`, checksum echoed back character-grouped) · a warning that addresses are matched exactly · Add (accent). | idle · invalid · duplicate · submitting |
| `SegmentedControl` | Pill track `surface-2`, active segment `surface-3` pill, `ink` label. | — |
| `Chip` | Small pill. neutral `surface-2`/`muted` · tinted (`escalate` at 16% + `escalate` text). | — |
| `Toggle` | Pill track; on = `accent`, knob `#F5F8FF`. | on · off · disabled |
| `Input` | 20r, transparent fill, 1px `line` border, leading glyph, label **above**, error **below**. | rest · focus (2px accent ring, offset 2) · error · disabled |
| `PrimaryButton` | Fully-rounded pill, 56px, `accent` fill, `on-accent` label 17/700. Full-bleed at the foot of a full-screen state. | default · hover (`accent-press`) · pressed (`scale .97`) · disabled (`surface-2` + `muted`) · loading |
| `GhostButton` | Same shape, transparent, 1px `line-strong`, `ink` label. | — |
| `TabBar` | Mobile only. `surface`, 5 items: Home · Activity · Approvals · Recipients · Settings. Active = `ink` + a 3px `accent` bar above the item. | — |
| `StepProgress` | Thin segmented bars pinned to the top. Active `ink`, rest `surface-3`. | — |
| `EmptyState` | Centred flat two-tone glyph (our own, geometric, chamfered), h2 title, body `muted` max 46ch, one CTA. | — |
| `DemoBanner` | Full-width, `escalate` at 16%, `escalate` text, "DEMO DATA" in the `label` token. Never dismissible. | — |
| `Toast` | Glass pill, bottom, `aria-live="polite"`. | info · success · error |

### Copy voice

Sentence case. Plain verbs. "Steward" as the subject, never "the AI" or "the agent" in user-facing
copy. Amounts always as `10,000 USDC ($10,000)`. No exclamation marks. No "Oops". Say what happened
and what to do: *"Steward could not reach the vault. It retried twice and stopped. Nothing moved."*
Errors are inline and specific. No version stamps, no scroll cues, no locale strips, no
section-number eyebrows.

---

## 10. Layout

Mobile-first at **390px**. Column is 390 - 32 = 358.

Desktop is the same phone-width column, centred, max 440, on `ground`. Three screens earn a wider
two-column variant at `>= 1024px`, and only these three: the **timeline** (list left 440, detail
right, sticky), the **policy** view (sentences left, rule table right), the **approval queue**
(queue left, sheet content inlined right instead of as a sheet). Everything else stays 440 — a
treasury dashboard stretched to 1400px is a worse dashboard.

The mobile tab bar is replaced on desktop by a 56px left rail of the same five items.

### Mark and wordmark

"Steward" set in Figtree 700 at `-0.02em`. The mark is the **limit line**: a 2px `accent` rule under
the final three letters that stops short of the `d` — the fence that does not reach the end. No logo
file, no icon font, no gradient. Original to us, and deliberately nothing like a letterform mark.

---

## 11. Wireframes (S1-S11, 390px)

### S1 Landing `/`

```
+----------------------------------------+
|  Steward___                     Connect|  56 glass header
+----------------------------------------+
|                                        |
|   The self-driving treasury            |  h1 28/700, 2 lines max
|   that can't run off with              |
|   the money.                           |
|                                        |
|   Write the mandate in plain           |  body muted, <= 20 words
|   English. Steward keeps the rest.     |
|                                        |
|   [ Connect wallet ]                   |  PrimaryButton, accent
|   Read how the fence works             |  text link, info
|                                        |
+----------------------------------------+
|  +----------------------------------+  |
|  | TREASURY                         |  |  a live-looking BalanceCard
|  | $12,480.00                       |  |  as the hero visual (mock,
|  | [====|-------]  limit line       |  |  labelled "example")
|  +----------------------------------+  |
+----------------------------------------+
|  (o) Reasoning proposes                |  three ListRows, no cards
|  (o) The policy engine disposes        |
|  (o) A spend permission caps it        |
+----------------------------------------+
```

### S2 Connect `/connect`

```
+----------------------------------------+
|  X                                     |
|                                        |
|              [ glyph ]                 |  flat two-tone, chamfered
|                                        |
|        Connect your wallet             |  h2, centred
|   Steward never holds your keys. You   |  small muted, centred, 46ch
|   grant a capped spend permission and  |
|   you can revoke it at any time.       |
|                                        |
|  (o) Base Sepolia only        [chip]   |  ListRow, chip = "TESTNET"
|  (o) Read-only until you sign          |
|                                        |
+----------------------------------------+
|  [    Connect wallet    ]              |  full-bleed PrimaryButton
|  By connecting you agree to the Terms. |  small faint
+----------------------------------------+
```

### S3 Onboarding `/onboarding` (5 steps)

```
 ====  ----  ----  ----  ----            StepProgress, active = ink
+----------------------------------------+
|  <-                        Step 2 of 5 |  faint, mono
|                                        |
|   What should Steward do               |  h1
|   with idle USDC?                      |
|                                        |
|  +----------------------------------+  |
|  | Keep 20,000 USDC liquid. Put     |  |  textarea, 20r, solid
|  | the rest in Aave. Pay the        |  |  surface-2, mono 13
|  | contractors every Friday.        |  |
|  +----------------------------------+  |
|  Plain English. Steward compiles it    |  small muted
|  into a policy you approve next.       |
+----------------------------------------+
|  [       Continue       ]              |
+----------------------------------------+
```

Step 4 is the compiled policy, shown as numbered plain sentences on solid `surface-2`, each with the
rule id in `mono faint` on the right. Step 5 is the spend permission, shown as an `AllowanceMeter`
at its proposed cap plus the literal message to sign.

### S4 Dashboard `/app` — the primary screen

```
+----------------------------------------+
|  (S)      * Running        [ Freeze ]  |  glass header; dot breathes
+----------------------------------------+
|  ! DEMO DATA                           |  DemoBanner (only if on)
+----------------------------------------+
|  +----------------------------------+  |
|  | TREASURY                     ... |  |  glass card, 24r
|  |                                  |  |
|  | $12,480.00                       |  |  44/700, .00 dimmed
|  | +$38.20 today   4.1% APY         |  |  small; delta in allow
|  |                                  |  |
|  | [=====|---------]                |  |  AllowanceMeter
|  | 2,400 USDC of 10,000 used today  |  |  label, faint
|  +----------------------------------+  |
+----------------------------------------+
|   (!)      (:)      (~)      (+)       |  34px circles, surface-3
| Approvals Recipients Activity Add funds|  15/600, badge on Approvals
+----------------------------------------+
|  POSITIONS                             |  label eyebrow
|  (o) Aave USDC          8,100 USDC     |  ListRow, amount tabular
|      4.12% APY            ($8,100)     |
|  (o) Idle in treasury   4,380 USDC     |
|      not earning          ($4,380)     |
+----------------------------------------+
|  RECENT                                |
|  (o) Paid Mara Okonjo   1,200 USDC     |
|      2h ago  (v) Allowed               |  VerdictBadge
|  (o) Deposit to Aave    3,000 USDC     |
|      6h ago  (v) Allowed               |
|  (o) Pay unknown addr        blocked   |
|      9h ago  (x) Denied  R-04          |
|                          View all >    |
+----------------------------------------+
| Home  Activity  Approvals  Recip  Set  |  TabBar, accent bar above
+----------------------------------------+
```

### S5 Timeline `/app/activity`

```
+----------------------------------------+
|  <-        Activity             [Freeze]|
+----------------------------------------+
|  [ All | Allowed | Needs you | Denied ] |  SegmentedControl
+----------------------------------------+
|  (o) Paid Mara Okonjo   1,200 USDC  v   |  collapsed row
|      14:22  (v) Allowed                 |
|  ....................................   |
|  (o) Deposit to Aave    3,000 USDC  ^   |  EXPANDED
|      09:04  (v) Allowed                 |
|  +----------------------------------+   |
|  | Steward proposed moving 3,000    |   |  solid surface-2, 20r
|  | USDC ($3,000) into Aave USDC.    |   |
|  |                                  |   |
|  | (v) R-01 daily cap    2.4k/10k   |   |  each check: badge + id
|  | (v) R-03 allowlist    exact match|   |  + one plain line
|  | (v) R-07 depeg guard  1.0000     |   |
|  | (v) Simulation        no revert  |   |
|  |                                  |   |
|  | tx 0x9f3c...a21b            [->] |   |  mono, external link
|  +----------------------------------+   |
|  ....................................   |
|  (o) Pay 0x7ac1...  blocked             |
|      08:51  (x) Denied                  |
+----------------------------------------+
```

Desktop `>= 1024`: list left at 440, the detail pane sticky on the right.

### S6 Approvals `/app/approvals` + sheet

```
+----------------------------------------+        sheet over the queue:
|  <-       Approvals   2      [Freeze]  |     +------------------------+
+----------------------------------------+     |          ---          |  grabber
|  (!) Pay Devon Achebe   4,000 USDC     |     | Approve this payment  |  h2
|      over the 2,500 cap  (!) Needs you |     |                       |
|  (!) New recipient      (!) Needs you  |     | To   Devon Achebe     |
|      0x4b2e...9f10                     |     |      0x4b2e ... 9f10  |  mono, grouped
+----------------------------------------+     | Amount 4,000 USDC     |
|            (empty variant)             |     |        ($4,000)       |
|              [ glyph ]                 |     |                       |
|        Nothing needs you               |     | [====|====----]       |  meter, after
|  Steward is inside every limit you     |     | Would use 6,400 of    |
|  set. It will ask before it isn't.     |     | 10,000 today          |
+----------------------------------------+     |                       |
                                               | You will sign:        |  label
                                               | +-------------------+ |
                                               | | Steward: approve  | |  mono on
                                               | | payment 4000 USDC | |  surface-2
                                               | | to 0x4b2e...9f10  | |
                                               | | nonce 84 exp 15m  | |
                                               | +-------------------+ |
                                               |                       |
                                               | (!) R-02 over cap     |  the failing
                                               | (v) R-03 allowlisted  |  check first
                                               |                       |
                                               | [   Approve   ]       |  accent
                                               | [    Reject    ]      |  ghost
                                               +------------------------+
```

### S7 Policy `/app/policy`

```
+----------------------------------------+
|  <-         Policy            [Freeze] |
+----------------------------------------+
|  Your mandate, compiled                |  h2
|                                        |
|  1. Keep at least 4,000 USDC   R-06    |  numbered sentences, solid
|     liquid in the treasury.            |  surface-2, rule id mono
|  2. Move no more than 10,000   R-01    |  faint, right
|     USDC in any 24 hours.              |
|  3. Pay only the 4 recipients  R-03    |
|     on your list.                      |
|  4. Exit any vault if USDC     R-07    |
|     moves 0.5% off a dollar.           |
|                                        |
|  [ Edit mandate ]                      |  ghost
+----------------------------------------+
```

Desktop `>= 1024`: sentences left, the full rule table right.

### S8 Recipients `/app/recipients`

```
+----------------------------------------+
|  <-       Recipients             +     |
+----------------------------------------+
|  ( Search                          )   |  Input, 20r
+----------------------------------------+
|  ALLOWLIST                             |  label
|  (MO) Mara Okonjo        1,200 USDC    |  avatar pill, initials
|       0x1d4f...c802      paid Fri      |
|  (DA) Devon Achebe       4,000 USDC    |
|       0x4b2e...9f10      pending       |
+----------------------------------------+
        sheet: Add recipient
        Label  ( Mara Okonjo            )
        Address( 0x1d4f 2a99 ... c802   )  mono, 4-char groups
        (!) Steward matches this address exactly.
            No ENS, no lookalikes. Check it.
        [        Add recipient         ]
```

### S9 Freeze (modal, global)

```
        +--------------------------------+
        |  Freeze Steward                |  h2
        |                                |
        |  Steward stops proposing and   |  body
        |  stops executing, right now.   |
        |  Your spend permission is      |
        |  revoked on-chain.             |
        |  Nothing in the treasury moves |
        |  until you unfreeze.           |
        |                                |
        |  [     Freeze now      ]       |  deny-fill, white
        |  [        Cancel        ]      |  ghost
        +--------------------------------+
```

### S10 Settings `/app/settings`

```
+----------------------------------------+
|  (S)          Settings                 |
+----------------------------------------+
|  (o) Mandate                       >   |  ListRow, no cards
|      Edit what Steward may do          |
|  (o) Spend permission              >   |
|      10,000 USDC per day               |
|  (o) Recipients                    >   |
|      4 allowlisted addresses           |
|  (o) Notifications                 >   |
|      Tell me when Steward needs me     |
|  (o) Export audit log              >   |  replaces "Private key"
|      Download every decision as JSON   |
|  (o) Verify audit chain            >   |
|      Check the log has not been edited |
|  (o) Network                  [chip]   |  chip: "BASE SEPOLIA"
|  (o) Revoke permission             >   |  deny glyph + deny label
|      Steward can no longer spend       |
|  (o) Close account                 >   |  deny glyph + deny label
+----------------------------------------+
|  Steward runs on Base Sepolia.         |  faint, centred
+----------------------------------------+
```

Steward never displays a private key or a recovery phrase — it does not hold them. The reference's
"Export private key" row is replaced by **Export audit log** and **Verify audit chain**, which are
the equivalent "prove it is yours" affordances for this product.

### S11 Account closure `/app/close`

```
+----------------------------------------+
|  <-       Close account                |
+----------------------------------------+
|  Four things happen, in order:         |  h2
|                                        |
|  (o) 1. Steward freezes                |  checklist rows; each turns
|  (o) 2. The spend permission is        |  into an allow badge as it
|        revoked on-chain                |  completes
|  (o) 3. Everything sweeps home to      |
|        your wallet                     |
|  (o) 4. The audit log is exported      |
|                                        |
|  Your funds never leave your wallet's  |  small muted
|  control. This does not delete the     |
|  audit log - you keep a copy.          |
+----------------------------------------+
|  [    Start closing    ]               |  deny-fill
+----------------------------------------+
```

### Global states

| State | Treatment |
|---|---|
| Loading | 3px accent bar at the top of the page + skeletons shaped like the final rows. Never a spinner. |
| Empty | `EmptyState`: our own flat chamfered glyph, h2, one line of body, one CTA. |
| Error | Solid `surface-2` panel, `deny` glyph, what failed and what did not move, a Retry ghost button. Never a toast for a persistent error. |
| Stale | Data stays visible at `muted`, with `as of 14:02` in `mono faint` and a Refresh affordance. Never blank the screen. |
| Degraded | `StatusPill` reads "Degraded", a banner names the subsystem ("SERV is unreachable. Steward is not proposing. Freeze still works."). |
| Frozen | Header chip `deny-fill`, persistent banner, action row disabled with reason, balance card dimmed to 60%. |
| Parked | A position that could not be exited shows a `escalate` chip "Parked" and the reason, with the retry time. |

---

## 12. Accessibility floor

Non-negotiable. A phase does not pass if any of these regress.

- **Targets** 44x44 minimum, including the action-row circles (34px glyph inside a 44px hit area)
  and the tab bar items.
- **Focus** never removed. 2px `accent` outline at 2px offset in dark; 2px `accent-ink` in light.
  Focus order follows DOM order. Sheets and modals trap focus and restore it on close.
- **Keyboard path for the two acts that matter:** `Tab` to the Approvals action, `Enter`, `Tab` to
  Approve, `Enter`. And from anywhere: `Tab` to Freeze in the header (it is the last header item and
  the first in the tab order after the skip link), `Enter`, `Tab` to Freeze now, `Enter`. Both paths
  are tested in `pnpm test:e2e`.
- **Skip link** to `#main` as the first focusable element.
- **`aria-live`:** `polite` on the status pill and toasts; `assertive` on freeze confirmation and on
  any verdict change that needs the owner.
- **Verdicts carry text.** Every `VerdictBadge` renders its word visibly, not as a `title`.
- **Addresses** are announced in 4-character groups via `aria-label`, and are never truncated in the
  accessible name.
- **Contrast:** every text/surface pair below, computed, in both themes, over glass at its opaque
  fallback value (the worst case for glass is the opaque surface, which is what we measure).

### Contrast table — dark (default)

| Pair | fg | bg | ratio | |
|---|---|---|---|---|
| body text on ground | `#FFFFFF` | `#090C11` | 19.58 | AAA |
| body text on surface | `#FFFFFF` | `#111419` | 18.45 | AAA |
| body text on surface-2 | `#FFFFFF` | `#1B1E23` | 16.71 | AAA |
| body text on surface-3 | `#FFFFFF` | `#24272F` | 14.93 | AAA |
| body text on glass | `#FFFFFF` | `#1A1F27` | 16.55 | AAA |
| muted on ground | `#B3B6BE` | `#090C11` | 9.65 | AAA |
| muted on surface-2 | `#B3B6BE` | `#1B1E23` | 8.24 | AAA |
| muted on surface-3 | `#B3B6BE` | `#24272F` | 7.36 | AAA |
| muted on glass | `#B3B6BE` | `#1A1F27` | 8.16 | AAA |
| faint label on ground | `#7E838D` | `#090C11` | 5.15 | AA |
| faint label on surface-2 | `#7E838D` | `#1B1E23` | 4.39 | AA large / UI |
| accent text on ground | `#AEF07A` | `#090C11` | 14.50 | AAA |
| accent text on surface-2 | `#AEF07A` | `#1B1E23` | 12.37 | AAA |
| accent text on glass | `#AEF07A` | `#1A1F27` | 12.25 | AAA |
| on-accent on accent | `#0B120B` | `#AEF07A` | 14.06 | AAA |
| on-accent on accent-press | `#0B120B` | `#98DE5F` | 11.71 | AAA |
| allow on ground | `#2FD9A6` | `#090C11` | 10.81 | AAA |
| allow on surface-2 | `#2FD9A6` | `#1B1E23` | 9.23 | AAA |
| allow on glass | `#2FD9A6` | `#1A1F27` | 9.14 | AAA |
| escalate on ground | `#FFB020` | `#090C11` | 10.71 | AAA |
| escalate on surface-2 | `#FFB020` | `#1B1E23` | 9.14 | AAA |
| escalate on glass | `#FFB020` | `#1A1F27` | 9.05 | AAA |
| deny on ground | `#FF6A5E` | `#090C11` | 6.97 | AAA |
| deny on surface-2 | `#FF6A5E` | `#1B1E23` | 5.95 | AA |
| deny on glass | `#FF6A5E` | `#1A1F27` | 5.89 | AA |
| white on deny-fill | `#FFFFFF` | `#D92D1E` | 4.83 | AA |
| line-strong on ground (UI) | `#5A616B` | `#090C11` | 3.13 | AA UI |

### Contrast table — light (alternate)

| Pair | fg | bg | ratio | |
|---|---|---|---|---|
| body text on ground | `#0B0F16` | `#F4F6FA` | 17.74 | AAA |
| body text on surface | `#0B0F16` | `#FFFFFF` | 19.19 | AAA |
| body text on surface-2 | `#0B0F16` | `#EEF1F6` | 16.95 | AAA |
| body text on surface-3 | `#0B0F16` | `#E4E8EF` | 15.62 | AAA |
| body text on glass | `#0B0F16` | `#F0F3F8` | 17.26 | AAA |
| muted on ground | `#525A68` | `#F4F6FA` | 6.42 | AAA |
| muted on surface-2 | `#525A68` | `#EEF1F6` | 6.14 | AAA |
| muted on surface-3 | `#525A68` | `#E4E8EF` | 5.66 | AA |
| muted on glass | `#525A68` | `#F0F3F8` | 6.25 | AAA |
| faint label on surface | `#6E7684` | `#FFFFFF` | 4.58 | AA |
| faint label on ground | `#6E7684` | `#F4F6FA` | 4.23 | AA large / UI |
| accent-ink text on ground | `#3F6B1A` | `#F4F6FA` | 5.83 | AA |
| accent-ink text on surface | `#3F6B1A` | `#FFFFFF` | 6.31 | AAA |
| on-accent on accent | `#0B120B` | `#AEF07A` | 14.06 | AAA |
| allow on ground | `#067A59` | `#F4F6FA` | 4.93 | AA |
| allow on surface-2 | `#067A59` | `#EEF1F6` | 4.71 | AA |
| escalate on ground | `#8A5300` | `#F4F6FA` | 5.85 | AAA |
| escalate on surface-2 | `#8A5300` | `#EEF1F6` | 5.59 | AA |
| deny on ground | `#C42A1B` | `#F4F6FA` | 5.25 | AA |
| deny on surface-2 | `#C42A1B` | `#EEF1F6` | 5.02 | AA |
| white on deny-fill | `#FFFFFF` | `#C42A1B` | 5.68 | AA |
| line-strong on ground (UI) | `#5A6270` | `#F4F6FA` | 5.68 | AA UI |

**In light theme the raw accent `#AEF07A` is 1.25:1 on ground — it is a fill only, never a text or
icon colour.** Accent-coloured text in light uses `accent-ink`. This is enforced by the token names.

---

## 13. Reference flow → Steward screen mapping

| Reference flow | Steward screen | Note |
|---|---|---|
| Home | **S4 dashboard** | Balance card = treasury USDC. Action row is **ours**: Approvals / Recipients / Activity / Add funds. **Not** Send/Swap/Buy — the agent moves money, the owner does not make free-form transfers. |
| Wallet | **S4 positions list** | Vault positions instead of token balances. |
| Activity details | **S5 timeline detail** | Rule checks, simulation, tx link. |
| Stats | **S4 widgets** | The allowance meter and the APY/delta line. No trading charts. |
| Send Coins | **S6 approval sheet** + **S8 add recipient** | The "to / amount / confirm" anatomy becomes the approval sheet with the literal message to sign. |
| Stake Coins | **S4 position row → read-only explainer** | What Steward does with idle USDC, and the APY. No user-initiated staking. |
| Authentication, Verify, Onboarding, Waitlist, Add wallet | **S2 connect** + **S3 wizard** | Step-progress bars, centred glyph + title + body, bottom-pinned CTA. |
| Settings, Notification settings, Privacy settings, Reset password, Logout | **S10 settings** | Flat rows, no cards, pressed fill, destructive rows in `deny`. |
| Private Key | **S10 → Export audit log / Verify audit chain** | Steward never shows keys; it does not hold them. |
| Delete Wallet | **S11 account closure** | A four-step checklist, not a confirm-and-vanish. |
| Qr code, Scan qr | **Fund treasury** (sheet off "Add funds") | QR of the treasury address + copy-address, in `mono`, 4-char groups. |
| Explore Market | *not used* | Steward has no discovery surface. Out of `PRD.md` scope. |
| Swap Coins | *not used* | No user-initiated swaps. The agent does not swap; it deposits and withdraws. |
| Buy coins | *not used* | No fiat on-ramp in scope. |
| Create card | *not used* | No card product. |
| Stories | *not used* | No promotional surface. Its step-progress bars were taken for S3. |
| Edit and Customize Background | *not used* | No personalisation in MVP. The balance card's "carries an image" capability was noted but is not built. |

Nothing above invents a feature that is not already in `docs/PRD.md`.

---

## 14. Handover rules for Phase 7 engineers

1. Read tokens from `apps/web/app/globals.css`. Never write a hex literal in a component.
2. The static preview at `/preview` is the reference implementation of every component in §9. If a
   real screen disagrees with it, the preview is right.
3. `pnpm check:arch` must stay green: the design layer imports nothing from `wallet`, `reasoning`,
   or the policy executor.
4. New dependency? One-line justification in `PROGRESS.md` → Decisions first.
5. Any change to §2 (palette), §4 (verdict separation), §8 (glass) or §12 (a11y floor) needs the
   contrast table recomputed and this file updated in the same commit.
