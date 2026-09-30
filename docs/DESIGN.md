---
version: alpha
name: JRouter
description: High-density dark-mode developer infrastructure blending typographic precision, monospace metrics, and architectural physical-hardware borders.
colors:
  primary: "#FFFFFF"
  secondary: "#EDEDEE"
  tertiary: "#FF3B3B"
  neutral: "#0A0A0B"
  surface: "#131315"
  surface-secondary: "#1A1A1D"
  surface-inset: "#101012"
  surface-hover: "#232327"
  text: "#EDEDEE"
  text-muted: "#A1A1A6"
  text-dim: "#6B6B70"
  success: "#34D39A"
  warning: "#F2B34B"
  danger: "#FF6B6B"
  promo: "#FF3B3B"
  promo-accent: "#FF8560"
typography:
  display:
    fontFamily: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  h1:
    fontFamily: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 1.875rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body-md:
    fontFamily: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.45
  code:
    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.45
  eyebrow:
    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.2em"
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 20px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    padding: 10px 18px
  button-primary-hover:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.neutral}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 8px 14px
  button-ghost-hover:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.primary}"
  button-soft:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 8px 14px
  button-soft-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.primary}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  terminal-well:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 16px
  tag-muted:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: 6px 12px
  tag-dim:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.full}"
    padding: 6px 12px
  badge-success:
    backgroundColor: "#14251D"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  badge-warning:
    backgroundColor: "#261F12"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  badge-danger:
    backgroundColor: "#281515"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  promo-badge:
    backgroundColor: "{colors.promo}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  promo-accent-badge:
    backgroundColor: "{colors.promo-accent}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  banner-alert:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    padding: 12px 16px
---

## Overview

JRouter is an enterprise-grade AI proxy gateway and developer dashboard designed with a raw, engineering-first aesthetic. The design language avoids gratuitous decorative gradients, illustrative fluff, and oversaturated neon accents in favor of architectural dark-mode ergonomics, dense tabular data presentations, and fine-milled hairline borders.

### Core Visual Principles
1. **Utility Over Decoration**: Every visual token communicates state, density, or hierarchy. Decorative elements are restricted to subtle architectural crosshairs and monospaced terminal cues.
2. **Monochromatic Density with Purposeful Color**: The foundational canvas is built from deep neutral carbon tones (`#0A0A0B` to `#1A1A1D`). Color is treated as an alert state: green for operational success, amber for warnings/pending review, red for errors, and crimson for flash promotional incentives.
3. **Hardware-Inspired Lighting**: Cards utilize a 1px top highlight border (`inset 0 1px 0 0 rgba(255, 255, 255, 0.04)`) to simulate top-down workstation lighting on matte anodized aluminum surfaces.
4. **Tabular Monospace Precision**: Numbers, tokens, financial amounts, API key prefixes, and timestamps use `Geist Mono` with tabular numbers enabled (`u-tnum`) to eliminate layout jitter during live updates.

---

## Colors

### Surface Hierarchy
The background system establishes a 4-tier z-index and elevation hierarchy to visually group controls without adding heavy drop shadows:

- **Canvas Background (`--bg`, `#0A0A0B`)**: Deepest substrate, applied to `<body>` and full-viewport containers.
- **Secondary Canvas (`--bg-2`, `#0D0D0F`)**: Secondary page sections, table backgrounds, and backdrop scrims.
- **Card Surface (`--surface`, `#131315`)**: Base container for dashboard panels, overview cards, and modal dialogs.
- **Elevated Surface (`--surface-2`, `#1A1A1D`)**: Interactive control backgrounds, soft buttons, dropdown menus, and hover states.
- **Inset Substrate (`--inset`, `#101012`)**: Recessed data tracks, progress bars, and chart background wells.

### Border & Hairline System
- **Subtle Line (`--line`, `rgba(255, 255, 255, 0.065)`)**: Default boundary for card perimeter, horizontal dividers, and section separators.
- **Interactive Line (`--line-2`, `rgba(255, 255, 255, 0.11)`)**: Default border for buttons, input fields, selects, and unselected tabs.
- **Active / Focus Line (`--accent-line`, `rgba(255, 255, 255, 0.18)`)**: Hover state border, active nav items, and focused form controls.

