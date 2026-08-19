# The signal is the proof. Not the screen — the pulse behind it. — Style Reference
> a heartbeat monitor for human thinking

**Theme:** light

ProblemProof operates as a clinical-modern instrument panel: cool porcelain surfaces, a single vivid cobalt-blue signal color, and a warm coral pulse that marks the moments cognition spikes. The governing idea is diagnostic, not decorative — a heart-rate monitor doesn't dress up its line with a gradient fill or a friendly illustration, because the honesty of the trace *is* the product. ProblemProof borrows that instrument logic: soft, glowing, precise UI on a light ground, with color reserved for signal, never for decoration. Typography pairs a genuinely uncommon display serif (Instrument Serif — idiosyncratic, ink-trap terminals, currently rare in product design) against a distinctive geometric grotesk (Space Grotesk) for everything functional, so the brand has one unmistakable "voice" moment and one hardworking, quietly unusual UI voice. The signature visual is the **Signal Trace** — a live gradient waveform (cobalt to coral) plotting a session's cognitive load in real time, rendered with soft glow rather than hard lines. Components favor generous rounding and soft, color-tinted shadows — elevation here means "glowing," not "stamped."

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Porcelain | `#F3F4F7` | `--color-porcelain` | Page canvas, section backgrounds — cool, light, faintly blue-grey; never pure white, never cream |
| Graphite Ink | `#14161A` | `--color-graphite-ink` | Primary text, headlines, high-contrast UI — the only near-black, cooler than a warm ink |
| Cognition Blue | `#3F4CE0` | `--color-cognition-blue` | Primary accent — buttons, links, the Signal Trace baseline, brand mark fill |
| Signal Coral | `#FF6A4D` | `--color-signal-coral` | Secondary accent — marks a spike, a highlight, a moment of peak cognitive load; used sparingly against blue |
| Verified Mint | `#14B888` | `--color-verified-mint` | Confirmed / validated states, success indicators |
| Flag Red | `#DC3D4A` | `--color-flag-red` | Disputed / flagged / error states — always shown immediately, never softened |
| Slate | `#5B6472` | `--color-slate` | Secondary text, captions, mono data, field labels |
| Card White | `#FFFFFF` | `--color-card-white` | Card, panel, and modal surfaces — sits one step brighter than Porcelain |

## Tokens — Typography

