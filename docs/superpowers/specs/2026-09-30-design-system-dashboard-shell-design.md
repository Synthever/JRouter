# Design System & Dashboard Shell Alignment Specification

## 1. Context & Objectives

JRouter's visual identity is transitioning to the raw, engineering-first aesthetic defined in `docs/DESIGN.md`. This aesthetic emphasizes dark-mode developer infrastructure, monospace tabular precision, anodized aluminum lighting cues (1px top catchlight), and hairline borders, with support for light mode retained.

This specification covers **Phase 1 (Sub-Project B)**:
- Establishing global design tokens (Geist fonts, color system, elevation, radius, `.u-tnum`).
- Refactoring the dashboard shell (`DashboardLayout`, `Sidebar`, `Header`).
- Updating the primary overview components (`OverviewCards` 5-column grid and `RequestLogger` dual-view activity log).

---

## 2. Global Token & Typography Foundation

### 2.1 Font Integration (`src/app/layout.js`)
- Import `Geist` and `Geist_Mono` from `next/font/google`.
- Configure CSS variables `--font-geist-sans` and `--font-geist-mono`.
- Apply fonts to `<body>` with appropriate fallbacks to system monospace and sans-serif stacks.

### 2.2 Color & Surface System (`src/app/globals.css`)
Implement 4-tier surface hierarchy and hairline system in both dark and light themes:

#### Dark Mode (`.dark`, default aesthetic)
- **Canvas Substrates**:
  - `--bg: #0A0A0B` (Canvas background)
  - `--bg-2: #0D0D0F` (Secondary canvas / scrim)
  - `--surface: #131315` (Cards, panels, modals)
  - `--surface-2: #1A1A1D` (Hover states, controls, soft buttons)
  - `--inset: #101012` (Recessed tracks, wells, code backgrounds)
- **Hairlines & Borders**:
  - `--line: rgba(255, 255, 255, 0.065)` (Default perimeter)
  - `--line-2: rgba(255, 255, 255, 0.11)` (Inputs, buttons, tabs)
  - `--accent-line: rgba(255, 255, 255, 0.18)` (Focus / hover)
- **Typography & Status**:
  - `--text: #EDEDEE` (Primary)
  - `--text-2: #A1A1A6` (Secondary / muted)
  - `--text-3: #6B6B70` (Tertiary / dim)
  - `--pos: #34D39A` (Success)
  - `--warn: #F2B34B` (Warning)
  - `--danger: #FF6B6B` (Error)
  - `--promo: #FF3B3B` (Promotional / accent)

#### Light Mode (`:root`)
- **Canvas Substrates**:
  - `--bg: #F7F7F8`
  - `--bg-2: #EFEFEF`
  - `--surface: #FFFFFF`
  - `--surface-2: #F0F0F2`
  - `--inset: #EAEAEC`
- **Hairlines & Borders**:
  - `--line: rgba(0, 0, 0, 0.08)`
  - `--line-2: rgba(0, 0, 0, 0.14)`
  - `--accent-line: rgba(0, 0, 0, 0.22)`
- **Typography & Status**:
  - `--text: #0A0A0B`
  - `--text-2: #52525B`
  - `--text-3: #71717A`
  - Status colors mapped to high-contrast equivalents.

#### Backward Compatibility Aliases
Map existing Tailwind theme variables to new design tokens to prevent visual breakage in unmigrated pages:
- `--color-bg: var(--bg)`
- `--color-surface: var(--surface)`
- `--color-surface-2: var(--surface-2)`
- `--color-border: var(--line)`
- `--color-text: var(--text)`
- `--color-text-muted: var(--text-2)`

### 2.3 Elevation, Radii, & Utilities
- **Elevation**:
  - `--shadow-card: inset 0 1px 0 0 rgba(255, 255, 255, 0.04), 0 24px 48px -34px rgba(0, 0, 0, 0.85);`
  - `--shadow-pop: inset 0 1px 0 0 rgba(255, 255, 255, 0.06), 0 30px 60px -30px rgba(0, 0, 0, 0.90);`
- **Radius System**:
  - `--r1: 6px` (Controls, buttons, inputs)
  - `--r2: 10px` (Internal blocks, nested groups)
  - `--r3: 14px` (Cards, panels)
  - `--r4: 20px` (Modals)
  - `--r-full: 999px` (Pills, badges)
- **Utilities**:
  - `.u-tnum`: `font-variant-numeric: tabular-nums;` to prevent jitter on numeric telemetry.
  - `.page`: `max-width: 1180px; margin: 0 auto; width: 100%;`

---

## 3. Dashboard Shell Refactoring

### 3.1 Shell Layout (`src/shared/components/layouts/DashboardLayout.js`)
- Remove legacy glowing gradient grid backgrounds.
- Apply `--bg` substrate and `.page` container wrapper for page views (exempting full-bleed basic chat).
- Restyle toast notifications with `--line-2` hairlines and muted status badges.

### 3.2 Sidebar (`src/shared/components/Sidebar.js`)
- Frame with `--surface` background and right border `1px solid var(--line)`.
- Navigation items:
  - Radius `--r1` (6px).
  - Hover background `--surface-2`.
  - Active state: background `--surface-2`, border hairline `--accent-line`, text `--text`.
- Section headers: Monospace uppercase (`Geist Mono`, 11px, tracking `0.2em`, color `--text-3`).
- Badges and update pills: Neutral carbon pills using `--surface-2` and `--line`.

### 3.3 Header (`src/shared/components/Header.js`)
- Frame with `--surface` background and bottom border `1px solid var(--line)`.
- Title typography: `24px` (`1.5rem`), weight 600, tracking `-0.02em`.
- Action buttons: `.ui-btn--ghost` and `.ui-btn--soft` styles, 6px radius (`--r1`).
- Clean breadcrumb navigation with subtle hairline separators.

---

## 4. Overview & Activity Logs Components

### 4.1 Stats Grid (`src/app/(dashboard)/dashboard/usage/components/OverviewCards.js`)
- Convert into `.grid-stats`: 5-column layout on desktop (`repeat(5, 1fr)`).
- Responsive breakdown: 3 columns at `<= 1050px`, 2 columns at `<= 720px`, 1 column at `<= 420px`.
- Card container: `--surface` background, `1px solid var(--line)`, radius `--r3` (14px), catchlight `--shadow-card`.
- Metric numbers: Font `Geist Mono` 600 weight with `.u-tnum`.
- Metric labels: Monospace uppercase 11px tracking `0.2em`.

### 4.2 Interactive Activity Logs (`src/shared/components/RequestLogger.js`)
- Layout Toggle: Add switch between **Table View** (high-density desktop view) and **Cards View** (touch/mobile friendly).
- Status Badges:
  - `OK` -> Background `#14251D`, Text `#34D39A`
  - `Partial` -> Background `#261F12`, Text `#F2B34B`
  - `Error` -> Background `#281515`, Text `#FF6B6B`
- Monospace Data: Model names, token counts, and latency (`Kl(ms)`) formatted in `Geist Mono` with `.u-tnum`.

---

## 5. Verification Plan

1. **Lint Check**: Run `npx eslint .` to ensure no syntax or styling linter regressions.
2. **Build Check**: Run `npm run build` to verify Next.js webpack build and CSS compilation.
3. **Runtime Visual Check**: Verify dark mode and light mode rendering on `http://localhost:20128/dashboard`.
4. **Git Discipline**: Ensure changes remain isolated to the designated feature branch (`feat/design-system-dashboard-shell`).