### Semantic & Status Palette
- **Primary Text (`--text`, `#EDEDEE`)**: 93% luminance text for titles, critical metrics, and table headers.
- **Secondary Text (`--text-2`, `#A1A1A6`)**: Subtitles, input placeholders, metadata descriptions, and inactive tabs.
- **Tertiary Text (`--text-3`, `#6B6B70`)**: Footnotes, disabled labels, timestamps, and table axis ticks.
- **Success (`--pos`, `#34D39A`)**: Completed orders, active API keys, uptime badges, and positive trends.
- **Warning (`--warn`, `#F2B34B`)**: Pending payments, expiring quotas, review alerts.
- **Danger (`--danger`, `#FF6B6B`)**: Revoked keys, failed HTTP calls, error logs.
- **Promo (`--promo`, `#FF3B3B` / `--promo-2`, `#FF8560`)**: Limited-time token bonuses and flash sales.

---

## Typography

The typography system pairs **Geist Sans** for editorial flow with **Geist Mono** for technical telemetry and code artifacts.

| Role | Font Family | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | Geist Sans | `clamp(27px, 3.4vw, 40px)` | 600 | 1.12 | `-0.03em` | Landing hero headlines, main value proposition |
| **Page Title** | Geist Sans | `24px` (`1.5rem`) | 600 | 1.20 | `-0.02em` | Dashboard view titles (`.page__title`) |
| **Card Title** | Geist Sans | `17px` (`1.0625rem`) | 600 | 1.25 | `-0.015em` | Panel titles (`.ui-card__title`) |
| **Body Large** | Geist Sans | `16px` (`1rem`) | 400 | 1.50 | `normal` | Hero lede descriptions |
| **Body Regular** | Geist Sans | `14px` (`0.875rem`) | 400 | 1.50 | `normal` | Descriptions, list items, modal copy |
| **Eyebrow / Tag**| Geist Mono | `11px` (`0.6875rem`) | 500 | 1.20 | `0.20em` | Section categorization, upper-case badges |
| **Mono Data** | Geist Mono | `13px` (`0.8125rem`) | 400 | 1.45 | `normal` | API Keys, request IDs, tokens, latencies |
| **Axis Label** | Geist Mono | `11px` (`0.6875rem`) | 400 | 1.20 | `normal` | Chart X-axis dates, TTFT indicators |

### Monospace Rule (`.u-tnum`)
All numeric figures subject to change (token counters, balances, prices, percentages, countdown timers) **must** carry `font-variant-numeric: tabular-nums` or the `.u-tnum` utility class to prevent horizontal layout shift during re-rendering.

---

## Layout

### Architectural Structure
1. **Container Widths**:
   - Landing Content (`.lp-wrap`): `1120px` max width with `24px` responsive inline gutter.
   - Dashboard Content (`.page`): `1180px` max width, centered with flexible padding.
2. **Section Framing (`.lp-section`)**:
   - Each major landing section is bounded by a top/bottom hairline with architectural 12px diamond corner brackets (`:before` and `:after` at `var(--rail-inset)`).
3. **Grid Formats**:
   - **Dashboard Stats (`.grid-stats`)**: 5-column grid (`grid-template-columns: repeat(5, 1fr)`) on desktop, collapsing to 3 columns at `<= 1050px`, 2 columns at `<= 720px`, and 1 column at `<= 420px`.
   - **Analytics Split (`.overview-analytics`)**: 2-column split (Chart 1.6fr, Model Breakdown 1fr) collapsing to 1 column at `<= 860px`.
   - **Pricing Packs (`.lp-packs`)**: 3-column grid (`repeat(3, 1fr)`) collapsing to 2 columns at `<= 960px` and single column at `<= 640px`.

### Spacing Scale
- `4px` (`xs`): Micro-gaps between status dots and badges.
- `8px` (`sm`): Button internal padding, input vertical padding, icon-text gap.
- `16px` (`md`): Form field gaps, compact card padding, list item gutters.
- `24px` (`lg`): Standard card interior padding, grid column gaps.
- `32px` (`xl`): Section header margin, modal header-to-body separation.
- `64px` (`xxl`): Landing section vertical padding (`padding: 64px 0`).

---

## Elevation & Depth

JRouter rejects diffuse colored drop-shadows. Depth is conveyed strictly through ambient occlusion and bevel highlights:

- **Card Elevation (`--shadow-card`)**:
  ```css
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.04), 0 24px 48px -34px rgba(0, 0, 0, 0.85);
  ```
  The inset white hairline creates a razor-sharp top edge catchlight, while the negative spread shadow grounds the card firmly against `--bg`.
- **Floating / Popover Elevation (`--shadow-pop`)**:
  ```css
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.06), 0 30px 60px -30px rgba(0, 0, 0, 0.90);
  ```
  Applied to dropdowns, modal windows, tooltips, and floating action bars.
