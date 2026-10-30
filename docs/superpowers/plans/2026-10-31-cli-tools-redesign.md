# CLI Tools Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/dashboard/cli-tools` and its 15 tool detail pages onto the shipped dashboard design language, with a searchable grouped index and one consistent field/action system inside every tool card.

**Architecture:** A route-scoped UI kit (`cli-tools/components/ui/`) plus one pure data module (`cliToolGroups.js`) carry all new behaviour; the index is rebuilt on top of them, and the 17 tool/MITM card components are migrated mechanically to `FieldGroup` + `FieldRow` + `ActionBar` without touching their fetch, save or apply logic.

**Tech Stack:** Next.js App Router (client components), CSS Modules with the global token set in `src/app/globals.css`, Tailwind utilities only where already present, Vitest (node environment, source-text contract tests for JSX files).

**Spec:** `docs/superpowers/specs/2026-10-31-cli-tools-redesign-design.md`

## Global Constraints

- Only existing tokens: `--canvas`, `--surface`, `--surface-2`, `--surface-card`, `--surface-inset`, `--surface-hover`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--brand-teal`, `--brand-ochre`, `--brand-lavender`, `--brand-peach`, `--pos`, `--warn`, `--danger`, `--on-teal`, `--on-color`, `--r1`–`--r4`, `--r-full`, `--font-sans`, `--font-display`, `--font-mono`. No raw hex in `cli-tools.module.css`.
- No new API route, no change to any `/api/cli-tools/*` handler, request body, file path or written file content.
- No behaviour change to Apply / Remove / Manual config / OAuth / MCP / MITM flows; migration moves JSX and class names only.
- Status vocabulary is fixed: `Connected`, `Needs setup`, `Not installed`, `Guide`, `MITM`, `Unknown`. MITM cards carry the type chip only — no status badge, because they are configured on the MITM page.
- Git identity is already configured in this repo (`Raekhandi Yoga Gusmawan <rakha@students.amikom.ac.id>`); commit with plain `git commit -m`.
- Tests run from `tests/`: `cd tests && npx vitest run --config ./vitest.config.js unit/<file>.test.js`.
- Lint runs from the repo root: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/**" "tests/unit/cli-tools-*.test.js"`.
- Runtime check uses the already-running dev server at `http://localhost:20128` (auth cookie `auth_token` signed with `%APPDATA%/jrouter/jwt-secret`).

## File Structure

Create:

| Path | Responsibility |
| --- | --- |
| `src/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups.js` | Pure status classification, counting, filtering, grouping. No React. |
| `src/app/(dashboard)/dashboard/cli-tools/components/ui/ToolCard.js` | Index card. |
| `src/app/(dashboard)/dashboard/cli-tools/components/ui/CliToolHeader.js` | Detail page header (logo, name, chips, endpoint). |
| `src/app/(dashboard)/dashboard/cli-tools/components/ui/FieldRow.js` | One `label → control` row. |
| `src/app/(dashboard)/dashboard/cli-tools/components/ui/FieldGroup.js` | Titled group of rows. |
| `src/app/(dashboard)/dashboard/cli-tools/components/ui/ActionBar.js` | Sticky message + buttons bar. |
| `tests/unit/cli-tools-groups.test.js` | Unit tests for the pure module. |
| `tests/unit/cli-tools-redesign.test.js` | Source-text contract tests for index + detail shell. |

Modify: `CLIToolsPageClient.js`, `[toolId]/ToolDetailClient.js`, `cli-tools.module.css`, `shared/constants/cliTools.js`, `components/index.js`, and the 16 reachable card files.

Delete: `components/ToolSummaryCard.js`, `components/MitmLinkCard.js` (replaced by `ui/ToolCard.js`), `components/AntigravityToolCard.js`, `components/CopilotToolCard.js` (unreachable barrel exports).

---

### Task 1: Pure status and grouping module

**Files:**
- Create: `src/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups.js`
- Test: `tests/unit/cli-tools-groups.test.js`

**Interfaces:**
- Consumes: `CLI_TOOLS`, `MITM_TOOLS` from `@/shared/constants/cliTools`.
- Produces:
  - `TOOL_GROUPS: { key, label, icon, description }[]`
  - `STATUS_FILTERS: { value, label }[]`
  - `TYPE_LABELS: Record<"env"|"custom"|"guide"|"mitm", string>`
  - `statusOf(tool, status) → { key, label, variant, dot }` with `key` in `connected | needs-setup | not-installed | guide | mitm | unknown`
  - `countStatuses(tools, statuses) → { connected, needsSetup, notInstalled, guide, unknown }`
  - `toolEntries(tools, statuses, hrefFor) → { id, tool, status, href }[]`
  - `filterEntries(entries, { query, status }) → entries[]`
  - `groupTools(cliTools, mitmTools, statuses) → { ...TOOL_GROUPS[number], entries }[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli-tools-groups.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  STATUS_FILTERS,
  TOOL_GROUPS,
  TYPE_LABELS,
  countStatuses,
  filterEntries,
  groupTools,
  statusOf,
  toolEntries,
} from "@/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups";

const cliTools = {
  claude: { name: "Claude Code", description: "Anthropic Claude Code CLI", configType: "env", group: "cli" },
  codex: { name: "OpenAI Codex CLI", description: "OpenAI Codex CLI", configType: "custom", group: "cli" },
  droid: { name: "Factory Droid", description: "Factory Droid AI Assistant", configType: "custom", group: "cli" },
  copilot: { name: "GitHub Copilot", description: "Copilot in VS Code", configType: "guide", group: "ide" },
  cursor: { name: "Cursor", description: "Cursor AI editor", configType: "guide", group: "ide" },
};

const mitmTools = {
  antigravity: { name: "Antigravity", description: "Google Antigravity IDE", configType: "mitm" },
};

const statuses = {
  claude: { installed: true, hasJRouter: true },
  codex: { installed: true, hasJRouter: false },
  droid: { installed: false, hasJRouter: false },
};

describe("statusOf", () => {
  it("labels a configured tool as connected", () => {
    expect(statusOf(cliTools.claude, statuses.claude)).toEqual({
      key: "connected",
      label: "Connected",
      variant: "success",
      dot: true,
    });
  });

  it("labels an installed but unconfigured tool as needs setup", () => {
    expect(statusOf(cliTools.codex, statuses.codex).key).toBe("needs-setup");
  });

  it("labels a missing binary as not installed", () => {
    expect(statusOf(cliTools.droid, statuses.droid).key).toBe("not-installed");
  });

  it("lets the guide config type win over a status payload", () => {
    expect(statusOf(cliTools.copilot, { installed: true, hasJRouter: false }).key).toBe("guide");
  });

  it("labels a MITM tool as MITM instead of unknown", () => {
    expect(statusOf(mitmTools.antigravity, undefined).key).toBe("mitm");
  });

  it("reports unknown when no status was returned", () => {
    expect(statusOf(cliTools.claude, null).key).toBe("unknown");
  });
});

describe("countStatuses", () => {
  it("counts each bucket and excludes guide tools from installed buckets", () => {
    expect(countStatuses(cliTools, statuses)).toEqual({
      connected: 1,
      needsSetup: 1,
      notInstalled: 1,
      guide: 2,
      unknown: 0,
    });
  });
});

describe("filterEntries", () => {
  const entries = toolEntries(cliTools, statuses, (id) => `/dashboard/cli-tools/${id}`);

  it("matches name, description and id case-insensitively", () => {
    expect(filterEntries(entries, { query: "COPILOT", status: "all" }).map((e) => e.id)).toEqual(["copilot"]);
    expect(filterEntries(entries, { query: "anthropic", status: "all" }).map((e) => e.id)).toEqual(["claude"]);
    expect(filterEntries(entries, { query: "codex", status: "all" }).map((e) => e.id)).toEqual(["codex"]);
  });

  it("keeps only entries whose status key matches the filter", () => {
    expect(filterEntries(entries, { query: "", status: "needs-setup" }).map((e) => e.id)).toEqual(["codex"]);
    expect(filterEntries(entries, { query: "", status: "guide" }).map((e) => e.id)).toEqual(["copilot", "cursor"]);
  });

  it("treats a blank query and the all filter as no-op", () => {
    expect(filterEntries(entries, { query: "   ", status: "all" })).toHaveLength(5);
  });
});

describe("groupTools", () => {
  it("returns the three groups in fixed order with membership resolved", () => {
    const groups = groupTools(cliTools, mitmTools, statuses);
    expect(groups.map((g) => g.key)).toEqual(["cli", "ide", "mitm"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["claude", "codex", "droid"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["copilot", "cursor"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["antigravity"]);
  });

  it("points MITM cards at the MITM page and everything else at a tool page", () => {
    const groups = groupTools(cliTools, mitmTools, statuses);
    expect(groups[2].entries[0].href).toBe("/dashboard/mitm");
    expect(groups[0].entries[0].href).toBe("/dashboard/cli-tools/claude");
  });

  it("falls back to the cli group when a tool declares no group", () => {
    const groups = groupTools({ loose: { name: "Loose", description: "", configType: "custom" } }, {}, {});
    expect(groups[0].entries.map((e) => e.id)).toEqual(["loose"]);
  });
});

describe("static tables", () => {
  it("exposes the five status filters", () => {
    expect(STATUS_FILTERS.map((f) => f.value)).toEqual(["all", "connected", "needs-setup", "not-installed", "guide"]);
  });

  it("exposes the three group descriptors", () => {
    expect(TOOL_GROUPS.map((g) => g.label)).toEqual(["CLI agents & TUI", "IDE & editor", "MITM tools"]);
  });

  it("maps every config type to a chip label", () => {
    expect(TYPE_LABELS).toEqual({ env: "Env vars", custom: "Config file", guide: "Guide", mitm: "MITM" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js`
Expected: FAIL — `Failed to resolve import "@/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups"`.

- [ ] **Step 3: Write the module**

Create `src/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups.js`:

```js
// Pure helpers behind the CLI Tools index: status classification, counting,
// filtering and product grouping. No React, no I/O — unit-tested directly.

export const TOOL_GROUPS = [
  {
    key: "cli",
    label: "CLI agents & TUI",
    icon: "terminal",
    description: "Terminal agents, TUIs and desktop assistants that read a config file or env vars.",
  },
  {
    key: "ide",
    label: "IDE & editor",
    icon: "code",
    description: "Extensions and editors that call the gateway from their own settings.",
  },
  {
    key: "mitm",
    label: "MITM tools",
    icon: "security",
    description: "IDEs intercepted at the network layer — configure them on the MITM page.",
  },
];

export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "needs-setup", label: "Needs setup" },
  { value: "not-installed", label: "Not installed" },
  { value: "guide", label: "Guide" },
];

export const TYPE_LABELS = {
  env: "Env vars",
  custom: "Config file",
  guide: "Guide",
  mitm: "MITM",
};

const COUNT_KEYS = {
  connected: "connected",
  "needs-setup": "needsSetup",
  "not-installed": "notInstalled",
  guide: "guide",
  mitm: "unknown",
  unknown: "unknown",
};

/** Classifies one tool. Guides and MITM tools need no status payload. */
export function statusOf(tool, status) {
  if (tool?.configType === "guide") {
    return { key: "guide", label: "Guide", variant: "info", dot: false };
  }
  if (tool?.configType === "mitm") {
    return { key: "mitm", label: "MITM", variant: "default", dot: false };
  }
  if (!status) {
    return { key: "unknown", label: "Unknown", variant: "default", dot: false };
  }
  if (status.installed === false) {
    return { key: "not-installed", label: "Not installed", variant: "default", dot: false };
  }
  if (status.hasJRouter) {
    return { key: "connected", label: "Connected", variant: "success", dot: true };
  }
  return { key: "needs-setup", label: "Needs setup", variant: "warning", dot: true };
}

