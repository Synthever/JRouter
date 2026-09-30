# Design System & Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align JRouter's frontend foundation and dashboard shell to `docs/DESIGN.md`, establishing global Geist fonts, dark/light surface tokens, hairline borders, `.u-tnum` monospace metrics, a 5-column stats grid, and dual-layout activity logs.

**Architecture:** Update Next.js root layout with Geist and Geist Mono font variables. Overhaul `src/app/globals.css` with semantic surfaces, catchlight depth, radius tokens, and backward-compatible aliases for unmigrated views. Refactor `DashboardLayout`, `Sidebar`, and `Header` to enforce the 1180px `.page` container and hairline hardware aesthetic. Update `OverviewCards` to a responsive 5-column tabular grid and `RequestLogger` to support dual table/card views with high-contrast status chips.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, `next/font/google` (Geist & Geist Mono).

**Spec:** `docs/superpowers/specs/2026-09-30-design-system-dashboard-shell-design.md`

## Global Constraints

- Preserve both Dark Mode (`.dark`) and Light Mode (`:root`) support.
- Maintain backward-compatibility CSS aliases (`--color-bg`, `--color-surface`, `--color-border`, etc.) so unmigrated routes do not break.
- No decorative multi-stop gradients or saturated neon accent drops.
- Numbers, tokens, latencies, and keys must use `Geist Mono` and tabular numeric layout (`.u-tnum`).
- All work committed on feature branch `feat/design-system-dashboard-shell`.

## Review Focus

- Light mode contrast: Ensure light mode text (`--text: #0A0A0B`, `--text-2: #52525B`) meets WCAG AAA against `--bg: #F7F7F8` and `--surface: #FFFFFF`.
- Tabular numeric alignment: Ensure `.u-tnum` prevents horizontal jitter when live token counters update.
- Responsive grid collapse: Ensure `.grid-stats` collapses gracefully from 5 columns to 3 (<= 1050px), 2 (<= 720px), and 1 (<= 420px).
- Full-bleed exception: Ensure `/dashboard/basic-chat` retains full-bleed layout while other routes are bounded by `.page` (1180px).
- Backward compatibility: Ensure legacy components referencing `--color-primary`, `--color-surface`, or `--color-border` inherit new tokens without invisible text or missing borders.

---

### Task 1: Global Font & Typography Setup

**Files:**
- Modify: `src/app/layout.js:1-75`
- Test: Build verification & element inspection

**Interfaces:**
- Consumes: `next/font/google` (`Geist`, `Geist_Mono`)
- Produces: CSS variables `--font-geist-sans` and `--font-geist-mono` attached to `<body>`

- [ ] **Step 1: Check existing font imports in `src/app/layout.js`**
Confirm `Inter` is imported and identify where `--font-inter` is declared.

- [ ] **Step 2: Replace `Inter` with `Geist` and `Geist_Mono`**
Import `Geist` and `Geist_Mono` from `next/font/google`. Configure `variable: "--font-geist-sans"` and `variable: "--font-geist-mono"`.

- [ ] **Step 3: Update `<body>` className**
Apply `${geistSans.variable} ${geistMono.variable} font-sans antialiased` to `<body>`.

- [ ] **Step 4: Verify font configuration passes lint**
Run: `npx eslint src/app/layout.js`
Expected: PASS (0 errors)

- [ ] **Step 5: Commit**
```bash
git add src/app/layout.js
git commit -m "feat(typography): integrate Geist and Geist Mono font variables"
```

---

### Task 2: Global CSS Design Tokens & Hairline Foundation

**Files:**
- Modify: `src/app/globals.css:1-250`
- Test: CSS parsing and build verification

**Interfaces:**
- Consumes: `--font-geist-sans`, `--font-geist-mono`
- Produces: CSS variables (`--bg`, `--surface`, `--line`, `--text`, `--pos`, `--warn`, `--danger`, `--r1`-`--r4`, `--shadow-card`, `--shadow-pop`), utility classes (`.u-tnum`, `.page`, `.grid-stats`)

