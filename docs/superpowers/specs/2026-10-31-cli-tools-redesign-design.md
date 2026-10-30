# CLI Tools Redesign Specification

**Date:** 2026-10-31
**Route:** `/dashboard/cli-tools` and `/dashboard/cli-tools/[toolId]`
**Reference:** `docs/DESIGN.md`, shipped redesigns of `/dashboard`, `/dashboard/endpoint`, `/dashboard/providers`, `/dashboard/combos`, `/dashboard/usage`, `/dashboard/health`, `/dashboard/quota`
**Status:** Approved design, implementation plan pending

## 1. Context & Objectives

`/dashboard/cli-tools` is the only remaining page on the old skeleton. The index renders 26 tools as one flat grid of 88px tiles (icon, name, status badge) with no search, no filter and no grouping; the MITM group is appended as an afterthought. The 15 detail pages stack a page title on top of a card that repeats the same title, bury its action buttons below the fold, and hand-roll the same `grid sm:grid-cols-[8rem_auto_1fr_auto]` field row 73 times across 13 files.

Every other page in the dashboard already speaks one language: page intro (`.title` / `.sub`), 24px-radius panels on hairline borders, pill toolbars, brand-colour metric cards. This spec brings CLI Tools onto that language and pays down the duplication inside the detail cards.

Objectives:

1. Index: intro, four-metric strip, sticky toolbar (search + status filter), three product sections, richer cards.
2. Detail: one page header (no duplicated title), one panel of consistent field rows, sticky action bar.
3. Shared, route-scoped UI kit (`FieldRow`, `FieldGroup`, `CliToolHeader`, `ActionBar`, `ToolCard`) adopted by the index and by all 15 tool cards.
4. Zero behavioural change: the same save/apply endpoints, the same filesystem writes, the same tunnel/cloud endpoint resolution.

## 2. Decisions Taken During Brainstorming

| Question | Decision |
| --- | --- |
| Scope | Index + detail shell + the configuration body of all 15 tool cards. |
| Standardisation depth | Hybrid: one shared header/footer plus a shared field-row system applied to all cards; each tool keeps its own body logic and bespoke editors. |
| Index shape | Metric strip + sticky toolbar (search + status filter) + one section per product group, richer card anatomy. |
| Grouping key | Product group (`CLI agents & TUI` / `IDE & editor` / `MITM`), stored as a new `group` field on `CLI_TOOLS` entries. `Guide` remains a badge, not a section. |
| Detail shell | Page header (logo, name, status, endpoint) → one panel of field rows → sticky action bar. |
| Implementation approach | Route-scoped kit under `cli-tools/components/ui/`, migrated in three waves. |

Deliberate deviation, approved with the design:

- **The four-metric strip is static, not `WidgetGrid`.** `WidgetGrid` uses six columns with `MIN_SPAN = 2`, so three cards fill a row and four fall into a 3 + 1 layout. The strip keeps the widget look (brand fill, 24px radius, same type scale) without drag handles or a `localStorage` layout key.

## 3. Data Sources

All client-side; no new API route, no server change.

| Source | Used for |
| --- | --- |
| `GET /api/cli-tools/all-statuses` | per-tool `{ installed, hasJRouter }` for status badges and the metric strip |
| `src/shared/constants/cliTools.js` | tool name, description, image/icon, `configType`, and the new `group` |
| `GET /api/providers` (detail) | active providers, model catalog for model mapping rows |
| `GET /api/settings`, `GET /api/tunnel/status`, `GET /api/keys` (detail) | effective base URL and the API key list |

Tools without a status getter (7 of 26) resolve to `Unknown`; they are never counted as `Not installed`. If `/api/cli-tools/all-statuses` fails, the page still renders every card with `Unknown`, and each metric shows `—` with the note `Status unavailable` instead of a fabricated `0`.

## 4. Layout

### 4.1 Index

