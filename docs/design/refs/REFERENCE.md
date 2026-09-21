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