- [ ] **Step 1: Define design tokens in `:root` and `.dark`**
In `src/app/globals.css`, add tokens from `docs/DESIGN.md`:
- Dark mode (`.dark`): `--bg: #0A0A0B`, `--bg-2: #0D0D0F`, `--surface: #131315`, `--surface-2: #1A1A1D`, `--inset: #101012`, `--line: rgba(255, 255, 255, 0.065)`, `--line-2: rgba(255, 255, 255, 0.11)`, `--accent-line: rgba(255, 255, 255, 0.18)`, `--text: #EDEDEE`, `--text-2: #A1A1A6`, `--text-3: #6B6B70`.
- Light mode (`:root`): `--bg: #F7F7F8`, `--bg-2: #EFEFEF`, `--surface: #FFFFFF`, `--surface-2: #F0F0F2`, `--inset: #EAEAEC`, `--line: rgba(0, 0, 0, 0.08)`, `--line-2: rgba(0, 0, 0, 0.14)`, `--text: #0A0A0B`, `--text-2: #52525B`, `--text-3: #71717A`.
- Radii: `--r1: 6px`, `--r2: 10px`, `--r3: 14px`, `--r4: 20px`, `--r-full: 999px`.
- Shadows: `--shadow-card`, `--shadow-pop`.

- [ ] **Step 2: Add backward-compatibility bridge**
Map legacy color aliases (`--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`) to the new tokens in `@theme inline` and `:root`/`.dark`.

- [ ] **Step 3: Define utility classes**
Add:
- `.u-tnum { font-variant-numeric: tabular-nums; }`
- `.page { max-width: 1180px; margin-left: auto; margin-right: auto; width: 100%; }`
- `.grid-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }` with responsive breakpoints: `<= 1050px` (3 cols), `<= 720px` (2 cols), `<= 420px` (1 col).

- [ ] **Step 4: Verify CSS syntax and build**
Run: `npm run build`
Expected: Next.js build succeeds without CSS compilation errors.

- [ ] **Step 5: Commit**
```bash
git add src/app/globals.css
git commit -m "feat(styles): implement design tokens, hairline borders, and utility classes"
```

---

### Task 3: Dashboard Shell & Layout Container

**Files:**
- Modify: `src/shared/components/layouts/DashboardLayout.js:1-125`
- Test: Lint and component render check

**Interfaces:**
- Consumes: `.page`, `--bg`, `--surface`, `--line-2`, notification store
- Produces: Structured dashboard shell with 1180px bounded content and hardware-styled toast notifications

- [ ] **Step 1: Update container markup in `DashboardLayout.js`**
Remove legacy `landing-grid` background element.
Wrap `children` in `.page` container when `pathname !== "/dashboard/basic-chat"`.

- [ ] **Step 2: Restyle toast notifications**
Update `getToastStyle(type)` to use hairline borders (`border-[var(--line-2)]`), background `var(--surface)`, text `var(--text)`, and clean semantic status icons matching DESIGN.md status colors.

- [ ] **Step 3: Verify with linter**
Run: `npx eslint src/shared/components/layouts/DashboardLayout.js`
Expected: PASS (0 errors)

- [ ] **Step 4: Commit**
```bash
git add src/shared/components/layouts/DashboardLayout.js
git commit -m "feat(layout): apply page container and hardware styling to DashboardLayout"
```

---

### Task 4: Sidebar Component Refactoring

**Files:**
- Modify: `src/shared/components/Sidebar.js:1-250`
- Test: Lint and visual navigation check

**Interfaces:**
- Consumes: `--surface`, `--line`, `--accent-line`, `--r1`, `Geist Mono` typography
- Produces: Precise hardware-styled desktop and mobile navigation sidebar

- [ ] **Step 1: Update Sidebar container styling**
Set background to `var(--surface)`, border-right to `1px solid var(--line)`.

- [ ] **Step 2: Update navigation links styling**
Apply radius `--r1` (6px), padding `8px 12px`, transition to `--surface-2` on hover.
Active link styling: background `--surface-2`, border `1px solid var(--accent-line)`, font-medium text `--text`.

- [ ] **Step 3: Update section headers & badges**
Section headers: Font `Geist Mono`, size 11px (`0.6875rem`), weight 500, letter-spacing `0.2em`, uppercase, color `--text-3`.
Update pill & version badges: background `--surface-2`, border `1px solid var(--line)`, text `--text-2`.

- [ ] **Step 4: Verify with linter**
Run: `npx eslint src/shared/components/Sidebar.js`
Expected: PASS (0 errors)

- [ ] **Step 5: Commit**
```bash
git add src/shared/components/Sidebar.js
git commit -m "feat(sidebar): refactor sidebar with hairline borders and Geist Mono labels"
```

---

### Task 5: Header Component Refactoring

**Files:**
- Modify: `src/shared/components/Header.js:1-180`
- Test: Lint and header title/action check

**Interfaces:**
- Consumes: `--surface`, `--line`, `--text`, `--r1`, `.ui-btn`
- Produces: Hardware-aligned Header bar with 24px title typography and hairline border

- [ ] **Step 1: Update Header container styling**
Set background to `var(--surface)`, border-bottom to `1px solid var(--line)`, height and horizontal padding aligned with 24px grid.