```
.page                    flex column, gap 24px, padding-bottom 40px
├── .intro               h1 + sub (left) | gateway chip + copy (right)
├── .stats               grid: repeat(4, minmax(0,1fr)) → 2 → 1, gap 16px
│   └── 4 × .stat        radius 24px, padding 20px 24px 22px, brand fill
├── .toolbar             position sticky, top -24px, z-30, padding 12px 0, bg --canvas
│   ├── .search          type=search, 34px tall, radius --r1
│   └── .tabs            pill group: All / Connected / Needs setup / Not installed / Guide
└── section × 3          panel: radius 24px, 1px --line, bg --canvas, padding 28px
    ├── .sectionHeader   icon + h2 + count + one-line description
    └── ul.grid          grid auto-fill minmax(260px, 1fr), gap 12px
        └── li > a       ToolCard
```

### 4.2 Detail

```
.page
├── .backLink            "← CLI Tools", 12px, --text-2
├── .header              flex, gap 16px, align start
│   ├── logo 44px
│   ├── identity         h1 name (24px/500/-0.02em) · type chip · StatusBadge
│   │                    sub: tool.description (14px, --text-2)
│   └── .headerSide      endpoint chip (effective base URL + copy button)
├── .panel               radius 24px, 1px --line, bg --canvas, padding 24px
│   └── .panelBody       FieldGroup* → FieldRow*
└── .actionBar           position sticky, bottom 0, z-20, padding 12px 0
                         border-top 1px --line, background --canvas
                         left: status message | right: Manual config · Reset · Apply
```

The card no longer renders a title or a collapse chevron: the detail page is always expanded and the name lives once, in `.header`.

## 5. Visual System

