# Visual reference notes — sampled 2026-09-21

Sampled live with the browser's computed styles (not eyeballed). Third-party marketing imagery is
**not** committed to this repo (see `.gitignore` in this folder); what is captured here is the
measurable design language, which is what the design pass actually needs.

## Solflare (solflare.com) — the brief's primary inspiration

| Axis | Observed |
|---|---|
| Ground | `#02050A` — near-black with a **blue** cast, not a warm or neutral black. Panels `#14161B`, `#24262B`. |
| Text | `#F5F8FF` (blue-cast off-white), muted `#898A93`, border `#45474D` |
| Accent | `#FFEF46` / `#EEDA0F` — one high-chroma yellow, black text on it, used only for the single primary CTA |
| Type | FK Grotesk (commercial) 400/500/600/700 + FK Grotesk Mono for micro labels |
| Display | 36px/700, tracking `-0.36px` (≈ -0.01em), line-height 1.0 — **tight, no tracking-out** |
| Body | 14–21px, line-height 1.3–1.7 |
| Radii | pill `100px` on buttons, `20–24px` on cards, `12px` mid, `6–8px` small |
| Marketing | Loud full-bleed colour-block sections (magenta / periwinkle / violet). Not applicable to us. |
| **App UI** (phone mockups) | Where the real value is: small label → **giant balance with dimmed minor units** (`$6,969` bright + `.00` dim) → green delta line → equal-weight pill action row → token rows (icon + name/sub left, amount/% right). |

## Coinbase Wallet (wallet.coinbase.com) — contrast point

Ground `#0A0F15`, panel `#0F1927`, border `#1C3558`, accents cyan `#00E2FF` and Coinbase blue
`#0052FF`. CoinbaseSans, display 67px/700 at `-1px`. Same family of choices as Solflare (blue-black +
one bright accent), which is exactly why we must not land on blue-black + cyan.

## Rainbow (rainbow.me) — contrast point

Pure black, centred balance, **circular** icon action row under the balance, dense token list rows.
Confirms the grammar below is a convention, not one company's idea.

## The wallet grammar all three share (this is what we inherit)

1. Small quiet label → very large balance → delta/secondary line.
2. An immediate row of 3–5 **equal-weight** actions directly beneath the balance.
3. Everything else is a **list of rows**: glyph + primary/secondary text left, tabular figure right.
4. One accent. Pill radii on controls, generous radii on cards, hairlines between rows.
5. Very little chrome — no eyebrows, no decorative cards, no gradients behind text.

## What we deliberately do NOT take

Solflare's yellow, its typeface, its mark, its illustrations, its marketing colour blocks, its
tracked-out ALL-CAPS micro labels, and its layouts. We take hierarchy and rhythm only.

---

# v2 — measured from the client's own reference screenshots (2026-09-22)

26 PNG screenshots of the **Solflare mobile app** (828×1792, iPhone-class, all dark) were supplied in
`docs/design/Photos/`. That folder is **git-ignored** — third-party marketing/app art is never
committed. Everything below was measured with a pixel script (Pillow), not eyeballed.

## Measured palette (occurrence-weighted across all 26 frames)

| Role | Hex | Share | Where it appears |
|---|---|---|---|
| Ground | `#090C11` | 52.8% | every screen background |
| Surface 1 | `#111419` | 7.5% | tab bar, bottom sheet, popover panel |
| Surface 2 | `#1B1E23` | — | token-select pills, disabled buttons, icon chips, dropdown divider `#23262B` |
| Surface 3 | `#24272F` | 5.8% | **pressed/hover** list row, circular action button |
| Hairline | `#2A2D31` | 0.5% | input borders, section rules, dimmed minor units |
| Text | `#FFFFFF` / `#F5F8FF` | 0.3% | titles, row primaries, toggle knob |
| Muted text | `#B3B6BE` | — | row subtitles, placeholders, inactive tab labels |
| **Accent (yellow)** | **`#FFEF46`** → `#EDD90F` | 0.52% | *see role table below* |
| Positive | `#30CF57` / `#2CB04D` | — | up-delta, OS pill |
| Negative | `#FF4132` | — | down-delta, destructive label + icon |
| Warning | `#FF873E`, chip `#FFB800` | — | countdown chips |
| Brand-secondary | `#3D38C0` | — | the AI FAB (a second brand colour, not a semantic) |
| Tinted hero | `#153B1D` | — | a single dark-green promo card |

## Every place the yellow `#FFEF46` is used (the full role list we must replace)

1. Primary CTA — pill, full-bleed bottom bar or inline; **near-black ink** on it, never white.
2. Bottom-tab **active indicator** — a 3px bar *above* the active tab (not under the label).
3. Underline tab sets (`Featured / Earn / …`) — 3px underline on the active tab.
4. Toggle **on** track (with a white `#F5F8FF` knob).
5. The unread dot on the header card icon.
6. Top-of-page **loading progress bar** (thin, 3px, accent).
7. Brand mark on the splash screen.
8. The FAB glyph (on the violet disc).

That is the entire list. Yellow is never a status colour, never body text, never a surface tint.

## Measured geometry & type

| Axis | Measured (÷3 → pt) |
|---|---|
| Side gutter | 40px → **13–16pt** (we use 16) |
| Balance card | radius 72px → **24pt**; height ~140pt; subtle dot-matrix texture; can carry a user image, text flips to dark ink |
| Balance number | ~84px → **44–48pt / 700**, tight tracking, **minor units dimmed to `#2A2D31`-grey** |
| Eyebrow label | ~30px → 11pt, **uppercase, ~0.12em tracking**, muted |
| Action row | 5 circles, ⌀100px → **34pt**, fill `#24272F`, 22pt glyph, label 15pt/600 below |
| List row | pitch ~146px → **48–52pt**; icon 24pt; title 17/600; sub 15/400 muted; chevron right |
| Pressed row | filled `#24272F` rounded rect, radius 60px → **20pt**, full-bleed to gutter |
| Bottom sheet | top radius 84px → **28pt**, grabber 40×4pt `#7E838D` |
| Popover / menu | radius 60px → 20pt, surface `#111419`, hairline divider, destructive item in red text |
| Primary button | **fully rounded pill**, height ~64pt, label 17/700 |
| Disabled button | fill `#1B1E23`, label muted — same shape |
| Input / search | radius 20pt, transparent fill, 1px `#2A2D31` border, leading glyph |
| Segmented control | track `#23262B` pill, active segment `#2D2F34` pill, white label |
| Chip | small pill; neutral = `#23262B` + `#B3B6BE`; timed = amber tint + amber text |
| Tab bar | surface `#111419`, 5 items, icon 24 + label 13; active white + accent bar **above** |
| Step progress | thin segmented bars pinned to the very top; active white, rest `#24272F` |
| Icons | solid/filled monoline, ~2px stroke, squared-off geometric, **not** rounded-cute |

## Type identity

Solflare ships **FK Grotesk** (commercial). Observed traits in the app: tall x-height, single-storey
`g`, geometric-humanist grotesk, lining figures, tight display tracking. Our free/OFL substitute is
recorded in `docs/PROGRESS.md` → Decisions.

## Legal / brand boundary

We replicate **layout patterns, proportions, hierarchy, radii, spacing and surface treatment** only.
We do **not** use Solflare's name, wordmark, blackletter `S` mark, mascot/skeleton artwork, card
renders, photography, copy, or any image asset. Steward ships its own mark and wordmark, its own
accent, and its own information.