- [ ] **Step 2: Update Page Title typography**
Apply `page__title` style: 24px (`1.5rem`), font-semibold (600), line-height 1.2, letter-spacing `-0.02em`, color `--text`.

- [ ] **Step 3: Update Header Action buttons**
Style action buttons (theme toggle, language switcher, donate modal button) with radius `--r1` (6px), border `1px solid var(--line-2)`, hover background `--surface-2`.

- [ ] **Step 4: Verify with linter**
Run: `npx eslint src/shared/components/Header.js`
Expected: PASS (0 errors)

- [ ] **Step 5: Commit**
```bash
git add src/shared/components/Header.js
git commit -m "feat(header): update header typography and hairline border styling"
```

---

### Task 6: OverviewCards 5-Column Grid Refactoring

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/OverviewCards.js:1-50`
- Test: Unit check and responsive layout verification

**Interfaces:**
- Consumes: `stats` object `{ totalRequests, totalPromptTokens, totalCachedTokens, totalCompletionTokens, totalCost }`
- Produces: `.grid-stats` 5-column metric display with `.u-tnum` Geist Mono values and catchlight shadows

- [ ] **Step 1: Update grid markup**
Replace container class with `.grid-stats`.
Ensure responsive grid handles 5 cols (desktop), 3 cols (<= 1050px), 2 cols (<= 720px), 1 col (<= 420px).

- [ ] **Step 2: Apply card container styling**
Each metric card uses background `var(--surface)`, border `1px solid var(--line)`, radius `--r3` (14px), shadow `var(--shadow-card)`, and padding `20px 24px`.

- [ ] **Step 3: Format numbers with `.u-tnum` and `Geist Mono`**
Set metric values to `font-mono text-2xl font-semibold tracking-tight u-tnum text-[var(--text)]`.
Set metric titles to `font-mono text-[11px] font-medium tracking-[0.2em] uppercase text-[var(--text-3)]`.

- [ ] **Step 4: Verify with linter**
Run: `npx eslint src/app/(dashboard)/dashboard/usage/components/OverviewCards.js`
Expected: PASS (0 errors)

- [ ] **Step 5: Commit**
```bash
git add src/app/(dashboard)/dashboard/usage/components/OverviewCards.js
git commit -m "feat(usage): convert OverviewCards to 5-column grid-stats with tabular metrics"
```

---

### Task 7: Activity Logs Component Refactoring

**Files:**
- Modify: `src/shared/components/RequestLogger.js:1-150`
- Test: Lint and view toggle verification

**Interfaces:**
- Consumes: Request log items from `/api/usage/request-logs`
- Produces: Dual-view (Table View / Cards View) activity logger with high-contrast status chips and millisecond latency units

- [ ] **Step 1: Add Table/Cards View mode state**
Add `viewMode` state (`"table"` | `"cards"`). Render toggle control in logger toolbar.

- [ ] **Step 2: Implement Table View styling**
Format table with sticky header (`bg-[var(--surface-2)]`, border-b `var(--line)`), monospace columns for Model, In/Out tokens, Latency with `ms` unit tag, and `.u-tnum`.

- [ ] **Step 3: Implement Cards View styling**
For touch/mobile view, render items as compact cards with `var(--surface)` background, `1px solid var(--line)`, radius `--r2` (10px).

- [ ] **Step 4: Update status badges**
Map statuses to DESIGN.md chips:
- `OK`: background `#14251D`, text `#34D39A` (or light-mode equivalent)
- `Partial`: background `#261F12`, text `#F2B34B`
- `Error`: background `#281515`, text `#FF6B6B`

- [ ] **Step 5: Verify with linter**
Run: `npx eslint src/shared/components/RequestLogger.js`
Expected: PASS (0 errors)

- [ ] **Step 6: Commit**
```bash
git add src/shared/components/RequestLogger.js
git commit -m "feat(logger): implement dual-view layout and hardware status badges in RequestLogger"
```

---

### Task 8: Full Build & Verification

**Files:**
- Test all modified files across workspace

- [ ] **Step 1: Run workspace linter**
Run: `npx eslint src/app/layout.js src/app/globals.css src/shared/components/layouts/DashboardLayout.js src/shared/components/Sidebar.js src/shared/components/Header.js src/app/(dashboard)/dashboard/usage/components/OverviewCards.js src/shared/components/RequestLogger.js`
Expected: PASS (0 errors)

- [ ] **Step 2: Run production build**
Run: `npm run build`
Expected: Next.js standalone webpack build compiles successfully.

- [ ] **Step 3: Commit any final cleanup and prepare for PR**
```bash
git status
```
Ensure branch `feat/design-system-dashboard-shell` is clean with all planned commits.