Only existing tokens: `--canvas`, `--surface`, `--surface-2`, `--surface-card`, `--surface-inset`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--brand-lavender`, `--brand-ochre`, `--brand-teal`, `--brand-peach`, `--pos`, `--warn`, `--danger`, `--r1`–`--r4`, `--r-full`, `--font-mono`. No new colour values, in either theme.

Type scale follows the shipped pages: intro `clamp(28px, 3.4vw, 40px)` weight 500, `letter-spacing: -0.05em`; section `h2` 18px/600; card title 14px/600; body 13–14px; chips 11px mono uppercase with `0.08em` tracking; metric value `clamp(32px, 3.4vw, 44px)` with `font-variant-numeric: tabular-nums`.

Metric card fills:

| Metric | Fill | Text |
| --- | --- | --- |
| Connected | `--brand-teal` | white (`--on-teal` scale) |
| Needs setup | `--brand-ochre` | ink |
| Not installed | `--brand-lavender` | ink |
| Guides | `--brand-peach` | ink |

## 6. Index Specification

### 6.1 Intro

`h1` `CLI Tools`; sub `Point every coding CLI, editor and TUI at this gateway.` Right side: a single chip showing the effective gateway origin with a trailing `/v1` hint and a copy button (`aria-label="Copy gateway URL"`). The value comes from `window.location.origin` after mount; during SSR it renders the chip with `—` and hydrates to the origin, so no hydration mismatch is introduced.

### 6.2 Metric strip

| Card | Value | Unit | Note | Counts |
| --- | --- | --- | --- | --- |
| Connected | `n` | `of 26` | `routing through JRouter` | `hasJRouter === true` |
| Needs setup | `n` | — | `installed, still pointing elsewhere` | `installed && !hasJRouter` |
| Not installed | `n` | — | `not found on this machine` | `installed === false` |
| Guides | `n` | — | `manual setup, this app cannot write it` | `configType === "guide"` |

`of 26` counts `CLI_TOOLS` entries only; MITM tools are excluded from the denominator and from every metric because they are configured on the MITM page.

### 6.3 Toolbar

Left: search input, placeholder `Search tools…`, matches `name`, `description` and tool id, case-insensitive substring, trimmed. Right: `role="group"` pill set with `aria-pressed`, options `All`, `Connected`, `Needs setup`, `Not installed`, `Guide`. `All` is the default. Both controls live in one sticky row that wraps at narrow widths; the toolbar background matches the page canvas so scrolled cards disappear cleanly behind it.

Filter semantics (status key wins over config type):

1. `guide` → shown only under `Guide` and `All`.
2. `hasJRouter` → `Connected`.
3. `installed && !hasJRouter` → `Needs setup`.
4. `installed === false` → `Not installed`.
5. missing status → visible under `All` only, badge `Unknown`.

### 6.4 Sections

Order is fixed: `CLI agents & TUI` (20), `IDE & editor` (6), `MITM tools` (2). Each section header carries a material icon, the title, a muted count of the currently visible cards, and one description line. A section with zero visible cards is not rendered. `MITM tools` cards link to `/dashboard/mitm`; every other card links to `/dashboard/cli-tools/<id>`.

Group assignment is stored on the constants as `group: "cli" | "ide"` on every `CLI_TOOLS` entry — additive, so no existing consumer changes. `MITM_TOOLS` needs no field: `groupTools()` appends those entries under the `mitm` section from their own table.

### 6.5 Tool card

Anatomy: 40px logo tile (or `tool.icon` in `tool.color`), name (14px/600, single line, ellipsis, `title` attribute), description (13px `--text-2`, two-line clamp), footer row with the config-type chip and the status badge. Type chips: `env` → `Env vars`, `custom` → `Config file`, `guide` → `Guide`, `mitm` → `MITM`. Badge variants: `Connected` success with dot, `Needs setup` warning with dot, `Not installed` default, `Guide` info, `Unknown` default without dot. MITM cards show the `MITM` type chip and no status badge — they are configured on the MITM page, so a status badge there would be noise.

The whole card is one `<a>` with `height: 100%`, 16px padding, `--r3` radius and a hairline border; hover raises the border to `--line-2` and tints the background by 3% of `--text`. Focus ring: `outline: 2px solid var(--text)`, offset 2px.

### 6.6 Empty and loading states

- Loading: intro rendered, four skeleton metric cards, six skeleton tiles in a single section panel; `aria-busy="true"`.
- No matches: one panel with `No tools match` and the hint `Try another search or clear the status filter.`
- Statuses unavailable: every card shows `Unknown`, metrics show `—`, one inline notice above the sections with `--warn` tint.

## 7. Detail Specification

### 7.1 Header

`h1` is the tool name. Beside it: type chip and `StatusBadge`. Under it: `tool.description`. Right side: endpoint chip showing the effective base URL resolved exactly as today (`tunnel public URL` → `cloud URL` → `window.location.origin`) with a copy button. When `tool.requiresExternalUrl` and the resolved URL is loopback, the chip switches to the warning tint with `Loopback is not reachable from this app` and keeps the copy button.

### 7.2 Panel and fields

One panel holds the whole form. It starts with a `FieldGroup` per logical block, in this order when present: `Endpoint`, `Credentials`, `Models`, `Options`, `Advanced`. A card that has no fields (guide-only tools) renders its guide steps inside the same panel using `.sectionBlock` headings instead of field rows.

### 7.3 Action bar

Rendered by each tool card, as the last child of `.panel`, so the handlers stay local. `.panel` drops its `overflow: hidden` (it is not a scroll container) so the bar can stick. Layout: message slot (left, 13px, `--text-2`, success/warning tinted when it carries a result), then buttons right-aligned: `Manual config` (secondary, only where the card offers it today), `Reset` (secondary, only where the card offers it today), `Apply` (primary). `aria-busy` while applying. Below 640px the bar stacks: message above a full-width button row with 44px targets. Bar geometry: `position: sticky; bottom: 0`, padding `12px 0`, `background: var(--canvas)`, `border-top: 1px solid var(--line)`, negative inline margins of `-24px` with `padding-inline: 24px` so the hairline spans the panel width. `.page` keeps `padding-bottom: 40px` so the bar never covers the final field.

## 8. Field System

New presentational components in `src/app/(dashboard)/dashboard/cli-tools/components/ui/`:

| Component | Props | Renders |
| --- | --- | --- |
| `FieldRow` | `label`, `hint`, `children`, `aside` | `grid` at ≥900px: `8rem` right-aligned label, arrow glyph, control, optional trailing slot. Below 900px: stacked label above control. |
| `FieldGroup` | `title`, `description`, `children` | `.sectionBlock` with a mono uppercase heading and a hairline top border; the first group in a panel drops the border. |
| `CliToolHeader` | `tool`, `status`, `baseUrl`, `onCopy` | The page header described in §7.1. |
| `ActionBar` | `message`, `children` | The sticky bar container described in §7.3; buttons are passed as children. |
| `ToolCard` | `tool`, `statusKey`, `statusLabel`, `href` | The index card described in §6.5. |

`FieldRow` replaces all 73 hand-written `grid sm:grid-cols-[8rem_auto_1fr(_auto)]` rows. Controls (`BaseUrlSelect`, `ApiKeySelect`, `EndpointPresetControl`, `ModelSelectModal` triggers, inputs, checkboxes) are unchanged and passed as children.

## 9. Migration of the Tool Cards

Scope: the 14 cards dispatched by `ToolDetailClient` plus the two MITM components (`MitmToolCard`, `MitmServerCard`), 16 files in total. Two barrel exports — `AntigravityToolCard` and `CopilotToolCard` — are unreachable: neither `antigravity` nor `copilot` exists in `CLI_TOOLS`, and `ToolDetailClient` has no case for them (both ids fall through to `DefaultToolCard`). They are deleted as dead code rather than redesigned.

Each card follows the same recipe: drop `Card`/`styles.panel` and the header block (including `onToggle`/`isExpanded`), group the body with `FieldGroup`, convert field rows to `FieldRow`, move its buttons into `ActionBar`. `ToolDetailClient` stops passing `isExpanded`/`onToggle` and renders `CliToolHeader` once.

| Card | Field rows | Bespoke body kept |
| --- | --- | --- |
| `ClaudeToolCard` | 8 | model mapping rows, 1M-context/web-search toggles |
| `HermesToolCard` | 6 | profile selector, YAML preview |
| `CodexToolCard` | 5 | profile list, reasoning overrides |
| `GenericCliToolCard` | 5 | per-tool install command and guide steps (pi/omp/crush/forge/smelt/codewhale) |
| `OpenCodeToolCard` | 4 | provider block list |
| `OpenClawToolCard` | 4 | gateway config preview |
| `JcodeToolCard` | 4 | config preview |
| `DroidToolCard` | 4 | config preview |
| `DeepSeekTuiToolCard` | 4 | config preview |
| `ClineToolCard` | 4 | config preview |
| `KiloToolCard` | 3 | config preview |
| `GrokBuildToolCard` | 3 | config preview |
| `CoworkToolCard` | 3 | MCP registry + plugin list |
| `DefaultToolCard` | 0 | guide steps, manual-config modal |
| `MitmToolCard`, `MitmServerCard` | 0 | MITM server controls, alias editor |

Deleted, not migrated: `AntigravityToolCard.js`, `CopilotToolCard.js` (unreachable, see above).

Behaviour that must not change: which endpoint gets written, the `manualConfig` payloads, CooldownTimer/OAuth flows, MCP plugin writes, and every `/api/cli-tools/*` request body.

## 10. Group Assignment

`cli` — Claude Code, Open Claw, OpenAI Codex CLI / App, OpenCode, Claude Cowork, Hermes Agent, Factory Droid, DeepSeek TUI, jcode, Grok Build, Devin CLI, Pi, Oh My Pi, Crush, ForgeCode, Smelt, CodeWhale, Amp CLI, Qwen Code, OpenDesign (20).

`ide` — GitHub Copilot, Cursor, Cline, Kilo Code, Roo, Continue (6).

`mitm` — Antigravity, Kiro (2), already enumerated in `MITM_TOOLS`.

## 11. Responsive

| Width | Index | Detail |
| --- | --- | --- |
| > 1280px | 4-up metrics, 3-up card grid | 8rem label column, action bar inline |
| 900–1280px | 2-up metrics, 3-up cards | label column shrinks to 6rem |
| 640–900px | 2-up metrics, 2-up cards, toolbar wraps to two rows | fields stack, action bar inline |
| < 640px | 1-up metrics, 1-up cards, pill row scrolls horizontally | fields stack, action bar stacks, 44px targets, 16px input font |

The sticky toolbar keeps `top: calc(-1 * 24px)` to sit flush with the shell scroller padding, matching `.providers .toolbar`.

## 12. Accessibility

- Sections use `aria-labelledby` pointing at their `h2`; the metric strip is a labelled `<section>`.
- Search input has a visually hidden label bound with `for`/`id`; pills use `aria-pressed` inside `role="group"`.
- Copy buttons are icon-only and carry `aria-label`; the copied state is announced through the existing `useCopyToClipboard` feedback pattern.
- Focus rings: `outline: 2px solid var(--text)` with 2px offset on every interactive element in the route.
- Contrast: brand fills pair with the same text colours already verified on Providers/Endpoint; lavender, ochre and peach use ink, teal uses white.
- `prefers-reduced-motion: reduce` disables transitions on the page.

## 13. Testing & Verification

Unit (pure, `node` environment):

- `tests/unit/cli-tools-groups.test.js` — `statusOf` classification for connected / needs-setup / not-installed / guide / unknown; `countStatuses`; `filterTools` by query and status; `groupTools` ordering and membership (guide tools stay inside their product group; MITM tools excluded from the strip denominator).

Contract (source text, following `tests/unit/playground-full-chat.test.js`):

- `tests/unit/cli-tools-redesign.test.js` — index renders intro, metric strip, toolbar and three sections; no tool name is rendered inside a detail panel; `ActionBar` uses `position: sticky`; every `CLI_TOOLS` entry declares `group`; the CSS module contains no raw hex colour.

Commands:

1. `npx eslint "src/app/(dashboard)/dashboard/cli-tools/**" tests/unit/cli-tools-*.test.js`
2. `npx vitest run tests/unit/cli-tools-groups.test.js tests/unit/cli-tools-redesign.test.js`
3. `npm run build` (background; the repo build is serialised across agents and takes 15–20 minutes)
4. Runtime check on the local dev server at 1440, 1024 and 390 px, in the cream (light) and dark theme: index with statuses loaded, index with the network failed, one config-type detail page, one guide-only detail page, one MITM detail page.

## 14. Non-goals

- No new API route, no change to any `/api/cli-tools/*` handler.
- No change to save/apply payloads, file paths or written file contents.
- No change to MITM, tunnel, cloud or Tailscale resolution logic.
- No new colour tokens, fonts or icon set.
- No new drag-and-drop or persistence beyond what exists.
- No new tools added to the catalog.

## 15. Rollout

Three commits, each independently shippable and reviewable:

1. **Data + index** — `group` field, `cliToolGroups.js`, unit tests, index rewrite (`CliToolsPageClient`, `ToolCard`, metric strip, toolbar, sections).
2. **Detail shell** — `ui/` kit, `ToolDetailClient` header/panel/action bar, one representative card migrated end-to-end (`GenericCliToolCard`) plus its contract test.
3. **Card migration** — the remaining 14 tool cards plus the two MITM components, one commit per cluster (env/custom, guide-only, MITM), verifying the runtime matrix after each cluster.

Risks: the 15 cards carry OAuth, MCP and MITM side effects, so any migration step that touches a handler is out of scope — only JSX structure and class names move. A card that cannot be reduced to `FieldRow` without touching logic keeps its bespoke markup and adopts only `CliToolHeader` + `ActionBar`.
