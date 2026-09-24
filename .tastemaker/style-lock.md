# Steward — style lock

Recorded retroactively from the existing, already-shipped design (landing page + `/app`), not
generated fresh. Reuse these exact tokens for every new screen/component — do not re-derive.

## Origin

Structure, animation and copy rhythm ported from a Tailwind-CDN wallet marketing reference
(`docs/design/refs/code.html`, "Solflare"-branded) with content swapped to Steward; the rest of
the app (`/app`, `/connect`, onboarding) was re-themed to match. Not palette-generated from a
mood keyword — extracted from the reference and then carried through the whole app by hand.

## Color contract

Light mode (`--st-ground: #ffffff`, default):

| role                    | hex                          |
| ----------------------- | ---------------------------- |
| text / ink              | `#0a0a0a`                    |
| bg / ground             | `#ffffff`                    |
| surface                 | `#e8e8ea`                    |
| primary / accent        | `#fce300` (press: `#e5ce00`) |
| on-primary / accent-ink | `#0a0a0a`                    |
| border                  | `#d0d0d5`                    |
| allow                   | `#067a59`                    |
| escalate                | `#8a5300`                    |
| deny                    | `#c42a1b`                    |

Dark mode (`prefers-color-scheme: dark` or `data-theme="dark"`): ground/ink invert
(`#000000`/`#ffffff`), surfaces step up (`#1c1c1e`/`#2c2c2e`/`#3a3a3c`), accent stays `#fce300`
but **on-primary/accent-ink becomes the yellow itself** (`#fce300`), not black — yellow text
reads fine on the black background there, but is illegal on white. This asymmetry is
intentional, verified via `check_contrast.py`, and must not be "simplified" to one value.

Verified matrix (light mode, `check_contrast.py --matrix`): `text/bg` 19.8, `text/accent` 15.2,
`accent/on-primary` 15.2 (button label) — all text-safe. `bg/accent` is only 1.30 — **yellow is
never legal as text or a ring color directly on white background**; that's why
`--color-ring` reads `--st-accent-ink` (black in light mode), not `--st-accent`, and why the
landing page's own black-background sections use the raw yellow for links/text instead.

Verdict colors (`--st-allow` / `--st-escalate` / `--st-deny`) are a **hard exception** to the
single-accent rule — always paired with an icon + word, never color alone (SECURITY posture,
not a style choice — see `docs/DESIGN.md` §4/§12). Never repurposed for anything else.

## Typography

Body: Plus Jakarta Sans (`next/font/google`, var `--font-jakarta`) → `--font-sans`.
Data/mono contexts (balances, addresses, timestamps): existing `font-mono` utility class,
unchanged.

## Density & spacing

Cards: `rounded-[28px]` outer shell (matches `ProgressMetricCard`/landing device-mockup
radius), `border border-border`, minimum `px-6 py-3`+ internal padding — never tighter than the
gap to a neighboring card. Landing-page sections use generous, role-weighted padding (hero and
proof sections get materially more than connective ones); app-shell screens (`/app`,
`/connect`) stay denser since they're worked in repeatedly, not scrolled through once.

## Motion

- Landing page (marketing, scroll-once): CSS `transition` (not `transition-all`) on hover
  states — transform/shadow/color grouped under Tailwind's default `transition` class, which
  excludes layout properties. Scroll-reveal via `reveal-fade-up` + IntersectionObserver,
  `prefers-reduced-motion` gated. The balance/device mockup has a `st-land-float` breathing
  animation (5s ease-in-out, translateY ±10px), also reduced-motion-gated.
- App shell (`/app`, dashboard, connect): interaction-only motion — button press
  (`active:scale-[0.97]`, 150ms), sheet/panel transitions. No scroll-storytelling; nothing to
  scroll through.

## Assets

No sourced photography/illustrations — this is a data-density product (balances, allowance
meters, verdict badges), not an image-driven marketing product. Icons: `lucide-react`
throughout. Charts: `recharts` (landing's `ExampleYieldChart`, `/app`'s `ProgressMetricCard`
via `metric-chart.tsx`).

## Components sourced

`ProgressMetricCard` (`apps/web/components/ui/progress-metric-card.tsx`) + its two dependency
files (`metric-chart.tsx`, `metric-controls.tsx`) — ported near-verbatim from a pasted
21st.dev-style spec at the owner's explicit request, restyled to zero extra CSS because the
shadcn token bridge in `globals.css` (`bg-card`/`border-border`/`text-foreground`/
`text-muted-foreground`/`bg-muted`) already resolves to the tokens above.

## Dark mode

Runtime toggle exists (`prefers-color-scheme` + explicit `data-theme` override) — not a locked
single mode. Both palettes verified independently; see Color contract above.