/** Metric strip buckets. MITM tools are not part of this denominator. */
export function countStatuses(tools, statuses) {
  const counts = { connected: 0, needsSetup: 0, notInstalled: 0, guide: 0, unknown: 0 };
  for (const [id, tool] of Object.entries(tools || {})) {
    counts[COUNT_KEYS[statusOf(tool, statuses?.[id]).key]] += 1;
  }
  return counts;
}

export function toolEntries(tools, statuses, hrefFor) {
  return Object.entries(tools || {}).map(([id, tool]) => ({
    id,
    tool,
    status: statusOf(tool, statuses?.[id]),
    href: hrefFor(id),
  }));
}

export function filterEntries(entries, { query = "", status = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return entries.filter(({ id, tool, status: toolStatus }) => {
    if (status !== "all" && toolStatus.key !== status) return false;
    if (!needle) return true;
    return (
      String(tool.name || "").toLowerCase().includes(needle) ||
      String(tool.description || "").toLowerCase().includes(needle) ||
      id.toLowerCase().includes(needle)
    );
  });
}

export function groupTools(cliTools, mitmTools, statuses) {
  const cliEntries = toolEntries(cliTools, statuses, (id) => `/dashboard/cli-tools/${id}`);
  const mitmEntries = toolEntries(mitmTools, statuses, () => "/dashboard/mitm");
  const buckets = { cli: [], ide: [], mitm: mitmEntries };
  for (const entry of cliEntries) {
    buckets[entry.tool.group === "ide" ? "ide" : "cli"].push(entry);
  }
  return TOOL_GROUPS.map((group) => ({ ...group, entries: buckets[group.key] || [] }));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups.js" tests/unit/cli-tools-groups.test.js
git commit -m "feat(cli-tools): add pure status, filter and grouping helpers"
```

---

### Task 2: Declare the product group on every tool

**Files:**
- Modify: `src/shared/constants/cliTools.js` (26 `CLI_TOOLS` entries)
- Modify: `tests/unit/cli-tools-groups.test.js` (append a completeness block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CLI_TOOLS[id].group` is `"cli"` or `"ide"` for every entry; `groupTools` therefore never relies on the fallback in production.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/cli-tools-groups.test.js`:

```js
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";

describe("catalog groups", () => {
  it("declares a valid group on every CLI tool", () => {
    const invalid = Object.entries(CLI_TOOLS)
      .filter(([, tool]) => tool.group !== "cli" && tool.group !== "ide")
      .map(([id]) => id);
    expect(invalid).toEqual([]);
  });

  it("keeps the approved group counts", () => {
    const cli = Object.values(CLI_TOOLS).filter((tool) => tool.group === "cli");
    const ide = Object.values(CLI_TOOLS).filter((tool) => tool.group === "ide");
    expect(cli).toHaveLength(20);
    expect(ide).toHaveLength(6);
    expect(Object.keys(MITM_TOOLS)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js`
Expected: FAIL — `invalid` contains all 26 ids.

- [ ] **Step 3: Add `group` to each constant**

For every entry in `CLI_TOOLS`, add one property line directly after `configType`:

- `group: "cli"` — claude, openclaw, codex, opencode, cowork, hermes, droid, deepseek-tui, jcode, grok-build, devin, pi, omp, crush, forge, smelt, codewhale, amp, qwen, opendesign (20).
- `group: "ide"` — copilot, cursor, cline, kilo, roo, continue (6).

Example shape:

```js
  claude: {
    id: "claude",
    name: "Claude Code",
    image: "/providers/claude.png",
    color: "#D97757",
    description: "Anthropic Claude Code CLI",
    configType: "env",
    group: "cli",
    envVars: {
```

Do not touch `MITM_TOOLS`; the MITM section is built from that table directly.

- [ ] **Step 4: Run the tests**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/constants/cliTools.js tests/unit/cli-tools-groups.test.js
git commit -m "feat(cli-tools): tag every catalog entry with its product group"
```

---

### Task 3: Rebuild the index page

**Files:**
- Create: `src/app/(dashboard)/dashboard/cli-tools/components/ui/ToolCard.js`
- Modify: `src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js` (full rewrite)
- Modify: `src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css` (add index classes, delete the tile classes)
- Delete: `components/ToolSummaryCard.js`, `components/MitmLinkCard.js`; remove their exports from `components/index.js`

**Interfaces:**
- Consumes: `TOOL_GROUPS`, `STATUS_FILTERS`, `TYPE_LABELS`, `countStatuses`, `filterEntries`, `groupTools` from Task 1.
- Produces: `ToolCard({ tool, status, href })`; CSS classes `.intro`, `.introTitle`, `.introSub`, `.gateway`, `.metrics`, `.metric`, `.toneTeal|toneOchre|toneLavender|tonePeach`, `.toolbar`, `.searchInput`, `.tabs`, `.tab`, `.section`, `.sectionHeader`, `.gridList`, `.toolCard`, `.typeChip`.

- [ ] **Step 1: Add the index CSS**

Append to `cli-tools.module.css` and delete the now-unused rules `.group`, `.groupHeader`, `.toolLink`, `.tile`, `.toolIcon`, `.identity`, `.titleLine`, `.chevron`, `.infoStatus`, `.grid`. Keep `.title`, `.description`, `.status`, `.page`, `.backLink`, `.detailHeader`, `.panel`, `.panelHeader`, `.body` and `.configuration` — the detail page and the not-yet-migrated cards still use them. The rewritten client uses `.gridList`, so `.grid` has no remaining consumer.

```css
/* Index: intro ---------------------------------------------------------- */

.intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  min-width: 0;
}

.introText {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.introTitle {
  color: var(--text);
  font-size: clamp(28px, 3.4vw, 40px);
  font-weight: 500;
  letter-spacing: -0.05em;
  line-height: 1.1;
}

.introSub {
  color: var(--text-2);
  font-size: 16px;
  line-height: 1.55;
  max-width: 60ch;
}

.gateway {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  max-width: 100%;
  padding: 0 6px 0 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 12px;
}

.gatewayValue {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gatewayHint {
  color: var(--text-3);
}

.gatewayCopy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.gatewayCopy:hover {
  color: var(--text);
  background: var(--surface-hover);
}

/* Index: metric strip --------------------------------------------------- */

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  min-width: 0;
}

.metric {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 148px;
  padding: 20px 24px 22px;
  border-radius: var(--r4);
}

.metricValue {
  margin: auto 0 0;
  font-family: var(--font-display);
  font-size: clamp(32px, 3.4vw, 44px);
  font-weight: 500;
  letter-spacing: -0.05em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.metricUnit {
  margin-left: 6px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  opacity: 0.8;
}

.metricNote {
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  opacity: 0.85;
  overflow-wrap: anywhere;
}

.toneTeal {
  background: var(--brand-teal);
  color: var(--on-teal);
}

.toneOchre {
  background: var(--brand-ochre);
  color: var(--on-color);
}

.toneLavender {
  background: var(--brand-lavender);
  color: var(--on-color);
}

.tonePeach {
  background: var(--brand-peach);
  color: var(--on-color);
}

/* Index: sticky toolbar ------------------------------------------------ */

.toolbar {
  position: sticky;
  top: calc(-1 * 24px);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 0;
  background: var(--canvas);
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.searchIcon {
  position: absolute;
  left: 10px;
  color: var(--text-3);
  font-size: 16px;
  pointer-events: none;
}

.searchInput {
  height: 34px;
  width: min(320px, 60vw);
  padding: 0 12px 0 32px;
  border: 1px solid var(--line-2);
  border-radius: var(--r1);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
}

.searchInput::placeholder {
  color: var(--text-3);
}

.tabs {
  display: inline-flex;
  gap: 2px;
  max-width: 100%;
  padding: 4px;
  border-radius: var(--r-full);
  background: var(--surface-2);
}

.tab {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--text-3);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms, color 150ms;
}

.tab:hover {
  color: var(--text);
}

.tab[aria-pressed="true"] {
  background: var(--canvas);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--line);
}

/* Index: sections and cards -------------------------------------------- */

.section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: var(--r4);
  background: var(--canvas);
}

.sectionHeader {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.sectionIcon {
  flex: none;
  color: var(--text-2);
  font-size: 18px;
}

.sectionHeading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sectionTitleRow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sectionTitle {
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.sectionCount {
  color: var(--text-3);
  font-size: 13px;
  font-weight: 500;
}

.sectionDescription {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
}

.gridList {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.toolCard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  transition: background-color 150ms, border-color 150ms;
}

.toolCard:hover {
  border-color: var(--line-2);
  background: color-mix(in srgb, var(--text) 3%, var(--surface));
}

.toolCard:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

.toolHead {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.toolLogo {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--r2);
  background: var(--surface-2);
}

.toolLogoImage {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.toolLogoIcon {
  font-size: 22px;
}

.toolIdentity {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.toolName {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.toolDescription {
  display: -webkit-box;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.toolFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}

.typeChip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: var(--r4);
  background: var(--canvas);
  text-align: center;
}

.emptyTitle {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.emptyHint {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 1023px) {
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .metrics {
    grid-template-columns: minmax(0, 1fr);
  }

  .section {
    padding: 16px;
  }

  .search {
    width: 100%;
  }

  .searchInput {
    width: 100%;
    height: 44px;
    font-size: 16px;
  }

  .tabs {
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    height: 40px;
  }
}
```

- [ ] **Step 2: Add the card component**

Create `src/app/(dashboard)/dashboard/cli-tools/components/ui/ToolCard.js`:

```jsx
"use client";

import Image from "next/image";
import Link from "next/link";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import { TYPE_LABELS } from "../cliToolGroups";
import styles from "../../cli-tools.module.css";

/** One tool tile on the CLI Tools index. The whole card is the link. */
export default function ToolCard({ tool, status, href }) {
  return (
    <Link href={href} className={styles.toolCard}>
      <span className={styles.toolHead}>
        <span className={styles.toolLogo}>
          {tool.image ? (
            <Image
              src={tool.image}
              alt=""
              width={28}
              height={28}
              className={styles.toolLogoImage}
              sizes="28px"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : (
            <Icon
              className={styles.toolLogoIcon}
              style={tool.color ? { color: tool.color } : undefined}
            >
              {tool.icon || "terminal"}
            </Icon>
          )}
        </span>
        <span className={styles.toolIdentity}>
          <span className={styles.toolName} title={tool.name}>{tool.name}</span>
          <span className={styles.toolDescription} title={tool.description}>{tool.description}</span>
        </span>
      </span>
      <span className={styles.toolFoot}>
        <span className={styles.typeChip}>{TYPE_LABELS[tool.configType] || TYPE_LABELS.custom}</span>
        {status.key === "mitm" ? null : (
          <StatusBadge variant={status.variant} dot={status.dot} className={styles.status}>
            {status.label}
          </StatusBadge>
        )}
      </span>
    </Link>
  );
}
```

- [ ] **Step 3: Rewrite the index client**

Replace the whole of `CLIToolsPageClient.js`:

```jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/shared/components/Icon";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  STATUS_FILTERS,
  countStatuses,
  filterEntries,
  groupTools,
} from "./components/cliToolGroups";
import ToolCard from "./components/ui/ToolCard";
import styles from "./cli-tools.module.css";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

const METRICS = [
  { key: "connected", tone: "toneTeal", label: "Connected", note: "routing through JRouter" },
  { key: "needsSetup", tone: "toneOchre", label: "Needs setup", note: "installed, still pointing elsewhere" },
  { key: "notInstalled", tone: "toneLavender", label: "Not installed", note: "not found on this machine" },
  { key: "guide", tone: "tonePeach", label: "Guides", note: "manual setup, this app cannot write it" },
];

export default function CLIToolsPageClient() {
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState({});
  const [statusError, setStatusError] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [origin, setOrigin] = useState("");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setStatuses(data || {});
      } catch (error) {
        console.log("Error fetching tool statuses:", error);
        if (mounted) setStatusError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const totalTools = Object.keys(CLI_TOOLS).length;
  const counts = useMemo(() => countStatuses(CLI_TOOLS, statuses), [statuses]);
  const groups = useMemo(() => groupTools(CLI_TOOLS, MITM_TOOLS, statuses), [statuses]);
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, entries: filterEntries(group.entries, { query, status: filter }) }))
        .filter((group) => group.entries.length > 0),
    [groups, query, filter],
  );
  const gateway = origin ? `${origin}/v1` : "";

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.introTitle}>CLI Tools</h1>
          <p className={styles.introSub}>
            Point every coding CLI, editor and TUI at this gateway. Each tool reads one config file or
            env block — JRouter writes it for you, or hands you the snippet.
          </p>
        </div>
        <div className={styles.gateway}>
          <span className={styles.gatewayValue} title={gateway}>{gateway || "—"}</span>
          <span className={styles.gatewayHint}>/v1</span>
          <button
            type="button"
            className={styles.gatewayCopy}
            onClick={() => copy(gateway, "gateway")}
            disabled={!gateway}
            aria-label="Copy gateway URL"
          >
            <Icon className="text-[16px]">{copied === "gateway" ? "check" : "content_copy"}</Icon>
          </button>
        </div>
      </header>

      <section className={styles.metrics} aria-label="Tool status summary">
        {METRICS.map((metric) => (
          <div key={metric.key} className={`${styles.metric} ${styles[metric.tone]}`}>
            <p className={styles.metricValue}>
              {loading || statusError ? "—" : counts[metric.key]}
              {metric.key === "connected" ? (
                <small className={styles.metricUnit}>of {totalTools}</small>
              ) : null}
            </p>
            <p className={styles.metricNote}>
              {statusError ? "Status unavailable" : metric.note}
            </p>
          </div>
        ))}
      </section>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Icon className={styles.searchIcon} aria-hidden="true">search</Icon>
          <input
            id="cli-tool-search"
            type="search"
            className={styles.searchInput}
            placeholder="Search tools…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search tools"
          />
        </div>
        <div className={styles.tabs} role="group" aria-label="Filter tools by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.tab}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {statusError ? (
        <div className={`${styles.notice} ${styles.warning}`}>
          Tool statuses could not be read. Every card is listed below without a status.
        </div>
      ) : null}

      {!loading && visibleGroups.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No tools match</p>
          <p className={styles.emptyHint}>Try another search or clear the status filter.</p>
        </div>
      ) : null}

      {loading ? (
        <section className={styles.section} aria-busy="true" aria-label="Loading CLI tools">
          <ul className={styles.gridList}>
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index}>
                <div className={styles.toolCard}>
                  <span className={styles.toolHead}>
                    <span className={styles.toolLogo} />
                    <span className={styles.toolIdentity}>
                      <span className={styles.toolName}>Loading…</span>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        visibleGroups.map((group) => (
          <section key={group.key} className={styles.section} aria-labelledby={`group-${group.key}`}>
            <div className={styles.sectionHeader}>
              <Icon className={styles.sectionIcon} aria-hidden="true">{group.icon}</Icon>
              <div className={styles.sectionHeading}>
                <div className={styles.sectionTitleRow}>
                  <h2 id={`group-${group.key}`} className={styles.sectionTitle}>{group.label}</h2>
                  <span className={styles.sectionCount}>{group.entries.length}</span>
                </div>
                <p className={styles.sectionDescription}>{group.description}</p>
              </div>
            </div>
            <ul className={styles.gridList}>
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <ToolCard tool={entry.tool} status={entry.status} href={entry.href} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete the superseded components**

```bash
git rm "src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.js" "src/app/(dashboard)/dashboard/cli-tools/components/MitmLinkCard.js"
```

Remove these two lines from `components/index.js`:

```js
export { default as MitmLinkCard } from "./MitmLinkCard";
```

and delete `ToolSummaryCard`'s export line if present (it is imported by path today, not through the barrel).

- [ ] **Step 5: Lint and run the pure tests**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/**"`
Expected: no errors.

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js`
Expected: PASS — 17 tests.

- [ ] **Step 6: Check the page in the browser**

Open `http://localhost:20128/dashboard/cli-tools`. Confirm: intro renders with the gateway chip, four coloured metric cards, sticky toolbar, three sections with counts, search narrows the grid, pills switch status. Toggle the theme (light/dark) and confirm the metric fills keep ink-on-lavender / white-on-teal.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools" src/shared/constants/cliTools.js
git commit -m "feat(cli-tools): rebuild the index with metrics, search, filters and sections"
```

---

### Task 4: Lock the index contract with a test

**Files:**
- Test: `tests/unit/cli-tools-redesign.test.js`

**Interfaces:**
- Consumes: the files written in Tasks 1–3.
- Produces: a source-text contract suite that later tasks extend.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli-tools-redesign.test.js`:

```js
/**
 * CLI Tools redesign — source-text contracts.
 *
 * The page and card files are JSX, so Vitest (node environment, no JSX
 * transform) cannot import them. These tests read the sources and assert the
 * structural promises the design makes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ROUTE = "src/app/(dashboard)/dashboard/cli-tools";

describe("CLI Tools index", () => {
  const page = read(`${ROUTE}/CLIToolsPageClient.js`);

  it("renders an intro, a metric strip and the sticky toolbar", () => {
    expect(page).toContain("styles.introTitle");
    expect(page).toContain("styles.metrics");
    expect(page).toContain("styles.toolbar");
  });

  it("renders search and status pills wired to state", () => {
    expect(page).toContain('type="search"');
    expect(page).toContain("aria-pressed={filter === option.value}");
    expect(page).toContain("setQuery");
  });

  it("renders one section per visible group", () => {
    expect(page).toContain("visibleGroups.map((group)");
    expect(page).toContain("styles.gridList");
    expect(page).toContain("<ToolCard");
  });

  it("keeps the toolbar pinned and the card grid fluid in CSS", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css).toContain("position: sticky");
    expect(css).toContain("repeat(auto-fill, minmax(260px, 1fr))");
  });

  it("uses only tokens for the metric fills", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css).toContain("background: var(--brand-teal)");
    expect(css).toContain("background: var(--brand-ochre)");
    expect(css).toContain("background: var(--brand-lavender)");
    expect(css).toContain("background: var(--brand-peach)");
  });

  it("keeps the stylesheet free of raw hex colours", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("no longer ships the old summary cards", () => {
    expect(() => read(`${ROUTE}/components/ToolSummaryCard.js`)).toThrow();
    expect(() => read(`${ROUTE}/components/MitmLinkCard.js`)).toThrow();
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-redesign.test.js`
Expected: PASS — 7 tests. If the hex assertion fails, replace the offending colour with the nearest token before continuing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/cli-tools-redesign.test.js
git commit -m "test(cli-tools): cover the index redesign contracts"
```

---

### Task 5: Field row and field group primitives

**Files:**
- Create: `components/ui/FieldRow.js`, `components/ui/FieldGroup.js`
- Modify: `cli-tools.module.css` (append field classes)

**Interfaces:**
- Produces:
  - `FieldRow({ label, hint, aside, className, children })`
  - `FieldGroup({ title, description, children })`
  - CSS `.field`, `.fieldWithAside`, `.fieldLabel`, `.fieldArrow`, `.fieldControl`, `.fieldAside`, `.fieldHint`, `.fieldGroup`, `.fieldGroupHeader`, `.fieldGroupTitle`, `.fieldGroupDescription`, `.currentValue`.

- [ ] **Step 1: Add the CSS**

Append to `cli-tools.module.css`:

```css
/* Detail: field rows ---------------------------------------------------- */

.field {
  display: grid;
  grid-template-columns: 8rem auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 0;
}

.fieldWithAside {
  grid-template-columns: 8rem auto minmax(0, 1fr) auto;
}

.fieldLabel {
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-align: right;
  overflow-wrap: anywhere;
}

.fieldArrow {
  color: var(--text-3);
  font-size: 14px;
}

.fieldControl {
  min-width: 0;
}

.fieldAside {
  min-width: 0;
}

.fieldHint {
  grid-column: 3 / -1;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.45;
}

.currentValue {
  display: block;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--r1);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 16px 0;
  border-top: 1px solid var(--line);
}

.fieldGroup:first-child {
  padding-top: 0;
  border-top: 0;
}

.fieldGroupHeader {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 4px;
}

.fieldGroupTitle {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.fieldGroupDescription {
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 899px) {
  .field,
  .fieldWithAside {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .fieldLabel {
    text-align: left;
  }

  .fieldArrow {
    display: none;
  }

  .fieldHint {
    grid-column: auto;
  }
}
```

- [ ] **Step 2: Add the components**

Create `components/ui/FieldRow.js`:

```jsx
"use client";

import Icon from "@/shared/components/Icon";
import { cn } from "@/shared/utils/cn";
import styles from "../../cli-tools.module.css";

/**
 * One settings row: right-aligned label, arrow, control, optional trailing slot.
 * Below 900px the row stacks label-over-control.
 */
export default function FieldRow({ label, hint, aside, className, children }) {
  const withAside = Boolean(aside);
  return (
    <div className={cn(styles.field, withAside && styles.fieldWithAside, className)}>
      <span className={styles.fieldLabel}>{label}</span>
      <Icon className={styles.fieldArrow} aria-hidden="true">arrow_forward</Icon>
      <div className={styles.fieldControl}>{children}</div>
      {withAside ? <div className={styles.fieldAside}>{aside}</div> : null}
      {hint ? <p className={styles.fieldHint}>{hint}</p> : null}
    </div>
  );
}
```

Create `components/ui/FieldGroup.js`:

```jsx
"use client";

import styles from "../../cli-tools.module.css";

/** A titled block of field rows inside a tool panel. */
export default function FieldGroup({ title, description, children }) {
  return (
    <section className={styles.fieldGroup}>
      {title ? (
        <header className={styles.fieldGroupHeader}>
          <h2 className={styles.fieldGroupTitle}>{title}</h2>
          {description ? <p className={styles.fieldGroupDescription}>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components/ui"`
Expected: no errors. Unused-import failures are not possible yet; both files are self-contained.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components/ui" "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css"
git commit -m "feat(cli-tools): add FieldRow and FieldGroup primitives"
```

---

### Task 6: Detail header and sticky action bar

**Files:**
- Create: `components/ui/CliToolHeader.js`, `components/ui/ActionBar.js`
- Modify: `cli-tools.module.css` (header, endpoint chip, action bar; drop `.panel { overflow: hidden }`)

**Interfaces:**
- Produces:
  - `CliToolHeader({ tool, status, baseUrl })`
  - `ActionBar({ message, tone, busy, children })` with `tone` in `"neutral" | "success" | "danger"`.
  - CSS `.detailHeader`, `.detailIdentity`, `.detailLogo`, `.detailLogoImage`, `.detailLogoIcon`, `.detailText`, `.detailTitleRow`, `.endpointChip`, `.endpointValue`, `.endpointCopy`, `.actionBar`, `.actionMessage`, `.actionSuccess`, `.actionDanger`, `.actionButtons`.

- [ ] **Step 1: Rewrite the detail header CSS**

Replace the existing `.detailHeader` rule in `cli-tools.module.css`:

```css
.detailHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  min-width: 0;
}

.detailIdentity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.detailLogo {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: var(--r2);
  background: var(--surface-2);
}

.detailLogoImage {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.detailLogoIcon {
  font-size: 24px;
}

.detailText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.detailTitleRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.endpointChip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  height: 34px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 12px;
}

.endpointValue {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.endpointCopy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.endpointCopy:hover {
  color: var(--text);
  background: var(--surface-hover);
}
```

Add the action bar CSS and drop `overflow: hidden` from `.panel`:

```css
.actionBar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px -24px -24px;
  padding: 12px 24px;
  border-top: 1px solid var(--line);
  background: var(--canvas);
}

.actionMessage {
  margin: 0;
  min-width: 0;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.actionSuccess {
  color: var(--pos);
}

.actionDanger {
  color: var(--danger);
}

.actionButtons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

@media (max-width: 639px) {
  .actionBar {
    margin: 16px -16px -16px;
    padding: 12px 16px;
  }

  .actionButtons {
    width: 100%;
  }

  .actionButtons > * {
    flex: 1 1 auto;
    min-height: 44px;
  }
}
```

`.panel` becomes:

```css
.panel {
  composes: section from "../usage/usage.module.css";
  box-shadow: none;
}
```

- [ ] **Step 2: Add the components**

Create `components/ui/CliToolHeader.js`:

```jsx
"use client";

import Image from "next/image";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TYPE_LABELS } from "../cliToolGroups";
import styles from "../../cli-tools.module.css";

/** Detail page header: identity once, status once, endpoint with copy. */
export default function CliToolHeader({ tool, status, baseUrl }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailIdentity}>
        <span className={styles.detailLogo}>
          {tool.image ? (
            <Image
              src={tool.image}
              alt=""
              width={30}
              height={30}
              className={styles.detailLogoImage}
              sizes="30px"
              priority
            />
          ) : (
            <Icon
              className={styles.detailLogoIcon}
              style={tool.color ? { color: tool.color } : undefined}
            >
              {tool.icon || "terminal"}
            </Icon>
          )}
        </span>
        <div className={styles.detailText}>
          <div className={styles.detailTitleRow}>
            <h1 className={styles.title}>{tool.name}</h1>
            <span className={styles.typeChip}>{TYPE_LABELS[tool.configType] || TYPE_LABELS.custom}</span>
            <StatusBadge variant={status.variant} dot={status.dot}>{status.label}</StatusBadge>
          </div>
          <p className={styles.description}>{tool.description}</p>
        </div>
      </div>
      <div className={styles.endpointChip}>
        <span className={styles.endpointValue} title={baseUrl}>{baseUrl || "—"}</span>
        <button
          type="button"
          className={styles.endpointCopy}
          onClick={() => copy(baseUrl, "endpoint")}
          disabled={!baseUrl}
          aria-label="Copy gateway URL"
        >
          <Icon className="text-[16px]">{copied === "endpoint" ? "check" : "content_copy"}</Icon>
        </button>
      </div>
    </header>
  );
}
```

Create `components/ui/ActionBar.js`:

```jsx
"use client";

import { cn } from "@/shared/utils/cn";
import styles from "../../cli-tools.module.css";

/**
 * Sticky footer of a tool panel. The owning card passes its own handlers as
 * children so no state leaves the card.
 */
export default function ActionBar({ message, tone = "neutral", busy = false, children }) {
  return (
    <div className={styles.actionBar} aria-busy={busy ? "true" : "false"}>
      <p
        className={cn(
          styles.actionMessage,
          tone === "success" && styles.actionSuccess,
          tone === "danger" && styles.actionDanger,
        )}
      >
        {message || ""}
      </p>
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components/ui"`
Expected: no errors.

- [ ] **Step 4: Verify the sticky bar prerequisites**

Run: `grep -n "overflow" "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css"`
Expected: `.panel` no longer declares `overflow: hidden`; the only remaining `overflow` declarations are `text-overflow`/`overflow: hidden` on text truncation rules and `overflow: auto` on `.configuration pre`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components/ui" "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css"
git commit -m "feat(cli-tools): add detail header and sticky action bar"
```

---

### Task 7: Rewrite the detail page shell

**Files:**
- Modify: `[toolId]/ToolDetailClient.js` (header, panel, status fetch; drop `isExpanded`/`onToggle` from `commonProps`)

**Interfaces:**
- Consumes: `CliToolHeader`, `statusOf`.
- Produces: `commonProps = { tool, baseUrl, apiKeys, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }` — every card must drop `isExpanded` and `onToggle` from its signature in Tasks 8–12.

- [ ] **Step 1: Add the status fetch and header**

In `ToolDetailClient.js`, add these imports:

```js
import CliToolHeader from "./components/ui/CliToolHeader";
import { statusOf } from "./components/cliToolGroups";
```

Add state and effect next to the existing ones:

```js
  const [toolStatus, setToolStatus] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/cli-tools/${toolId}-settings`);
        const data = res.ok ? await res.json() : null;
        if (active) setToolStatus(data);
      } catch {
        if (active) setToolStatus(null);
      }
    })();
    return () => { active = false; };
  }, [toolId]);
```

- [ ] **Step 2: Drop the collapse props from `commonProps`**

Replace:

```js
    const commonProps = {
      tool,
      isExpanded: true,
      onToggle: () => {},
      baseUrl: getBaseUrl(),
      apiKeys,
      tunnelEnabled,
      tunnelPublicUrl,
      tailscaleEnabled,
      tailscaleUrl,
    };
```

with:

```js
    const commonProps = {
      tool,
      baseUrl: getBaseUrl(),
      apiKeys,
      tunnelEnabled,
      tunnelPublicUrl,
      tailscaleEnabled,
      tailscaleUrl,
    };
```

- [ ] **Step 3: Replace the render body**

Replace both return blocks (the `!tool` guard and the main return) with:

```jsx
  if (!tool) {
    return (
      <div className={styles.page}>
        <Link href="/dashboard/cli-tools" className={styles.backLink}>
          <Icon className="text-[18px]">arrow_back</Icon>
          Back to CLI Tools
        </Link>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Tool not found or disabled</p>
          <p className={styles.emptyHint}>Pick another tool from the CLI Tools page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link href="/dashboard/cli-tools" className={styles.backLink}>
        <Icon className="text-[18px]">arrow_back</Icon>
        Back to CLI Tools
      </Link>
      {loading ? (
        <CardSkeleton />
      ) : (
        <>
          <CliToolHeader tool={tool} status={statusOf(tool, toolStatus)} baseUrl={getBaseUrl()} />
          <section className={`${styles.panel} ${styles.configuration}`}>
            {renderToolCard()}
          </section>
        </>
      )}
    </div>
  );
```

- [ ] **Step 4: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js"`
Expected: no errors. Cards still accept `isExpanded`/`onToggle` at this point — they are simply no longer passed, and Task 8 removes them from the signatures.

- [ ] **Step 5: Browser check**

Open `http://localhost:20128/dashboard/cli-tools/claude`. Expected: one title (in the header), type chip, status badge, endpoint chip with copy. The card below still renders its own old header until Task 8 — that duplication is expected at this checkpoint.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js"
git commit -m "feat(cli-tools): render one detail header and one panel per tool page"
```

---

### Task 8: Migrate `GenericCliToolCard` end to end

**Files:**
- Modify: `components/GenericCliToolCard.js`
- Modify: `tests/unit/cli-tools-redesign.test.js` (append detail-shell contracts)

**Interfaces:**
- Consumes: `FieldGroup`, `FieldRow`, `ActionBar`.
- Produces: the canonical migration shape every other card copies.

- [ ] **Step 1: Extend the contract test**

Append to `tests/unit/cli-tools-redesign.test.js`:

```js
describe("CLI Tools detail shell", () => {
  const detail = read(`${ROUTE}/[toolId]/ToolDetailClient.js`);

  it("renders exactly one header component and one panel", () => {
    expect(detail).toContain("<CliToolHeader");
    expect(detail.match(/styles\.panel\b/g)).toHaveLength(1);
    expect(detail).not.toContain("styles.detailHeader");
  });

  it("no longer passes collapse props to the cards", () => {
    expect(detail).not.toContain("isExpanded");
    expect(detail).not.toContain("onToggle");
  });

  it("has a sticky action bar and no sticky-breaking panel overflow", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    const actionBar = css.slice(css.indexOf(".actionBar {"), css.indexOf(".actionMessage"));
    expect(actionBar).toContain("position: sticky");
    const panel = css.slice(css.indexOf(".panel {"), css.indexOf(".panelHeader {"));
    expect(panel).not.toContain("overflow: hidden");
  });

  it("migrated cards render no panel header and no collapse chevron", () => {
    const migrated = [
      "GenericCliToolCard",
    ];
    for (const name of migrated) {
      const source = read(`${ROUTE}/components/${name}.js`);
      expect(source).not.toContain("styles.panelHeader");
      expect(source).not.toContain("expand_more");
    }
  });
});
```

- [ ] **Step 2: Run it and watch the card assertions fail**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-redesign.test.js`
Expected: FAIL on `migrated cards render no panel header`.

- [ ] **Step 3: Migrate the card**

In `components/GenericCliToolCard.js`:

1. Replace the import line `import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";` with:

```js
import { Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import FieldGroup from "./ui/FieldGroup";
import FieldRow from "./ui/FieldRow";
import ActionBar from "./ui/ActionBar";
```

2. Remove `StatusBadge` from the imports if it is only used by the deleted header.

3. Drop `isExpanded` and `onToggle` from the function signature.

4. Delete the whole `<Card padding="none" className={styles.panel}>` wrapper, the `<div className={styles.panelHeader} …>…</div>` block, the `{isExpanded && (` guard and its closing `)}`, and the trailing `</Card>`. The component now returns:

```jsx
  return (
    <div className={styles.panelBody}>
      …existing conditional branches…
      <ModelSelectModal … />
      <ManualConfigModal … />
    </div>
  );
```

5. Convert each row. The canonical before/after pair:

```jsx
// before
<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
  <span className={`sm:text-right ${styles.fieldLabel}`}>API Key</span>
  <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
</div>

// after
<FieldRow label="API Key">
  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
</FieldRow>
```

```jsx
// before — a row with a trailing button keeps that button in the aside slot
<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
  <span className={`sm:text-right ${styles.fieldLabel}`}>Model</span>
  <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
  <div className="relative w-full min-w-0">…input…</div>
  <button …>Select Model</button>
</div>

// after
<FieldRow label="Model" aside={<button …>Select Model</button>}>
  <div className="relative w-full min-w-0">…input…</div>
</FieldRow>
```

For the `Current` row, keep the value inside the control slot:

```jsx
<FieldRow label="Current">
  <span className={styles.currentValue}>{currentBaseUrl}</span>
</FieldRow>
```

6. Group the rows: `Endpoint` (Select Endpoint, Current), `Credentials` (API Key), `Models` (Models / Model), `Options` (anything left). Wrap each cluster in `<FieldGroup title="…">`.

7. Replace the message block and the action row with one bar:

```jsx
<ActionBar
  message={message?.text}
  tone={message ? (message.type === "success" ? "success" : "danger") : "neutral"}
  busy={applying || restoring}
>
  <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)}>
    <Icon className="text-[18px] mr-1">code</Icon>
    Manual Config
  </Button>
  {status?.hasJRouter && (
    <Button variant="danger" size="sm" onClick={handleRestore} disabled={restoring || checking}>
      {restoring ? "Removing…" : "Remove from Tool"}
    </Button>
  )}
  <Button variant="primary" size="sm" onClick={handleApply} disabled={applying || checking}>
    {applying ? "Applying…" : "Apply Settings"}
  </Button>
</ActionBar>
```

8. Add `.panelBody` to the CSS module:

```css
.panelBody {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
```

- [ ] **Step 4: Run the contract test**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-redesign.test.js`
Expected: PASS — 11 tests.

- [ ] **Step 5: Lint and browser check**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js"`
Expected: no errors.

Open `http://localhost:20128/dashboard/cli-tools/pi` and `/dashboard/cli-tools/crush`. Confirm: no duplicate title, rows aligned, Apply visible without scrolling to the bottom, Apply/Remove still call the same endpoints (watch the network tab: `POST /api/cli-tools/pi-settings`).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js" \
  "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css" \
  tests/unit/cli-tools-redesign.test.js
git commit -m "refactor(cli-tools): migrate the generic tool card to the field kit"
```

---

### Task 9: Migrate the env/custom cluster (5 cards)

**Files:**
- Modify: `components/ClaudeToolCard.js` (8 rows), `components/CodexToolCard.js` (5), `components/OpenCodeToolCard.js` (6), `components/OpenClawToolCard.js` (4), `components/DroidToolCard.js` (4)

**Interfaces:**
- Consumes: the same imports and shapes as Task 8.
- Produces: every card drops `isExpanded`/`onToggle`, renders `FieldGroup` + `FieldRow` + `ActionBar`, and keeps its handlers untouched.

- [ ] **Step 1: Apply the Task 8 recipe to `ClaudeToolCard.js`**

Rows in order: `Select Endpoint` → `BaseUrlSelect`; `Current` → `styles.currentValue` span; `API Key` → `ApiKeySelect`; one row per `tool.defaultModels` entry labelled `{model.name}` → the model-mapping control with its clear button in the aside slot; `Auto-compact` → its select; `1M context`, `Filter naming`, `Web Search` → their checkbox controls.

Group them: `Endpoint` (Select Endpoint, Current), `Credentials` (API Key), `Models` (the mapping rows, `Models` for `Auto-compact`), `Options` (the three toggles). The three toggles keep their label text and hint inside the control slot so the checkbox and its explanation stay together.

Action row: it currently renders Apply / Reset / Manual Config; move them into `ActionBar` in that order (Manual Config outline, Reset secondary, Apply primary) and pass the card's existing `message` state as `message`/`tone`.

- [ ] **Step 2: Apply the recipe to `CodexToolCard.js`**

Rows: `Select Endpoint`, `Current`, `API Key`, `Model`, `Subagent Model`. Groups: `Endpoint`, `Credentials`, `Models`. Keep the profile list and the reasoning override fields in a `FieldGroup title="Profiles"` placed after `Models`; they are bespoke and keep their markup. Action row → `ActionBar`.

- [ ] **Step 3: Apply the recipe to `OpenCodeToolCard.js`**

Six `8rem` rows: `Select Endpoint`, `Current`, `API Key`, `Subagent Model`, plus two provider rows that use a plain label — convert them with their existing label text. Groups: `Endpoint`, `Credentials`, `Models`. Keep the provider block list markup inside `Models`. Action row → `ActionBar`.

- [ ] **Step 4: Apply the recipe to `OpenClawToolCard.js`**

Rows: `Select Endpoint`, `Current`, `API Key`, `Default Model`. Groups: `Endpoint`, `Credentials`, `Models`. Keep the gateway config preview in `FieldGroup title="Preview"`. Action row → `ActionBar`.

- [ ] **Step 5: Apply the recipe to `DroidToolCard.js`**

Rows: `Select Endpoint`, `Current`, `API Key`, `Models (n)` (the label includes a count span — pass the whole span as `label`). Groups: `Endpoint`, `Credentials`, `Models`. Keep the model list markup. Action row → `ActionBar`.

- [ ] **Step 6: Verify no legacy row or header survives**

Run:

```bash
cd "src/app/(dashboard)/dashboard/cli-tools/components"
grep -c "sm:grid-cols-\[8rem" ClaudeToolCard.js CodexToolCard.js OpenCodeToolCard.js OpenClawToolCard.js DroidToolCard.js
grep -c "styles.panelHeader\|expand_more" ClaudeToolCard.js CodexToolCard.js OpenCodeToolCard.js OpenClawToolCard.js DroidToolCard.js
grep -c "<Card" ClaudeToolCard.js CodexToolCard.js OpenCodeToolCard.js OpenClawToolCard.js DroidToolCard.js
```

Expected: every count is `0` (grep exits 1 when a file has no match — that is the pass condition).

- [ ] **Step 7: Lint and browser check**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components"`
Expected: no errors.

Open `/dashboard/cli-tools/claude`, `/codex`, `/opencode`, `/openclaw`, `/droid`. For each: one header, aligned rows, no collapse chevron, Apply works (`POST /api/cli-tools/<id>-settings`), and the model pickers still open.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components"
git commit -m "refactor(cli-tools): migrate the env and custom config cards to the field kit"
```

---

### Task 10: Migrate the second config cluster (5 cards)

**Files:**
- Modify: `components/DeepSeekTuiToolCard.js` (4), `components/JcodeToolCard.js` (4), `components/GrokBuildToolCard.js` (4), `components/ClineToolCard.js` (4), `components/KiloToolCard.js` (3)

**Interfaces:**
- Consumes: same kit as Task 9.
- Produces: same shape as Task 9.

- [ ] **Step 1: DeepSeekTui**

Rows: `Select Endpoint`, `Current`, `API Key`, `Default Model` → groups `Endpoint`, `Credentials`, `Models`; config preview into `FieldGroup title="Preview"`; actions → `ActionBar`.

- [ ] **Step 2: Jcode**

Same four rows and groups as DeepSeekTui. Keep the config preview markup.

- [ ] **Step 3: GrokBuild**

Rows: `Select Endpoint`, `Current`, `API Key` plus one plain-label row — convert with its existing text. Groups `Endpoint`, `Credentials`, `Models`.

- [ ] **Step 4: Cline**

Rows: `Select Endpoint`, `Current`, `API Key`, `Model`. Groups `Endpoint`, `Credentials`, `Models`.

- [ ] **Step 5: Kilo**

Rows: `Select Endpoint`, `API Key`, `Model` (no `Current` row in this card — do not add one). Groups `Endpoint`, `Credentials`, `Models`.

- [ ] **Step 6: Verify and lint**

Run the same three greps as Task 9 Step 6 over these five files. Expected: all `0`.

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components"`
Expected: no errors.

Browser check: `/dashboard/cli-tools/deepseek-tui`, `/jcode`, `/grok-build`, `/cline`, `/kilo`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components"
git commit -m "refactor(cli-tools): migrate the remaining custom config cards"
```

---

### Task 11: Migrate the structured and guide cards (3 cards, 2 deletions)

**Files:**
- Modify: `components/HermesToolCard.js` (7 rows), `components/CoworkToolCard.js` (7), `components/DefaultToolCard.js` (0)
- Delete: `components/AntigravityToolCard.js`, `components/CopilotToolCard.js` (unreachable — no `antigravity`/`copilot` id exists in `CLI_TOOLS`, and `ToolDetailClient` routes both through `DefaultToolCard`)

**Interfaces:**
- Consumes: kit.
- Produces: guide-only cards keep their step markup but live inside the shared panel with a shared action bar.

- [ ] **Step 1: Hermes**

Rows: `Select Endpoint`, `Current`, `API Key`, `Default Model` plus three plain-label rows — convert with their existing text. Groups: `Endpoint`, `Credentials`, `Models`. Keep the profile selector and YAML preview in `FieldGroup title="Profile"` / `"Preview"`. Actions → `ActionBar`.

- [ ] **Step 2: Cowork**

Rows: `Select Endpoint`, `Current`, `API Key` plus four plain-label rows. Groups: `Endpoint`, `Credentials`, then `Plugins` (MCP registry list, bespoke markup) and `Options`. Actions → `ActionBar`.

- [ ] **Step 3: DefaultToolCard (guide-only)**

No field rows. Delete the `Card` wrapper and header, wrap the guide steps and `ManualConfigModal` in `<div className={styles.panelBody}>`, put the copy buttons that currently sit at the bottom into `ActionBar`. If the card has no action buttons, render `ActionBar` with only the `message` prop and no children.

- [ ] **Step 4: Delete the unreachable cards**

```bash
git rm "src/app/(dashboard)/dashboard/cli-tools/components/AntigravityToolCard.js" \
       "src/app/(dashboard)/dashboard/cli-tools/components/CopilotToolCard.js"
```

Remove their two export lines from `components/index.js`. Confirm nothing else imports them:

```bash
grep -rn "AntigravityToolCard\|CopilotToolCard" "src/app/(dashboard)/dashboard/cli-tools"
```

Expected: no output.

- [ ] **Step 5: Verify, lint, browser check**

Run the Task 9 Step 6 greps over `HermesToolCard.js`, `CoworkToolCard.js`, `DefaultToolCard.js`. Expected: all `0`.

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/components"`
Expected: no errors.

Open `/dashboard/cli-tools/hermes`, `/cowork`, `/devin` (Devin renders `DefaultToolCard`), and `/dashboard/mitm` for the MITM pair migrated in Task 12.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools/components"
git commit -m "refactor(cli-tools): migrate structured and guide cards to the shared panel"
```

---

### Task 12: MITM cards, dead CSS and the final gate

**Files:**
- Modify: `components/MitmToolCard.js`, `components/MitmServerCard.js` (3 plain-label rows)
- Modify: `cli-tools.module.css` (remove dead classes)
- Modify: `tests/unit/cli-tools-redesign.test.js` (extend the migrated list to all 17 files)
- Verify: full build + runtime matrix

**Interfaces:**
- Consumes: kit.
- Produces: no `styles.panelHeader`, `styles.fieldLabel` grid rows, or `<Card` wrappers left anywhere in the route.

- [ ] **Step 1: Migrate the MITM cards**

`MitmToolCard`: drop the `Card` wrapper and header, keep the alias editor and server controls, move its actions into `ActionBar`. `MitmServerCard`: same, converting its two `8rem` rows to `FieldRow` with their existing labels. `MitmLinkCard` is already gone.

- [ ] **Step 2: Extend the contract test to every card**

Replace the `migrated` array in `tests/unit/cli-tools-redesign.test.js` with:

```js
    const migrated = [
      "ClaudeToolCard",
      "ClineToolCard",
      "CodexToolCard",
      "CopilotToolCard",
      "CoworkToolCard",
      "DeepSeekTuiToolCard",
      "DefaultToolCard",
      "DroidToolCard",
      "GenericCliToolCard",
      "GrokBuildToolCard",
      "HermesToolCard",
      "JcodeToolCard",
      "KiloToolCard",
      "MitmServerCard",
      "MitmToolCard",
      "OpenClawToolCard",
      "OpenCodeToolCard",
    ];
    expect(migrated).toHaveLength(16);
```

- [ ] **Step 3: Run the whole test suite**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-groups.test.js unit/cli-tools-redesign.test.js`
Expected: PASS — 16 + 11 tests.

- [ ] **Step 4: Remove dead CSS**

Delete these rules from `cli-tools.module.css` if they are no longer referenced anywhere in the route: `.panelHeader`, `.body`, `.status` (only if no card uses it), `.selectButton`, `.modelPicker` (keep if `ModelSelectModal` still receives it), `.grid`. Verify with:

```bash
cd "src/app/(dashboard)/dashboard/cli-tools"
for c in panelHeader body status selectButton modelPicker grid; do
  echo "$c $(grep -rho "styles\.$c\b" . | wc -l)"
done
```

Delete only the classes that report `0`.

- [ ] **Step 5: Lint the whole route and its tests**

Run: `npx eslint "src/app/(dashboard)/dashboard/cli-tools/**" "tests/unit/cli-tools-*.test.js"`
Expected: no errors.

- [ ] **Step 6: Build**

Run: `npm run build` in the background with a notification; the repo serialises builds across agents and this takes 15–20 minutes.
Expected: exit code 0, no compilation or CSS-module errors.

- [ ] **Step 7: Runtime matrix**

On the dev server, check each of these at 1440, 1024 and 390 px, in light and dark:

| Surface | Expectation |
| --- | --- |
| Index, statuses loaded | 4 metric cards with counts, three sections, counts per section |
| Index, `all-statuses` blocked (devtools offline) | warning notice, `—` metrics, every card listed |
| Index, search "codex" | one card, MITM section hidden |
| `/cli-tools/claude` | one title, aligned rows, sticky Apply, apply succeeds |
| `/cli-tools/copilot` (guide) | steps render, no field rows, action bar shows only its own buttons |
| `/dashboard/mitm` | MITM cards still functional |

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cli-tools" tests/unit/cli-tools-redesign.test.js
git commit -m "refactor(cli-tools): finish the card migration and drop dead styles"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §6.1 Intro + gateway chip | 3 |
| §6.2 Metric strip (4 cards, counts, `of 26`) | 1, 3 |
| §6.3 Toolbar (search + pills, filter semantics) | 1, 3 |
| §6.4 Sections + `group` on constants | 1, 2, 3 |
| §6.5 Tool card anatomy | 3 |
| §6.6 Empty / loading / failure states | 3 |
| §7.1 Detail header + endpoint chip | 6, 7 |
| §7.2 Panel + field groups | 5, 7, 8 |
| §7.3 Sticky action bar | 6, 8 |
| §8 Field system + props | 5, 6 |
| §9 Migration of 17 files | 8, 9, 10, 11, 12 |
| §10 Group assignment | 2 |
| §11 Responsive | 3, 5, 6 (CSS media queries) |
| §12 Accessibility | 3, 5, 6 (labels, aria-pressed, focus rings) |
| §13 Testing | 1, 2, 4, 8, 12 |

Deviations from the spec, taken deliberately:

1. The detail header status comes from `GET /api/cli-tools/<toolId>-settings` (one handler) rather than the batch endpoint, so a detail page does not invoke 19 status getters.
2. `ToolDetailClient` keeps `styles.configuration` on the panel so existing control styling (inputs, selects, buttons) survives the rewrite untouched.

**Placeholder scan:** no TBD/TODO; every new file ships full code; every migration row names its label and target slot; verification commands are literal.

**Type consistency:** `statusOf` returns `{ key, label, variant, dot }` and is consumed with those exact names by `ToolCard`, `CliToolHeader` and the header default. `ActionBar` takes `message`, `tone` (`neutral|success|danger`), `busy`, `children` — Task 8 passes exactly those. `FieldRow` takes `label`, `hint`, `aside`, `className`, `children` — Tasks 8–12 use `label`/`aside` only.