- **Recessed / Inset Elevation**:
  Used for progress tracks, code boxes, and terminal outputs. Defined via background `--inset` with border `1px solid var(--line)` without exterior drop-shadow.

---

## Shapes

Corner radii are standardized into a 5-tier system to enforce visual consistency across all UI scales:

- **`--r1: 6px` (Small)**: Interactive elements — buttons (`.ui-btn`), inputs, selects, filter dropdowns, search bars.
- **`--r2: 10px` (Medium)**: Internal child blocks, table row groupings, code blocks, QR containers.
- **`--r3: 14px` (Large)**: Top-level containers — `.ui-card`, `.overview-panel`, `.usage-panel`, `.logs-card`.
- **`--r4: 20px` (Extra Large)**: Dialog windows, modal panels (`.modal`), auth split containers.
- **Pill (`999px`)**: Badges (`.ui-tag`), status indicators, promo chips, and circular icon buttons.

---

## Components

### 1. Buttons (`.ui-btn`)
- **Primary (`.ui-btn--primary`)**: High-emphasis action (Checkout, Sign In, Buy Tokens). Background `#FFFFFF`, text `#0A0A0B`, hover `#E6E6E8`.
- **Soft (`.ui-btn--soft`)**: Secondary action (Reload, Apply Filters). Background `var(--surface-2)`, text `var(--text)`, border `var(--line-2)`. Hover `#232327`, text `#FFFFFF`.
- **Ghost (`.ui-btn--ghost`)**: Neutral/Tertiary action (Refresh, Cancel, Create Key). Background `transparent`, text `var(--text)`, border `var(--line-2)`. Hover `var(--surface-2)`.
- **Disabled State**: `opacity: 0.46`, cursor `not-allowed`, no scale transform.

### 2. Eyebrows & Tags (`.ui-eyebrow`, `.lp-eyebrow`)
- Monospace uppercase label with `0.2em` tracking.
- Preceded by a 6px circular dot (`.lp-eyebrow__dot`) colored `var(--text)` or semantic color.
- Used above major headers to immediately establish context.

### 3. Stat Card (`.stat-card` / `_Component9`)
- Displays metric label, icon, tabular value, and contextual subtitle (e.g. `rolling 24 hours`).
- Background `var(--surface)`, border `var(--line)`.
- Numeric values formatted with compact decimal separators and currency units.

### 4. Interactive Activity Logs (`.logs-table`)
- Dual-layout toggle: Cards view (touch-friendly on mobile) and Table view (high-density desktop analysis).
- Status badges:
  - `OK` → Tone `pos` (`#34D39A`)
  - `Partial` → Tone `warn` (`#F2B34B`)
  - `Error` → Tone `danger` (`#FF6B6B`)
- Latency and TTFT rendered with millisecond unit tags (`Kl(ms)`).

### 5. API Key & Copy Field (`.copyfield`)
- Displays masked prefix (`sk-pecut-qVz1...`) in monospace font.
- Embedded clipboard button with instant state transition to "Copied" and checkmark icon for 1400ms.

### 6. Modal Scrim & Dialog (`.modal-scrim`, `.modal`)
- Backdrop: `rgba(0, 0, 0, 0.72)` with CSS `backdrop-filter: blur(8px)`.
- Modal box: centered, background `var(--surface)`, border `var(--line-2)`, shadow `var(--shadow-pop)`.
- Escape key listener, auto-focus management, and focus restoration on unmount.

---

## Do's and Don'ts

### Do
- **Do** format all dynamic numbers with `tabular-nums` (`.u-tnum`) to maintain clean grid alignment during polling updates.
- **Do** use `Geist Mono` for technical strings, IDs, token counts, request identifiers, and timestamps.
- **Do** respect the 1px top highlight border on cards for uniform spatial depth.
- **Do** ensure all interactive elements feature visible `:focus-visible` keyboard focus indicators.
- **Do** honor `@media (prefers-reduced-motion: reduce)` by clamping animation durations to 0.001ms.

### Don't
- **Don't** add colorful multi-stop linear gradients to backgrounds, buttons, or text.
- **Don't** use pure saturated blues or purples for primary interactive controls; the primary action is crisp white `#FFFFFF` on dark canvas.
- **Don't** create floating colorful drop shadows (e.g. `rgba(52, 211, 154, 0.4)`); shadows must remain achromatic black.
- **Don't** hide critical data behind truncated ellipsis without providing hover tooltips or expandable views.
- **Don't** mix border-radius scales inconsistently (e.g., placing a 20px pill button inside a 6px card).
