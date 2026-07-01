# Delphi — Style Reference (Kassandra UI visual language)

> warm parchment editorial with ember sparks · **Theme: light**

The Kassandra UI adopts this visual language. Delphi reads like an editorial spread on warm parchment: cream canvas, brown-black ink, a serif display voice, and orange sparks of energy. Quiet, literary surfaces, generous whitespace, chrome that feels printed rather than engineered. Color is used sparingly — the page stays achromatic-warm, with a single dark-chestnut button tone and a vivid ember orange reserved for trust signals, highlights, and conversational heat. Components are flat, low-elevation, thin hairlines and soft 12px corners rather than shadow stacks. A humanist serif at whisper-light weight for headlines, a workhorse sans for body.

> **Authoritative tokens = the CSS block below.** (The original guide's prose tables had OCR artifacts — the values here are corrected. Ignore any `--radius-full-2: 582px`-style noise.)

## Colors
| Token | Value | Role |
|-------|-------|------|
| `--color-parchment` | `#fdf6ee` | Page canvas, hero, card surfaces on light sections |
| `--color-soft-cream` | `#f0e6dc` | Nav background, secondary surface, hover zones |
| `--color-pure-card` | `#ffffff` | Foreground content cards, feature panels, floating hero cards |
| `--color-ink-black` | `#000000` | Nav text + icon strokes ONLY (never body on cream) |
| `--color-charcoal-bark` | `#21201c` | Body text where pure black reads too cold |
| `--color-sepia` | `#2b180a` | Headings, button text, emphasized inline — printed-ink brown |
| `--color-bronze` | `#7f6e60` | Muted secondary body, captions under headings |
| `--color-driftwood` | `#94877c` | Tertiary text, nav links, low-emphasis labels |
| `--color-stone` | `#a99d93` | Disabled / lowest-emphasis text, ghost icons |
| `--color-pebble` | `#d9cfc3` | Hairline borders, card edges, dividers |
| `--color-chestnut` | `#3e2407` | THE primary button fill (+ dark accent surfaces). Never a blue/green CTA. |
| `--color-ember-orange` | `#f65726` | Accent text, in-card highlights, conversational emphasis (sparingly) |
| `--color-saffron-pulse` | `#ff5c00` | Eyebrow tags + decorative accent (sparingly) |
| `--color-peach-glow` | `#fed0b3` | The bloom box-shadow behind the chestnut button |

## Typography
- **Display / headings:** Martina Plantijn Light (proprietary) → substitute **Cormorant Garamond** (weight **300** for the largest display; also Lora as alt). Serif ONLY for display ≥20px. Negative tracking tightens headlines (-0.022em at 40px, -0.03em at 64px).
- **Body / nav / UI:** **Inter** (400 body, 500 emphasized/nav), tracking ~-0.01em. Handles ALL copy < 20px.
- **Code accent:** **Roboto Mono** (400), used sparingly for trigger/condition syntax inside feature cards.

Type scale: caption 10 / body 15 (lh 1.32) / subheading 20 / heading-sm 24 / heading 40 (tracking -0.8px) / heading-lg 56 / display 64 (tracking -1.92px).

## Spacing & shape
- Base unit 4px; scale {4,8,12,16,20,24,32,48,64,80,96,120}. Density: compact.
- Radii vocabulary is SHORT — ONLY {4 (small), 8 (tags), 12 (buttons/cards), 16 (image cards), 70 (avatars)}px. No other radii.
- Layout: page max-width 1200px, section-gap 80px, card padding 20–24px, element gap 8–12px.

## Surfaces (flat elevation model)
0 Parchment `#fdf6ee` (page/hero/sections) · 1 Soft-cream `#f0e6dc` (nav, hover) · 2 Pure-card `#ffffff` (content cards) · 3 Chestnut `#3e2407` (primary button / dark accent).
Cards sit on the canvas with a 1px pebble border or none — NOT shadow depth. The ONLY shadows: the peach bloom behind the chestnut button, and the trust-portrait bottom gradient.

## Components
- **Primary Chestnut Button** — chestnut fill, white text, 12px radius, ~16px/10px padding, Inter 15/500; signature = a peach `#fed0b3` **bloom** box-shadow radiating behind it (warm glow, not a neutral drop shadow).
- **Ghost Outline Button** — transparent, 1px pebble/charcoal border, 12px radius, sepia Inter 15/500. No bg/shadow. Pairs with the primary.
- **Nav Pill** — soft-cream bg, sepia text, 12px radius, generous horizontal padding — a soft chip.
- **Floating Question Card** (hero signature) — white surface, 12px radius, hairline border, 12–16px padding: a 70px circular avatar, name+role (Inter 12–13px), and a one-sentence line (Inter 14px). Scattered around the headline as "orbiting voices" — replaces a hero illustration.
- **Avatar Bubble** — 70px circle image, no border; optional **Verified Dot** (cobalt-blue `~#1da1f2` circle + white check, lower-right) — the only true blue on the page.
- **Section Eyebrow Tag** — small saffron/pebble Inter ~12–13px label, centered above the heading, sometimes in a hairline pill.
- **Feature Side Card** — cream/off-white surface, 16px radius, 24–32px padding: Cormorant 24px heading, Inter 15px bronze body, optional nested preview sub-card.
- **Trigger Preview Card** — nested sub-card, 8–12px radius, white/cream fill: a "When" label (driftwood), a one-line condition (Inter 14px) with the variable value highlighted in **ember orange**, and a subdued "+ Add Action" row (stone).
- **Section Headline Block** — centered: eyebrow + a two-line Cormorant-300 display title (line 2 lighter/italic for two-tone contrast) + one Inter ~17px bronze paragraph, max-width ~640px.
- **Centered Portrait Panel** (trust centerpiece) — tall 16px-radius card, warm orange-red ambient / photographic portrait, white name+role overlay near the bottom, soft bottom fade merging into the parchment; flanked by two stacked feature cards.

## Do / Don't
**Do:** Cormorant-300 (-0.022em) for all display headlines; chestnut CTA with the peach bloom; parchment canvas (pure-card only for lifted cards); radii only {4,8,12,16,70}; ember/saffron as 1–2 punctuation moments per viewport; hero = scattered white question cards around a centered serif headline; each section = centered eyebrow + two-line serif headline + one short paragraph.
**Don't:** no blue/green/cool CTA (chestnut is the only fill); no heavy drop shadows (flat + hairlines); no serif for body <20px (Inter only); no pure black body on cream (sepia/charcoal-bark; black only for nav/icons); no gradients on cards/buttons (except the portrait panel + peach bloom); ≤2 text colors per block; no radii outside the scale.

## Layout / imagery
Max-width ~1200px centered on full-bleed parchment. Hero = constellation: centered serif headline in the middle, 8–10 small white cards scattered at varying sizes/positions (orbiting voices). Sections follow a rhythm: eyebrow → two-line serif headline → short paragraph → 2-col feature grid or 3-up card row. Trust section = 3-col grid flanking a tall centered portrait card (stacked feature cards left/right). Nav = minimal top bar (left links, centered wordmark, right actions). No sidebar / sticky header / mega-menu. Imagery is minimal social proof, not decoration — the people/voices are the visual content, not product UI.

## Authoritative CSS custom properties (corrected)
```css
:root {
  --color-parchment:#fdf6ee; --color-soft-cream:#f0e6dc; --color-pure-card:#ffffff;
  --color-ink-black:#000000; --color-charcoal-bark:#21201c; --color-sepia:#2b180a;
  --color-bronze:#7f6e60; --color-driftwood:#94877c; --color-stone:#a99d93;
  --color-pebble:#d9cfc3; --color-chestnut:#3e2407; --color-ember-orange:#f65726;
  --color-saffron-pulse:#ff5c00; --color-peach-glow:#fed0b3;

  --font-serif:'Cormorant Garamond', Lora, ui-serif, Georgia, serif;      /* display ≥20px, weight 300 */
  --font-inter:'Inter', ui-sans-serif, system-ui, sans-serif;             /* body/UI */
  --font-mono:'Roboto Mono', ui-monospace, Menlo, monospace;              /* code accents */

  --text-caption:10px;   --leading-caption:1.2;  --tracking-caption:-0.012px;
  --text-body:15px;      --leading-body:1.32;    --tracking-body:-0.015px;
  --text-subheading:20px;--leading-subheading:1.32;--tracking-subheading:-0.24px;
  --text-heading-sm:24px;--leading-heading-sm:1.22;--tracking-heading-sm:-0.312px;
  --text-heading:40px;   --leading-heading:1.2;  --tracking-heading:-0.8px;
  --text-heading-lg:56px;--leading-heading-lg:1;  --tracking-heading-lg:-1.232px;
  --text-display:64px;   --leading-display:1;     --tracking-display:-1.92px;

  --font-weight-light:300; --font-weight-regular:400; --font-weight-medium:500; --font-weight-bold:700;

  --spacing-4:4px; --spacing-8:8px; --spacing-12:12px; --spacing-16:16px; --spacing-20:20px;
  --spacing-24:24px; --spacing-32:32px; --spacing-48:48px; --spacing-64:64px; --spacing-80:80px;
  --spacing-96:96px; --spacing-120:120px;

  --radius-sm:4px; --radius-tag:8px; --radius-button:12px; --radius-card:16px; --radius-avatar:70px;

  --page-max-width:1200px; --section-gap:80px;
}
```

## Kassandra content adaptation
Keep the visual language EXACTLY; adapt the copy to Kassandra — a decentralized, AI-assisted **optimistic oracle** on Solana. Themes to weave: optimistic resolution (propose an answer + a challenge window); AI-assisted verdicts (an open-source runner reruns a pinned model over the agreed facts, all hashes committed on-chain); economic security (proposer/fact/vote bonds, staker settlement, slashing, dead-end burns); futarchy governance (MetaDAO) for parameters/treasury; challenge markets. The hero's floating cards become live-looking oracle questions + mini verdicts/proposer lines. Tagline direction: editorial, not hypey (e.g. "Truth, settled." / "An optimistic oracle with a mind.").