### Instrument Serif — Display and testimony. The single "voice" moment in the system: hero headlines, the word "Proof," pull quotes, and credential-issued confirmations. Idiosyncratic ink-trap terminals and an italic that actually looks handwritten rather than mechanically slanted — chosen specifically because it is uncommon in product UI, unlike the high-contrast serifs that have become an AI-generated-design tell. Used at large sizes only; never for UI chrome. · `--font-instrument-serif`
- **Substitute:** Playfair Display
- **Weights:** 400 (roman), 400 (italic — the only weight, used deliberately as the brand's single "voice")
- **Sizes:** 24, 32, 44, 60, 80px
- **Line height:** 0.98, 1.05, 1.1, 1.2
- **Letter spacing:** -0.02em at 80px, -0.01em at 44–60px, normal below
- **Role:** The one moment of personality — everything else in the system is quiet by comparison.

### Space Grotesk — Functional voice. Every heading that isn't hero-scale, all body copy, nav, buttons, and field values. Distinctive wide apertures and a slightly unusual "G," "S," and "4" give it real character at UI sizes without becoming a novelty face — a working alternative to defaulting to Inter. Variable weight axis lets thin UI text and heavier button labels come from one family. · `--font-space-grotesk`
- **Substitute:** Inter
- **Weights:** 300, 400, 500, 600, 700
- **Sizes:** 14, 15.5, 17, 19, 24, 28px
- **Line height:** 1.15 (headings), 1.5–1.6 (body)
- **Letter spacing:** -0.01em on headings 24px+, normal on body

### Space Mono — The data layer. Timestamps, hashes, credential IDs, status words, and axis labels on the Signal Trace. Shares its "Space" lineage with the grotesk, so numerals and letterforms feel like one coherent system rather than a bolted-on monospace. · `--font-space-mono`
- **Substitute:** JetBrains Mono
- **Weights:** 400, 700
- **Sizes:** 10, 11, 12, 14px
- **Line height:** 1.4
- **Letter spacing:** 0.08em uppercase for labels; normal for inline data

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| mono-label | 11px | 1.4 | 0.08em | `--text-mono-label` |
| body | 15.5px | 1.6 | — | `--text-body` |
| body-lg | 17px | 1.6 | — | `--text-body-lg` |
| heading-xs | 19px | 1.3 | — | `--text-heading-xs` |
| heading-sm | 24px | 1.2 | -0.01em | `--text-heading-sm` |
| heading | 32px | 1.15 | -0.01em | `--text-heading` |
| display-sm | 44px | 1.1 | -0.01em | `--text-display-sm` |
| display | 60px | 1.05 | -0.02em | `--text-display` |
| display-lg | 80px | 0.98 | -0.02em | `--text-display-lg` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable-instrument (breathing room around data, never cramped, never sparse-for-its-own-sake)

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 48 | 48px | `--spacing-48` |
| 64 | 64px | `--spacing-64` |
| 96 | 96px | `--spacing-96` |

### Border Radius

| Element | Value |
|---------|-------|
| buttons | 999px (full pill) |
| cards / panels | 20px |
| status chips / badges | 999px (pill) |
| nodes / signal markers | 50% |

### Layout

- **Page max-width:** 1160px
- **Section gap:** 64–112px
- **Card padding:** 28–40px
- **Element gap:** 8–16px

## Components

### Pulse Button
**Role:** Filled cobalt pill, the sole primary CTA

Background `#3F4CE0` (Cognition Blue), white text, 999px radius (full pill), 14px vertical × 26px horizontal padding. Space Grotesk 15px weight 600. Shadow is a **soft, color-tinted glow** — `0 8px 24px rgba(63,76,224,0.28)` — never a hard offset. On hover, the glow widens and the fill shifts to a slightly brighter blue; the pill never changes shape. This is the opposite elevation logic of a stamped mark — it lifts and glows rather than presses down.

### Signal Link
**Role:** Text-only secondary action

No background. Color `#3F4CE0` for standalone links, `#14161A` for inline body links with a 2px Coral underline on hover only (the underline appears as a "spike," not a permanent decoration). Space Grotesk 15.5px weight 500.

### Verification Pulse Mark
**Role:** Signature logo mark — favicon, avatar ring, loading state

A circle (2px Cognition Blue stroke) with a single waveform spike crossing horizontally through its center, the peak of the spike tipped in Coral. At small sizes it reads as a heartbeat-monitor blip inside a ring; at credential scale, five of these nodes connect via a thin gradient line (blue → coral) into a closed loop — one node per system layer (Capture, Analyse, Profile, Validate, Credential). As a loading state, the spike animates left to right like a live monitor trace, not a spinner.

### Credential Card
**Role:** The Process Profile / verification result

Card White surface, 20px radius, soft ambient shadow (`0 4px 32px rgba(20,22,26,0.08)`), no border. Field labels in Space Mono 10px uppercase Slate; values in Space Grotesk 17px weight 500 Graphite Ink. A "Cognitive Match" score renders as a large Instrument Serif numeral in Cognition Blue with a small percentage sign, sitting beside a mini Signal Trace sparkline. Validated sessions carry a pill badge — Verified Mint fill, white text, "Verified" — top right; flagged sessions carry the same pill in Flag Red with "Flagged for Review," never hidden or delayed.

### Signal Trace
**Role:** Signature hero visual — live cognitive-load waveform

A smooth SVG line with a linear gradient stroke (Cognition Blue → Signal Coral at peaks), plotted against a nearly invisible grid, with soft outer glow (`filter: blur` under the stroke, low opacity) rather than a hand-drawn or hard-edged line. Phase labels sit below in Space Mono uppercase caption text. Unlike a generic analytics chart, the line has organic, slightly uneven peaks — never a perfect sine wave — and one peak is marked with a small Coral dot annotated "flow state" or similar, tying the abstract line back to a real cognitive moment.

### Status Dot
**Role:** Small state indicator in lists and timelines

A filled circle ~10px with a soft matching glow (`box-shadow: 0 0 8px currentColor` at low opacity): Verified Mint, Flag Red, or Cognition Blue (pending/in-progress, gently pulsing). Always paired with an 8px gap and a Space Grotesk or Space Mono label — never a filled background pill by itself without the dot.

### Navigation Bar
**Role:** Top-aligned site navigation

Porcelain background, transparent until scroll, then Card White with a soft downward shadow (`0 2px 16px rgba(20,22,26,0.06)`) — never a hard rule line. Verification Pulse mark + wordmark left; nav links in Space Grotesk 14px weight 500, Slate (inactive) / Graphite Ink (active); a Pulse Button anchors the right edge.

### Ambient Field
**Role:** Decorative background texture

Extremely faint (3–5% opacity) secondary sine-traces drifting behind hero and section-break content, in Cognition Blue and Signal Coral at low saturation — echoes of signal without competing with the foreground trace. No grain, no particles, no scattered iconography.

## Do's and Don'ts

### Do
- Use `#3F4CE0` (Cognition Blue) as the only fill color for primary buttons and the Signal Trace baseline
- Reserve `#FF6A4D` (Signal Coral) for genuine peaks and moments — a flagged highlight, a peak on the trace, an active spike — never as a default secondary button color
- Keep every shadow soft, blurred, and color-tinted to match the element it sits under — glow, not offset
- Round buttons to a full pill (999px) and cards to 20px — the instrument-panel softness is part of the brand, unlike a sharp stamped edge
- Show Flag Red states immediately and plainly, with the same visual weight as Verified Mint states
- Use Instrument Serif only at 44px and above — if it appears in a button or a data label, the hierarchy has broken
- Let the Signal Trace be the only hero-scale visual — no dashboard screenshot, no illustration, no stock photography in the hero

### Don't
- Do not use Cognition Blue or Signal Coral as a large background fill — they are signal colors, reserved for line, fill-on-white, and small surface area
- Do not set body copy in Instrument Serif — it is a display face only, body is always Space Grotesk
- Do not use hard, unblurred, offset shadows anywhere — that belongs to a different, harder-edged brand language, not this one
- Do not soften or delay a Flag Red state to avoid alarming the viewer — instant, plain disclosure is the entire point
- Do not introduce a third accent hue — Blue and Coral are the full signal palette; Mint and Red are reserved strictly for state, not decoration
- Do not use a perfectly smooth sine wave for the Signal Trace — a too-regular line reads as fake data, which undermines the product's premise
- Do not stack more than one Pulse Button per view — one primary glowing action per screen

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Porcelain Canvas | `#F3F4F7` | Full-page background, section backgrounds |
| 1 | Card White | `#FFFFFF` | Credential cards, panels, modals |
| 2 | Cognition Blue | `#3F4CE0` | Highest-contrast surface — Pulse Button fill only |

## Elevation

ProblemProof uses soft, blurred, color-tinted shadows exclusively — never hard offsets, never flat borders standing in for depth. A resting card floats with a faint ambient shadow; a Pulse Button glows with a shadow tinted to its own fill color; an active Status Dot pulses with a soft halo. Elevation communicates "live signal," not "printed and pressed" — the opposite intent from a stamped-paper system, and the reason no component in this system uses a hard-edged shadow.

## Imagery

Imagery is entirely generative line-work — no photography except a small, circular-cropped validator avatar on credential cards (the one rounded-photo exception in the system). The signature visual is the Signal Trace: a glowing, gradient waveform plotting cognitive load across a session, annotated at its peak. The secondary device is the Verification Pulse mark — a ring with a waveform spike, used at every scale from favicon to full credential seal. No illustration, no icon linework beyond the functional UI icon set, no 3D render, no particle field.

## Layout

Full-width sections on Porcelain canvas, max content width ~1160px centered. Hero is a two-column split: headline (Space Grotesk heading + one Instrument Serif italic emphasis word) and Pulse Button on the left; a large Signal Trace panel on Card White, glowing softly, on the right. Sections alternate trace-left/text-right and text-left/card-right for rhythm. Section gaps are generous (64–112px). Cards are rounded and softly shadowed, arranged in loose grids with visible gap rather than touching edges. Navigation is minimal, transparent until scroll.

## Agent Prompt Guide

## Quick Color Reference
- Text: `#14161A` (primary), `#5B6472` (secondary/mono data)
- Background: `#F3F4F7` (canvas), `#FFFFFF` (cards)
- Accent: `#3F4CE0` (primary signal), `#FF6A4D` (peak/highlight, used sparingly)
- State: `#14B888` (verified), `#DC3D4A` (flagged)
- primary action: `#3F4CE0` fill, white text, full pill, soft blue glow shadow

## Example Component Prompts

1. **Hero Section**: Full-bleed `#F3F4F7` canvas. Two-column split. Left: headline in Space Grotesk 60px weight 500, `#14161A`, with one word set in Instrument Serif italic `#3F4CE0` for emphasis. Body copy 15.5px Space Grotesk `#5B6472`, max-width 440px. Pulse Button below: `#3F4CE0` fill, white text, 999px radius, soft blue glow shadow. Right: Signal Trace panel on `#FFFFFF`, 20px radius, soft ambient shadow — glowing gradient waveform (blue to coral) with one coral peak dot annotated.

2. **Section Headline + Body**: `#F3F4F7` background. Left-aligned headline 32px Space Grotesk weight 600, `#14161A`. Body 15.5px Space Grotesk `#5B6472`, max-width 480px. No borders, no card container — content floats with generous whitespace.

3. **Navigation Bar**: Transparent on `#F3F4F7`, becomes `#FFFFFF` with soft downward shadow on scroll. Left: Verification Pulse mark (ring + waveform spike) + wordmark. Right: nav links 14px Space Grotesk weight 500, `#5B6472` (inactive) / `#14161A` (active). Far right: Pulse Button, full pill, `#3F4CE0` fill.

4. **Credential Card**: `#FFFFFF` surface, 20px radius, soft ambient shadow, no border. Mono uppercase field labels 10px `#5B6472` above Space Grotesk 17px weight 500 `#14161A` values. Large Instrument Serif "94%" Cognitive Match numeral in `#3F4CE0` beside a small Signal Trace sparkline. Top-right pill badge: `#14B888` fill "Verified" or `#DC3D4A` fill "Flagged."

5. **Status Dot List**: Small filled circles ~10px with soft matching glow — `#14B888` verified, `#DC3D4A` flagged, `#3F4CE0` pending (gently pulsing) — each with an 8px gap to a Space Grotesk or Space Mono label. Stacked with 12px gaps, no container.

## Similar Brands

- **Oura / Whoop** — Same instrument-panel logic: light, clinical-modern surfaces with a single vivid signal color plotting something the body/mind is actually doing, never a decorative chart
- **Linear (light mode)** — Shares the soft-glow elevation system, generous pill-shaped buttons, and restraint in accent usage against a light, quiet canvas
- **Cash App** — Comparable use of one distinctive display serif (theirs is Cash Sans's serif companion) as a rare "voice" moment against an otherwise plain, modern UI face
- **Notion (marketing pages)** — Similar pairing instinct: an uncommon, characterful serif for headline moments against a clean geometric sans doing all the functional work

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-porcelain: #F3F4F7;
  --color-graphite-ink: #14161A;
  --color-cognition-blue: #3F4CE0;
  --color-signal-coral: #FF6A4D;
  --color-verified-mint: #14B888;
  --color-flag-red: #DC3D4A;
  --color-slate: #5B6472;
  --color-card-white: #FFFFFF;

  /* Typography — Font Families */
  --font-instrument-serif: 'Instrument Serif', 'Playfair Display', ui-serif, Georgia, serif;
  --font-space-grotesk: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  --font-space-mono: 'Space Mono', 'JetBrains Mono', ui-monospace, monospace;

  /* Typography — Scale */
  --text-mono-label: 11px;
  --leading-mono-label: 1.4;
  --tracking-mono-label: 0.08em;
  --text-body: 15.5px;
  --leading-body: 1.6;
  --text-body-lg: 17px;
  --leading-body-lg: 1.6;
  --text-heading-xs: 19px;
  --leading-heading-xs: 1.3;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.2;
  --tracking-heading-sm: -0.01em;
  --text-heading: 32px;
  --leading-heading: 1.15;
  --tracking-heading: -0.01em;
  --text-display-sm: 44px;
  --leading-display-sm: 1.1;
  --tracking-display-sm: -0.01em;
  --text-display: 60px;
  --leading-display: 1.05;
  --tracking-display: -0.02em;
  --text-display-lg: 80px;
  --leading-display-lg: 0.98;
  --tracking-display-lg: -0.02em;

  /* Typography — Weights */
  --font-weight-light: 300;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-64: 64px;
  --spacing-96: 96px;

  /* Layout */
  --page-max-width: 1160px;
  --section-gap: 64-112px;
  --card-padding: 28-40px;
  --element-gap: 8-16px;

  /* Border Radius */
  --radius-button: 999px;
  --radius-card: 20px;
  --radius-chip: 999px;
  --radius-node: 50%;

  /* Surfaces */
  --surface-porcelain-canvas: #F3F4F7;
  --surface-card-white: #FFFFFF;
  --surface-cognition-blue: #3F4CE0;

  /* Elevation — soft, color-tinted glow */
  --shadow-card: 0 4px 32px rgba(20,22,26,0.08);
  --shadow-pulse: 0 8px 24px rgba(63,76,224,0.28);
  --shadow-coral: 0 8px 24px rgba(255,106,77,0.28);
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-porcelain: #F3F4F7;
  --color-graphite-ink: #14161A;
  --color-cognition-blue: #3F4CE0;
  --color-signal-coral: #FF6A4D;
  --color-verified-mint: #14B888;
  --color-flag-red: #DC3D4A;
  --color-slate: #5B6472;
  --color-card-white: #FFFFFF;

  /* Typography */
  --font-instrument-serif: 'Instrument Serif', 'Playfair Display', ui-serif, Georgia, serif;
  --font-space-grotesk: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  --font-space-mono: 'Space Mono', 'JetBrains Mono', ui-monospace, monospace;

  /* Border Radius */
  --radius-button: 999px;
  --radius-card: 20px;
  --radius-chip: 999px;
  --radius-node: 50%;
}
```
