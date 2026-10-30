# Playground Chat-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/playground` as the template's chat-first surface — composer-hosted controls, real conversation history, settings panel, AI helper calls, export dialog, slash commands — on top of the existing streaming engine.

**Architecture:** The page keeps the real `/api/v1/chat/completions` streaming engine, moved into `usePlaygroundChat`, and adds `usePlaygroundSessions` (localStorage-backed conversations) and `usePlaygroundHints` (title + follow-ups). Presentational pieces are colocated components. `ModelPickerList` gains an opt-in `variant="rail"`. A small zustand store publishes the active conversation title to the shell header. No server code changes.

**Tech Stack:** Next.js 16 App Router, React 19, JavaScript + JSX, CSS Modules, zustand, Vitest (repo runs source-contract tests without a JSX transform).

**Spec:** `docs/superpowers/specs/2026-10-31-playground-chat-first-design.md`

## Global Constraints

- Only existing design tokens: `--surface`, `--surface-2`, `--surface-card`, `--surface-strong`, `--surface-hover`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--brand-lavender`, `--brand-pink`, `--brand-ochre`, `--brand-mint`, `--danger`, `--pos`. No new colour values.
- Theme values come from tokens; the page must look correct in both light and dark mode.
- No real API key may ever be rendered into DOM text, code snippets, or storage. Export uses `$JROUTER_API_KEY` / `process.env.JROUTER_API_KEY` / `os.environ`.
- No new dependencies.
- Playground request defaults: `temperature: 0.7`, `max_tokens: 2048`, `top_p` only when set, `reasoning_effort: "high"` only while Think is on.
- localStorage keys are exactly `jrouter.playground.sessions.v1`, `jrouter.playground.settings.v1`, `jrouter.playground.favorites.v1`.
- Caps: 50 conversations, 200 messages per conversation, 4000 characters of reasoning per message.
- `src/app/(dashboard)/dashboard/playground/PlaygroundMarkdown.js` is reused unchanged; only its stylesheet changes.
- Existing test `tests/unit/playground-full-chat.test.js` must stay green without edits. In particular the mobile composer caps (`max-height: min(200px, 25dvh)` and `min(200px, 20dvh)`) and the "no page header" assertions stay valid.
- Commit after every task; never bundle two tasks into one commit.
- Test command: `cd tests && npx vitest run unit/<file>.test.js`. Lint command: `npx eslint <paths>` from the repo root.
- Do not edit `docs/templates/**` or the dashboard shell layout (`DashboardLayout`, `Sidebar`) beyond the `Header` store wiring in Task 3.

---

## File Structure

```
Create  src/app/(dashboard)/dashboard/playground/playgroundUtils.js
Create  src/app/(dashboard)/dashboard/playground/usePlaygroundSessions.js
Create  src/app/(dashboard)/dashboard/playground/usePlaygroundChat.js
Create  src/app/(dashboard)/dashboard/playground/usePlaygroundHints.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundMessage.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundEmpty.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundComposer.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundSettingsPopover.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundHistoryModal.js
Create  src/app/(dashboard)/dashboard/playground/PlaygroundExportModal.js
Create  src/app/(dashboard)/dashboard/playground/playground-dialogs.module.css
Create  src/store/headerTitleStore.js
Modify  src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js   (rewrite orchestration)
Modify  src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js     (rail popover)
Modify  src/app/(dashboard)/dashboard/playground/playground.module.css     (rewrite)
Modify  src/app/(dashboard)/dashboard/playground/playground-markdown.module.css
Modify  src/shared/components/ModelPickerList.js + .module.css             (rail variant)
Modify  src/shared/components/ModelSelectModal.js                          (variant prop)
Modify  src/app/(dashboard)/dashboard/combos/page.js                       (3 call sites)
Modify  src/shared/components/Header.js                                    (store crumbs)
Create  tests/unit/model-picker-rail.test.js
Create  tests/unit/header-title-store.test.js
Create  tests/unit/playground-utils.test.js
Create  tests/unit/playground-redesign-shell.test.js
Create  tests/unit/playground-redesign-behavior.test.js
```

---

### Task 1: Shared model picker — rail variant

**Files:**
- Modify: `src/shared/components/ModelPickerList.js`
- Modify: `src/shared/components/ModelPickerList.module.css`
- Test: `tests/unit/model-picker-rail.test.js`

**Interfaces:**
- Consumes: existing props `searchQuery`, `onSearchChange`, `combos`, `groups`, `selectedModel`, `addedModelValues`, `onSelect(model, group)`, `showSearch`, `autoFocusSearch`, `emptyLabel`; `useModelCaps()`.
- Produces: new optional props `variant` (`"chips"` default, `"rail"`), `favorites` (string[]), `onToggleFavorite(value)`. Rail markup contract: `data-picker-rail`, `data-model-row`, `data-model-group` (kept), rows never carry `data-model-option`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/model-picker-rail.test.js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("shared model picker rail variant", () => {
  it("is opt-in and keeps chips as the default", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain('variant = "chips"');
    expect(source).toContain('variant === "rail"');
  });

  it("renders the rail and row markers", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain("data-picker-rail");
    expect(source).toContain("data-model-row");
  });

  it("does not reuse the chip attribute on rail rows", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    const railStart = source.indexOf('variant === "rail"');
    expect(railStart).toBeGreaterThan(-1);
    expect(source.slice(railStart)).not.toContain("data-model-option");
  });

  it("handles arrow keys and Enter", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain('"ArrowDown"');
    expect(source).toContain('"ArrowUp"');
    expect(source).toContain('"Enter"');
  });

  it("sizes the rail with a container query", () => {
    const css = read("src/shared/components/ModelPickerList.module.css");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("@container (max-width: 620px)");
  });

  it("keeps the favourite star optional", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain("favorites.length > 0");
    expect(source).toContain("onToggleFavorite");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/model-picker-rail.test.js`
Expected: FAIL — `expected ... to contain 'variant = "chips"'`.

- [ ] **Step 3: Implement the variant**

Replace the top of `src/shared/components/ModelPickerList.js` (imports + component signature) with:

```javascript
"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import CapacityBadges from "@/shared/components/CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import styles from "./ModelPickerList.module.css";

// Presentational half of the model picker. `variant="chips"` is the compact
// multi-select list used by the endpoint allow-list and the CLI-tool dialogs.
// `variant="rail"` is the two-pane browser used by the Playground and Combos.
export default function ModelPickerList({
  searchQuery,
  onSearchChange,
  combos,
  groups,
  selectedModel,
  addedModelValues = [],
  onSelect,
  showSearch = true,
  autoFocusSearch = false,
  groupLimit = 0,
  emptyLabel = "No models found",
  variant = "chips",
  favorites = [],
  onToggleFavorite,
}) {
  const { getCaps } = useModelCaps();
  const groupEntries = Object.entries(groups);
  const shownGroups = groupLimit > 0 ? groupEntries.slice(0, groupLimit) : groupEntries;
  const hasResults = combos.length > 0 || groupEntries.length > 0;
  const [railKey, setRailKey] = useState("all");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef(null);

  // Search can remove the provider the rail is parked on; fall back to All models.
  useEffect(() => {
    if (railKey === "all" || railKey === "favorites" || railKey === "combos") return;
    if (!shownGroups.some(([providerId]) => providerId === railKey)) setRailKey("all");
  }, [railKey, shownGroups]);

  useEffect(() => {
    setCursor(0);
  }, [searchQuery, railKey]);

  const rail = useMemo(() => {
    const comboRows = combos.map((combo) => ({
      key: `combo:${combo.id || combo.name}`,
      kind: "combo",
      model: { id: combo.name, name: combo.name, value: combo.name },
      group: { providerId: "combo", name: "Combos", isCombo: true },
    }));
    const modelRows = shownGroups.flatMap(([providerId, group]) => group.models.map((model) => ({
      key: `${providerId}:${model.value}`,
      kind: "model",
      model,
      group: { providerId, name: group.name, color: group.color },
    })));
    const allRows = [...comboRows, ...modelRows];
    const favoritesSet = new Set(favorites);
    const count = (value) => value === "all"
      ? allRows.length
      : value === "combos"
        ? comboRows.length
        : value === "favorites"
          ? allRows.filter((row) => favoritesSet.has(row.model.value)).length
          : modelRows.filter((row) => row.group.providerId === value).length;

    const entries = [{ key: "all", name: "All models", icon: "layers", count: count("all") }];
    if (count("favorites") > 0) entries.push({ key: "favorites", name: "Favorites", icon: "star", count: count("favorites") });
    if (comboRows.length > 0) entries.push({ key: "combos", name: "Combos", icon: "layers", count: comboRows.length });
    for (const [providerId, group] of shownGroups) {
      entries.push({ key: providerId, name: group.name, count: count(providerId), providerId });
    }

    const rows = railKey === "all"
      ? allRows
      : railKey === "combos"
        ? comboRows
        : railKey === "favorites"
          ? allRows.filter((row) => favoritesSet.has(row.model.value))
          : allRows.filter((row) => row.group.providerId === railKey);

    return { entries, rows, favoritesSet };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combos, shownGroups, favorites, railKey]);

  if (variant === "rail") {
    const chosen = (value) => selectedModel === value || addedModelValues.includes(value);
    const selectRow = (row) => onSelect(row.model, row.group);
    const activeEntry = rail.entries.find((entry) => entry.key === railKey);

    const onKeyDown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((index) => Math.min(rail.rows.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const row = rail.rows[cursor];
        if (row) selectRow(row);
      }
    };

    return (
      <div className={styles.railWrap}>
        {showSearch ? (
          <div className={styles.search}>
            <Icon className={styles.searchIcon}>search</Icon>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search model, provider namespace, or variant…"
              aria-label="Search models"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={onKeyDown}
              className={styles.searchInput}
              autoFocus={autoFocusSearch}
            />
          </div>
        ) : null}

        <div className={styles.railBody}>
          <div className={styles.rail} data-picker-rail role="tablist" aria-label="Providers">
            <p className={styles.railHead}>Providers ({rail.entries.length - 1})</p>
            {rail.entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={railKey === entry.key}
                className={styles.railItem}
                onClick={() => setRailKey(entry.key)}
              >
                <span className={styles.railGlyph}>
                  {entry.icon ? <Icon>{entry.icon}</Icon> : (entry.name || entry.key).slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.railName}>{entry.name}</span>
                <em className={styles.railCount}>{entry.count}</em>
              </button>
            ))}
          </div>

          <div className={styles.rows} role="listbox" aria-label="Models">
            <p className={styles.rowsHead}>
              {activeEntry ? activeEntry.name : "Models"} ({rail.rows.length})
            </p>
            {rail.rows.length ? rail.rows.map((row, index) => (
              <div
                key={row.key}
                role="option"
                aria-selected={chosen(row.model.value)}
                data-model-row
                data-cursor={index === cursor ? "true" : undefined}
                className={styles.row}
                onMouseEnter={() => setCursor(index)}
                onClick={() => selectRow(row)}
              >
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className={styles.star}
                    aria-pressed={rail.favoritesSet.has(row.model.value)}
                    aria-label={rail.favoritesSet.has(row.model.value) ? "Remove from favorites" : "Add to favorites"}
                    onClick={(event) => { event.stopPropagation(); onToggleFavorite(row.model.value); }}
                  >
                    <Icon>star</Icon>
                  </button>
                ) : null}
                <span className={styles.rowGlyph}>
                  {row.kind === "combo" ? (
                    <Icon>layers</Icon>
                  ) : (
                    <ProviderIcon
                      providerId={row.group.providerId}
                      src={`/providers/${row.group.providerId}.png`}
                      alt={row.group.name}
                      size={20}
                      fallbackText={(row.group.name || row.group.providerId).slice(0, 2).toUpperCase()}
                      fallbackColor={row.group.color}
                    />
                  )}
                </span>
                <b className={styles.rowName}>{row.model.name}</b>
                {row.model.isCustom ? <small className={styles.rowTag}>custom</small> : null}
                {row.model.isPlaceholder ? <Icon className={styles.rowHint}>edit</Icon> : null}
                <CapacityBadges caps={getCaps(row.model.value)} size={13} />
                {chosen(row.model.value) ? <Icon className={styles.rowCheck}>check</Icon> : null}
              </div>
            )) : <p className={styles.rowEmpty}>{emptyLabel}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showSearch ? (
        <div className={styles.search}>
          <Icon className={styles.searchIcon}>search</Icon>
          <input
            type="text"
            placeholder="Search models, providers, combos"
            aria-label="Search models"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className={styles.searchInput}
            autoFocus={autoFocusSearch}
          />
        </div>
      ) : null}
```

Keep the existing chip JSX (`styles.scroll`, combos group, provider groups, empty block) exactly as it is below this point, and extend propTypes:

```javascript
ModelPickerList.propTypes = {
  // ...existing entries unchanged
  variant: PropTypes.oneOf(["chips", "rail"]),
  favorites: PropTypes.arrayOf(PropTypes.string),
  onToggleFavorite: PropTypes.func,
};
```

- [ ] **Step 4: Add the rail styles**

Append to `src/shared/components/ModelPickerList.module.css`:

```css
/* Rail variant: provider browser used by the Playground and Combos pickers. */
.railWrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
  container-type: inline-size;
}

.railBody {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 0;
  margin-top: 12px;
  border-top: 1px solid var(--line);
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--line);
}

.railHead {
  padding: 2px 8px 6px;
  color: var(--text-3);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.railItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.railItem:hover { background: var(--surface-2); }

.railItem[aria-selected="true"] {
  background: var(--brand-lavender);
  color: #0a0a0a;
  font-weight: 600;
}

.railGlyph {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
}

.railItem[aria-selected="true"] .railGlyph { background: var(--surface); }
.railItem .railGlyph svg { font-size: 13px; }

.railName {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.railCount {
  color: var(--text-3);
  font-size: 11px;
  font-style: normal;
}

.railItem[aria-selected="true"] .railCount { color: #3a3a3a; }

.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.rowsHead {
  padding: 2px 8px 6px;
  color: var(--text-3);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 12px 6px 6px;
  border-radius: 12px;
  background: var(--surface-card);
  color: var(--text);
  cursor: pointer;
}

.row:hover,
.row[data-cursor="true"] { background: var(--surface-strong); }

.row[aria-selected="true"] { outline: 2px solid var(--brand-lavender); }

.rowGlyph {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
}

.rowGlyph svg { font-size: 16px; }

.rowName {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowTag {
  color: var(--text-3);
  font-size: 10px;
}

.rowHint { color: var(--text-3); font-size: 13px; }
.rowCheck { flex: none; margin-left: auto; font-size: 15px; }

.star {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.star:hover { background: var(--surface); color: var(--text); }
.star[aria-pressed="true"] { color: var(--brand-ochre); }
.star[aria-pressed="true"] svg { fill: var(--brand-ochre); }
.star svg { font-size: 15px; }

.rowEmpty {
  padding: 28px 0;
  color: var(--text-3);
  font-size: 12px;
  text-align: center;
}

@container (max-width: 620px) {
  .railBody { grid-template-columns: 1fr; }

  .rail {
    flex-direction: row;
    overflow-x: auto;
    padding: 10px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .railHead { display: none; }
  .railItem { flex: none; }
  .railCount { display: none; }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd tests && npx vitest run unit/model-picker-rail.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/components/ModelPickerList.js
git add src/shared/components/ModelPickerList.js src/shared/components/ModelPickerList.module.css tests/unit/model-picker-rail.test.js
git commit -m "feat(playground): add a rail variant to the shared model picker"
```

---

### Task 2: Adopt the rail picker in Combos

**Files:**
- Modify: `src/shared/components/ModelSelectModal.js`
- Modify: `src/app/(dashboard)/dashboard/combos/page.js` (three `ModelSelectModal` call sites: judge picker, capacity adapter picker, add-model picker)
- Test: `tests/unit/model-picker-rail.test.js` (append)

**Interfaces:**
- Consumes: `ModelPickerList` `variant` prop from Task 1.
- Produces: `ModelSelectModal` prop `variant` (default `"chips"`), forwarded to `ModelPickerList`. Combos call sites pass `variant="rail"`.

- [ ] **Step 1: Extend the failing test**

```javascript
it("forwards the variant from ModelSelectModal", () => {
  const modal = read("src/shared/components/ModelSelectModal.js");
  expect(modal).toContain('variant = "chips"');
  expect(modal).toContain("variant={variant}");
  expect(modal).toContain("variant: PropTypes.oneOf");
});

it("uses the rail picker on the Combos page", () => {
  const page = read("src/app/(dashboard)/dashboard/combos/page.js");
  expect(page.match(/variant="rail"/g)?.length).toBe(3);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/model-picker-rail.test.js`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Implement**

In `src/shared/components/ModelSelectModal.js`:

```javascript
// signature
export default function ModelSelectModal({
  // ...existing props unchanged
  notice = "Click to add, click again to remove. Changes are saved automatically.",
  variant = "chips",
}) {
```

Pass it through:

```jsx
<ModelPickerList
  variant={variant}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  combos={filteredCombos}
  groups={visibleGroups}
  selectedModel={selectedModel}
  addedModelValues={addedModelValues}
  onSelect={handleSelect}
/>
```

Add to propTypes:

```javascript
variant: PropTypes.oneOf(["chips", "rail"]),
```

In `src/app/(dashboard)/dashboard/combos/page.js`, add `variant="rail"` to all three `<ModelSelectModal` call sites (`Select Judge Model`, the capacity-adapter picker, `Add Model to Combo`).

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd tests && npx vitest run unit/model-picker-rail.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/components/ModelSelectModal.js "src/app/(dashboard)/dashboard/combos/page.js"
git add src/shared/components/ModelSelectModal.js "src/app/(dashboard)/dashboard/combos/page.js" tests/unit/model-picker-rail.test.js
git commit -m "feat(combos): use the rail model picker in combo dialogs"
```

---

### Task 3: Header title store

**Files:**
- Create: `src/store/headerTitleStore.js`
- Modify: `src/shared/components/Header.js`
- Test: `tests/unit/header-title-store.test.js`

**Interfaces:**
- Produces: `useHeaderTitleStore` (zustand) with `{ crumbs: Crumb[], setCrumbs(crumbs), clearCrumbs() }`, `Crumb = { label: string, href?: string }`.
- Consumes in later tasks: the Playground calls `setCrumbs([{ label: "Playground", href: "/dashboard/playground" }, { label: title }])`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/header-title-store.test.js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("header title store", () => {
  it("exposes crumbs and a setter", () => {
    const store = read("src/store/headerTitleStore.js");
    expect(store).toContain("useHeaderTitleStore");
    expect(store).toContain("crumbs");
    expect(store).toContain("setCrumbs");
    expect(store).toContain("clearCrumbs");
  });

  it("lets the header prefer store crumbs", () => {
    const header = read("src/shared/components/Header.js");
    expect(header).toContain("useHeaderTitleStore");
    expect(header).toContain("storeCrumbs");
  });

  it("does not hardcode the playground route in the header", () => {
    const header = read("src/shared/components/Header.js");
    expect(header).not.toContain('includes("/playground")');
    expect(header).not.toContain('title: "Model Playground"');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/header-title-store.test.js`
Expected: FAIL — `ENOENT` for `src/store/headerTitleStore.js`.

- [ ] **Step 3: Implement the store**

```javascript
// src/store/headerTitleStore.js
"use client";

import { create } from "zustand";

// Pages publish their own breadcrumb trail here; the shell header renders it
// verbatim. Keeping this generic means no route string lives in Header.js.
export const useHeaderTitleStore = create((set) => ({
  crumbs: [],
  setCrumbs: (crumbs) => set({ crumbs: Array.isArray(crumbs) ? crumbs : [] }),
  clearCrumbs: () => set({ crumbs: [] }),
}));
```

- [ ] **Step 4: Wire the header**

In `src/shared/components/Header.js`, add the import next to the other store imports:

```javascript
import { useHeaderTitleStore } from "@/store/headerTitleStore";
```

Inside the component, next to `const pageInfo = useMemo(...)`:

```javascript
const storeCrumbs = useHeaderTitleStore((state) => state.crumbs);
```

Replace the crumb derivation:

```javascript
const { title, icon, breadcrumbs } = pageInfo;
const crumbs = storeCrumbs.length > 0
  ? storeCrumbs
  : breadcrumbs.length > 0
    ? breadcrumbs
    : title
      ? [{ label: title, icon }]
      : [];
```

- [ ] **Step 5: Run the tests**

Run: `cd tests && npx vitest run unit/header-title-store.test.js unit/playground-full-chat.test.js`
Expected: PASS (3 + 7 tests).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/store/headerTitleStore.js src/shared/components/Header.js
git add src/store/headerTitleStore.js src/shared/components/Header.js tests/unit/header-title-store.test.js
git commit -m "feat(shell): let pages publish header breadcrumbs"
```

### Task 4: Playground pure helpers

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/playgroundUtils.js`
- Test: `tests/unit/playground-utils.test.js`

**Interfaces:**
- Produces (all named exports, browser-safe, no React):
  - Constants: `SESSIONS_KEY`, `SETTINGS_KEY`, `FAVORITES_KEY`, `MAX_CONVERSATIONS`, `MAX_MESSAGES`, `MAX_REASONING_CHARS`, `MAX_TITLE_CHARS`, `DEFAULT_SETTINGS`.
  - `normalizeSettings(raw) -> settings`, `settingsToSliderValue(value) -> number`.
  - `normalizeMessage(raw) -> message|null`, `normalizeSession(raw) -> session|null`, `restoreSessions(raw) -> {activeId, conversations}|null`, `stripReasoning(sessions) -> sessions`.
  - `readStorage(key, validate, storage?) -> value|null`, `writeStorage(key, value, storage?) -> boolean`, `persistSessions(sessions, storage?) -> boolean`.
  - `sanitizeTitle(raw) -> string`, `localTitle(question) -> string`, `parseFollowUps(raw) -> string[]`.
  - `toRequestMessages(messages, system) -> {role, content}[]`, `buildTurnBody(session, settings) -> body`, `buildExportBody(session, settings) -> body`.
  - `renderCurl(body, origin)`, `renderJavaScript(body, origin)`, `renderPython(body, origin)`.
  - `relativeTime(ts, now?)`, `formatLatency(ms)`, `formatSeconds(ms)`, `buildMetaParts(meta)`, `nextActiveId(conversations, removedId)`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/playground-utils.test.js
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  normalizeSettings,
  normalizeMessage,
  restoreSessions,
  stripReasoning,
  readStorage,
  writeStorage,
  persistSessions,
  sanitizeTitle,
  localTitle,
  parseFollowUps,
  toRequestMessages,
  buildTurnBody,
  buildExportBody,
  renderCurl,
  renderJavaScript,
  renderPython,
  relativeTime,
  formatLatency,
  formatSeconds,
  buildMetaParts,
  nextActiveId,
} from "@/app/(dashboard)/dashboard/playground/playgroundUtils";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};

const SETTINGS = { system: "Be brief.", temperature: 0.7, maxTokens: 2048, topP: "", helper: true, think: false };
const SESSION = {
  model: { value: "ag/gemini-3.8-flash-high", name: "Gemini", isCombo: false },
  messages: [
    { role: "divider", content: "Model switched" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "assistant", content: "   " },
  ],
};

describe("playgroundUtils settings", () => {
  it("falls back to defaults and clamps ranges", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ temperature: 5 }).temperature).toBe(2);
    expect(normalizeSettings({ temperature: -1 }).temperature).toBe(0);
    expect(normalizeSettings({ maxTokens: "16000" }).maxTokens).toBe(16000);
    expect(normalizeSettings({ maxTokens: 0 }).maxTokens).toBe(2048);
    expect(normalizeSettings({ topP: "" }).topP).toBe("");
    expect(normalizeSettings({ topP: 3 }).topP).toBe("1");
    expect(normalizeSettings({ helper: false }).helper).toBe(false);
  });
});

describe("playgroundUtils restore", () => {
  it("normalizes message status and caps reasoning", () => {
    expect(normalizeMessage({ id: "a", role: "assistant", content: "hi", status: "streaming" }).status).toBe("done");
    expect(normalizeMessage({ id: "a", role: "assistant", content: "", status: "streaming" }).status).toBe("empty");
    expect(normalizeMessage({ role: "system" })).toBeNull();
    expect(normalizeMessage({ id: "a", role: "assistant", reasoning: "x".repeat(5000) }).reasoning.length).toBe(4000);
  });

  it("restores sessions, active id and caps", () => {
    expect(restoreSessions({ activeId: "s1", conversations: [{ id: "s1", messages: [] }] }).activeId).toBe("s1");
    expect(restoreSessions({ activeId: "missing", conversations: [{ id: "s1", messages: [] }] }).activeId).toBe("s1");
    expect(restoreSessions({ conversations: [] })).toBeNull();
    expect(restoreSessions([{ id: "s1", messages: [] }]).conversations.length).toBe(1);
    const many = Array.from({ length: 80 }, (_, index) => ({ id: `s${index}`, messages: [] }));
    expect(restoreSessions({ conversations: many }).conversations.length).toBe(MAX_CONVERSATIONS);
    const messages = Array.from({ length: 250 }, (_, index) => ({ id: `m${index}`, role: "user", content: String(index) }));
    const restored = restoreSessions({ conversations: [{ id: "s1", messages }] });
    expect(restored.conversations[0].messages.length).toBe(MAX_MESSAGES);
    expect(restored.conversations[0].messages.at(-1).content).toBe("249");
    expect(stripReasoning({ activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "x" }] }] }).conversations[0].messages[0].reasoning).toBe("");
  });
});

describe("playgroundUtils storage", () => {
  it("round trips and rejects invalid shapes", () => {
    const storage = memoryStorage();
    expect(writeStorage("k", { a: 1 }, storage)).toBe(true);
    expect(readStorage("k", (value) => typeof value.a === "number", storage)).toEqual({ a: 1 });
    storage.setItem("k2", JSON.stringify({ a: "x" }));
    expect(readStorage("k2", (value) => typeof value.a === "number", storage)).toBeNull();
  });

  it("survives a throwing storage", () => {
    const storage = { getItem: () => { throw new Error("boom"); }, setItem: () => { throw new Error("boom"); } };
    expect(readStorage("k", () => true, storage)).toBeNull();
    expect(writeStorage("k", {}, storage)).toBe(false);
  });

  it("trims long reasoning before writing", () => {
    const storage = { saved: null, setItem: (key, value) => { storage.saved = JSON.parse(value); } };
    const sessions = { activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "x".repeat(5000) }] }] };
    expect(persistSessions(sessions, storage)).toBe(true);
    expect(storage.saved.conversations[0].messages[0].reasoning.length).toBe(4000);
  });

  it("retries without reasoning on quota failure", () => {
    let attempts = 0;
    const storage = {
      setItem: (key, value) => {
        attempts += 1;
        if (attempts === 1) throw new Error("quota");
        storage.saved = JSON.parse(value);
      },
    };
    expect(persistSessions({ activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "long" }] }] }, storage)).toBe(true);
    expect(attempts).toBe(2);
    expect(storage.saved.conversations[0].messages[0].reasoning).toBe("");
  });
});

describe("playgroundUtils titles and follow-ups", () => {
  it("sanitizes and falls back locally", () => {
    expect(sanitizeTitle('"Combo fallback explained"')).toBe("Combo fallback explained");
    expect(sanitizeTitle("  a\n\n b  ")).toBe("a b");
    expect(sanitizeTitle("x".repeat(80)).length).toBe(60);
    expect(localTitle("how   does fallback work in a combo please")).toBe("How does fallback work in a");
    expect(localTitle("hello there?")).toBe("Hello there");
    expect(localTitle("   ")).toBe("New chat");
  });

  it("parses follow-up arrays leniently", () => {
    expect(parseFollowUps('["A", "B", "C"]')).toEqual(["A", "B", "C"]);
    expect(parseFollowUps('```json\n["A","B"]\n```')).toEqual(["A", "B"]);
    expect(parseFollowUps('Here: ["A"] done')).toEqual(["A"]);
    expect(parseFollowUps('["A","B","C","D"]')).toEqual(["A", "B", "C"]);
    expect(parseFollowUps('["A", 2, null, "B"]')).toEqual(["A", "B"]);
    expect(parseFollowUps("no json here")).toEqual([]);
    expect(parseFollowUps('["A",]')).toEqual([]);
  });
});

describe("playgroundUtils request bodies", () => {
  it("drops dividers and blank content", () => {
    expect(toRequestMessages(SESSION.messages, "Be brief.")).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("builds the turn body", () => {
    const body = buildTurnBody(SESSION, SETTINGS);
    expect(body.model).toBe("ag/gemini-3.8-flash-high");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
    expect(body.top_p).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(buildTurnBody(SESSION, { ...SETTINGS, topP: "0.95" }).top_p).toBe(0.95);
    expect(buildTurnBody(SESSION, { ...SETTINGS, think: true }).reasoning_effort).toBe("high");
  });

  it("builds the export body with a Hello fallback", () => {
    const body = buildExportBody({ model: null, messages: [] }, SETTINGS);
    expect(body.messages).toEqual([{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }]);
    expect(body.model).toBe("YOUR_MODEL");
    expect(buildExportBody(SESSION, SETTINGS).messages.at(-1).content).toBe("hello");
  });
});

describe("playgroundUtils code renderers", () => {
  const body = buildExportBody(SESSION, SETTINGS);
  const origin = "http://localhost:20128";

  it("renders cURL with the env placeholder", () => {
    const code = renderCurl(body, origin);
    expect(code).toContain("curl http://localhost:20128/v1/chat/completions");
    expect(code).toContain("$JROUTER_API_KEY");
    expect(code).toContain("Content-Type: application/json");
    expect(renderCurl({ ...body, messages: [{ role: "user", content: "it's" }] }, origin)).toContain("it'\\''s");
  });

  it("renders JavaScript and Python with env placeholders", () => {
    expect(renderJavaScript(body, origin)).toContain("process.env.JROUTER_API_KEY");
    expect(renderJavaScript(body, origin)).toContain("JSON.stringify");
    expect(renderPython(body, origin)).toContain("os.environ['JROUTER_API_KEY']");
    expect(renderPython(body, origin)).toContain("requests.post");
    for (const code of [renderCurl(body, origin), renderJavaScript(body, origin), renderPython(body, origin)]) {
      expect(code).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
    }
  });
});

describe("playgroundUtils formatting", () => {
  it("formats relative time, latencies and meta parts", () => {
    const now = Date.now();
    expect(relativeTime(now - 5000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60000, now)).toBe("12m ago");
    expect(relativeTime(now - 3 * 3600000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86400000, now)).toBe("2d ago");
    expect(relativeTime(now + 5000, now)).toBe("just now");
    expect(formatLatency(420)).toBe("420ms");
    expect(formatLatency(4200)).toBe("4.2s");
    expect(formatLatency(0)).toBe("");
    expect(formatSeconds(3100)).toBe("3.1s");
    expect(buildMetaParts({
      latencyMs: 4200,
      usage: { prompt_tokens: 1200, completion_tokens: 300 },
      finishReason: "stop",
      responseModel: "m2",
      requestedModel: "m1",
    })).toEqual(["4.2s", "1,200 in", "300 out", "stop", "m2"]);
    expect(buildMetaParts({ usage: { total_tokens: 900 } })).toEqual(["900 tokens"]);
    expect(buildMetaParts({ stopped: true, latencyMs: 900 })).toEqual(["900ms", "stopped"]);
    expect(buildMetaParts({ finishReason: "length" })).toEqual(["length"]);
  });

  it("picks the next active id", () => {
    expect(nextActiveId([{ id: "a" }, { id: "b" }], "a")).toBe("b");
    expect(nextActiveId([{ id: "a" }], "a")).toBe("");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: FAIL — cannot resolve `playgroundUtils`.

- [ ] **Step 3: Create the module**

Create `src/app/(dashboard)/dashboard/playground/playgroundUtils.js` with exactly this content:

```javascript
export const SESSIONS_KEY = "jrouter.playground.sessions.v1";
export const SETTINGS_KEY = "jrouter.playground.settings.v1";
export const FAVORITES_KEY = "jrouter.playground.favorites.v1";
export const MAX_CONVERSATIONS = 50;
export const MAX_MESSAGES = 200;
export const MAX_REASONING_CHARS = 4000;
export const MAX_TITLE_CHARS = 60;

export const DEFAULT_SETTINGS = Object.freeze({
  system: "",
  temperature: 0.7,
  maxTokens: 2048,
  topP: "",
  helper: true,
  think: false,
});

const MESSAGE_ROLES = new Set(["user", "assistant", "divider"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const temperature = Number.parseFloat(input.temperature);
  const maxTokens = Number.parseInt(input.maxTokens, 10);
  const topP = Number.parseFloat(input.topP);
  return {
    system: safeString(input.system),
    temperature: Number.isFinite(temperature) ? clamp(temperature, 0, 2) : DEFAULT_SETTINGS.temperature,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_SETTINGS.maxTokens,
    topP: Number.isFinite(topP) ? String(clamp(topP, 0, 1)) : "",
    helper: typeof input.helper === "boolean" ? input.helper : DEFAULT_SETTINGS.helper,
    think: typeof input.think === "boolean" ? input.think : DEFAULT_SETTINGS.think,
  };
}

export function settingsToSliderValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 2) : DEFAULT_SETTINGS.temperature;
}

export function normalizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = MESSAGE_ROLES.has(raw.role) ? raw.role : null;
  if (!role) return null;
  const content = safeString(raw.content);
  const reasoning = safeString(raw.reasoning).slice(0, MAX_REASONING_CHARS);
  let status = raw.status;
  if (role === "assistant") {
    if (status === "streaming") status = content || reasoning ? "done" : "empty";
    if (!["streaming", "done", "empty", "error"].includes(status)) status = content ? "done" : "empty";
  }
  return {
    id: safeString(raw.id) || `restored_${Math.random().toString(36).slice(2)}`,
    role,
    content,
    reasoning,
    status: role === "assistant" ? status : undefined,
    modelName: safeString(raw.modelName),
    providerId: safeString(raw.providerId),
    providerName: safeString(raw.providerName),
    isCombo: raw.isCombo === true,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
    elapsedMs: Number.isFinite(raw.elapsedMs) ? raw.elapsedMs : null,
    thinkingMs: Number.isFinite(raw.thinkingMs) ? raw.thinkingMs : null,
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : null,
    error: safeString(raw.error),
    followUps: Array.isArray(raw.followUps) ? raw.followUps.filter((item) => typeof item === "string").slice(0, 3) : [],
    from: safeString(raw.from),
    to: safeString(raw.to),
  };
}

export function normalizeSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES)
    : [];
  const model = raw.model && typeof raw.model === "object" && typeof raw.model.value === "string"
    ? {
      value: raw.model.value,
      name: safeString(raw.model.name) || raw.model.value,
      providerId: safeString(raw.model.providerId),
      providerName: safeString(raw.model.providerName),
      providerColor: safeString(raw.model.providerColor),
      isCombo: raw.model.isCombo === true,
    }
    : null;
  return {
    id: safeString(raw.id) || `session_${Math.random().toString(36).slice(2)}`,
    title: safeString(raw.title).slice(0, MAX_TITLE_CHARS) || "New chat",
    model,
    messages,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

export function restoreSessions(raw) {
  const input = Array.isArray(raw) ? { conversations: raw } : raw;
  if (!input || typeof input !== "object" || !Array.isArray(input.conversations)) return null;
  const conversations = input.conversations
    .map(normalizeSession)
    .filter(Boolean)
    .slice(0, MAX_CONVERSATIONS);
  if (conversations.length === 0) return null;
  const activeId = safeString(input.activeId);
  const activeExists = conversations.some((conversation) => conversation.id === activeId);
  return { activeId: activeExists ? activeId : conversations[0].id, conversations };
}

export function stripReasoning(sessions) {
  return {
    ...sessions,
    conversations: sessions.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message, reasoning: "" })),
    })),
  };
}

export function readStorage(key, validate, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStorage(key, value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function trimReasoning(sessions) {
  return {
    ...sessions,
    conversations: sessions.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => (
        typeof message.reasoning === "string" && message.reasoning.length > MAX_REASONING_CHARS
          ? { ...message, reasoning: message.reasoning.slice(0, MAX_REASONING_CHARS) }
          : message
      )),
    })),
  };
}

export function persistSessions(sessions, storage = globalThis.localStorage) {
  if (writeStorage(SESSIONS_KEY, trimReasoning(sessions), storage)) return true;
  // Quota: retry without the heavy reasoning bodies before giving up.
  return writeStorage(SESSIONS_KEY, stripReasoning(sessions), storage);
}

export function sanitizeTitle(raw) {
  const line = safeString(raw)
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s"'`*#]+/, "")
    .replace(/[\s"'`*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.slice(0, MAX_TITLE_CHARS);
}

export function localTitle(question) {
  const words = safeString(question).replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").split(" ").filter(Boolean);
  const title = words.slice(0, 6).join(" ").slice(0, MAX_TITLE_CHARS);
  if (!title) return "New chat";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function parseFollowUps(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const text = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function toRequestMessages(messages, system) {
  const result = [];
  if (system && system.trim()) result.push({ role: "system", content: system.trim() });
  for (const message of messages || []) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (typeof message.content !== "string" || !message.content.trim()) continue;
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

export function buildTurnBody(session, settings) {
  const normalized = normalizeSettings(settings);
  const body = {
    model: session?.model?.value || "",
    messages: toRequestMessages(session?.messages, normalized.system),
    stream: true,
    temperature: normalized.temperature,
    max_tokens: normalized.maxTokens,
  };
  const topP = Number.parseFloat(normalized.topP);
  if (Number.isFinite(topP)) body.top_p = clamp(topP, 0, 1);
  if (normalized.think) body.reasoning_effort = "high";
  return body;
}

export function buildExportBody(session, settings) {
  const body = buildTurnBody(session, settings);
  if (!body.messages.some((message) => message.role === "user")) {
    body.messages = [...body.messages, { role: "user", content: "Hello" }];
  }
  if (!body.model) body.model = "YOUR_MODEL";
  return body;
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

export function renderCurl(body, origin) {
  const payload = stringify(body).replace(/'/g, "'\\''");
  return `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer $JROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${payload}'`;
}

export function renderJavaScript(body, origin) {
  return `const res = await fetch("${origin}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.JROUTER_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${stringify(body).replace(/\n/g, "\n  ")}),
});
console.log(await res.json());`;
}

export function renderPython(body, origin) {
  return `import json, os, requests

payload = json.loads(r"""
${stringify(body)}
""")

res = requests.post(
    "${origin}/v1/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['JROUTER_API_KEY']}"},
    json=payload,
)
print(res.json())`;
}

export function relativeTime(timestamp, now = Date.now()) {
  const delta = now - Number(timestamp || 0);
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildMetaParts(meta) {
  if (!meta) return [];
  const parts = [];
  const latency = formatLatency(meta.latencyMs);
  if (latency) parts.push(latency);
  const prompt = Number.isFinite(meta.usage?.prompt_tokens) ? meta.usage.prompt_tokens.toLocaleString("en-US") : "";
  if (prompt) parts.push(`${prompt} in`);
  const completion = Number.isFinite(meta.usage?.completion_tokens) ? meta.usage.completion_tokens.toLocaleString("en-US") : "";
  if (completion) {
    parts.push(`${completion} out`);
  } else if (Number.isFinite(meta.usage?.total_tokens)) {
    parts.push(`${meta.usage.total_tokens.toLocaleString("en-US")} tokens`);
  }
  if (meta.finishReason) parts.push(meta.finishReason);
  if (meta.responseModel && meta.responseModel !== meta.requestedModel) parts.push(meta.responseModel);
  if (meta.stopped) parts.push("stopped");
  return parts;
}

export function nextActiveId(conversations, removedId) {
  const remaining = conversations.filter((conversation) => conversation.id !== removedId);
  return remaining[0]?.id || "";
}
```

This module was executed against 61 assertions in `node` before being written into this plan; do not paraphrase it.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: PASS (16 tests, 61 assertions).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/playgroundUtils.js"
git add "src/app/(dashboard)/dashboard/playground/playgroundUtils.js" tests/unit/playground-utils.test.js
git commit -m "feat(playground): add session, export and formatting helpers"
```

---

### Task 5: Conversation sessions hook

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/usePlaygroundSessions.js`
- Test: `tests/unit/playground-redesign-behavior.test.js` (create here, extend later)

**Interfaces:**
- Consumes: `SESSIONS_KEY`, `MAX_TITLE_CHARS`, `persistSessions`, `readStorage`, `restoreSessions` from Task 4.
- Produces: default export `usePlaygroundSessions()` returning
  `{ sessions, activeId, activeSession, setActiveId(id), newSession(model) -> session, duplicateSession(source) -> void, deleteSession(id), updateSession(id, updater) }`.
  `createSession(model)` is exported for tests/other callers.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/playground-redesign-behavior.test.js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PLAYGROUND = "src/app/(dashboard)/dashboard/playground";

describe("playground sessions", () => {
  it("persists through the shared session helpers", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain("SESSIONS_KEY");
    expect(source).toContain("persistSessions");
    expect(source).toContain("restoreSessions");
    expect(source).toContain("readStorage");
    expect(source).toContain("setTimeout(() => persistSessions");
  });

  it("creates a session with the template defaults", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain('title: "New chat"');
    expect(source).toContain("messages: []");
    expect(source).toContain("export function createSession");
  });

  it("exposes the CRUD surface the page needs", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    for (const name of ["activeSession", "setActiveId", "newSession", "duplicateSession", "deleteSession", "updateSession"]) {
      expect(source).toContain(name);
    }
  });

  it("caps copied titles", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain("MAX_TITLE_CHARS");
    expect(source).toContain("(copy)");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: FAIL — `ENOENT` for `usePlaygroundSessions.js`.

- [ ] **Step 3: Implement the hook**

```javascript
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_TITLE_CHARS,
  SESSIONS_KEY,
  persistSessions,
  readStorage,
  restoreSessions,
} from "./playgroundUtils";

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createSession(model = null) {
  return { id: createId(), title: "New chat", model, messages: [], updatedAt: Date.now() };
}

// One conversation store for the page: hydrate from localStorage on mount,
// write through on every change, and keep the CRUD surface the UI needs.
export default function usePlaygroundSessions() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStorage(SESSIONS_KEY, (value) => restoreSessions(value) !== null);
    const restored = restoreSessions(stored);
    if (restored) {
      setSessions(restored.conversations);
      setActiveId(restored.activeId);
    } else {
      const first = createSession();
      setSessions([first]);
      setActiveId(first.id);
    }
    setHydrated(true);
  }, []);

  // Streaming patches land every few dozen milliseconds; debounce the write so
  // localStorage is not serialized on every token.
  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => persistSessions({ activeId, conversations: sessions }), 600);
    return () => clearTimeout(timer);
  }, [hydrated, activeId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) || sessions[0] || null,
    [sessions, activeId],
  );

  const updateSession = useCallback((id, updater) => {
    setSessions((current) => current.map((session) => (
      session.id === id ? { ...updater(session), updatedAt: Date.now() } : session
    )));
  }, []);

  const newSession = useCallback((model) => {
    const session = createSession(model);
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    return session;
  }, []);

  const duplicateSession = useCallback((source) => {
    if (!source) return;
    const copy = {
      ...source,
      id: createId(),
      title: `${source.title} (copy)`.slice(0, MAX_TITLE_CHARS),
      messages: source.messages.map((message) => ({ ...message, id: createId() })),
      updatedAt: Date.now(),
    };
    setSessions((current) => [copy, ...current]);
    setActiveId(copy.id);
  }, []);

  const deleteSession = useCallback((id) => {
    const remaining = sessions.filter((session) => session.id !== id);
    if (remaining.length === 0) {
      const fresh = createSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setSessions(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  }, [sessions, activeId]);

  return {
    sessions,
    activeId,
    activeSession,
    setActiveId,
    newSession,
    duplicateSession,
    deleteSession,
    updateSession,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/usePlaygroundSessions.js"
git add "src/app/(dashboard)/dashboard/playground/usePlaygroundSessions.js" tests/unit/playground-redesign-behavior.test.js
git commit -m "feat(playground): persist conversations in localStorage"
```

---

### Task 6: Streaming turn engine hook

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/usePlaygroundChat.js`
- Test: `tests/unit/playground-redesign-behavior.test.js` (append)

**Interfaces:**
- Consumes: `buildTurnBody` (Task 4).
- Produces: default export `usePlaygroundChat({ apiKey, settings, onAppend, onPatch, onFinish })` returning `{ isStreaming, run, stop }`.
  - `onAppend(sessionId, messages)` — page appends `[userMessage, assistantPlaceholder]`.
  - `onPatch(sessionId, assistantId, patch)` — page merges the patch into that message.
  - `onFinish({ sessionId, assistantId, status, content, messages })` — fires once per turn after the last patch; `messages` is the full turn transcript (history + user + assistant), ready for the follow-up helper.
  - `run({ sessionId, question, history, model })` — streams one turn; no-op while another turn is in flight.
  - `stop()` — aborts the current turn, keeping partial output.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground turn engine", () => {
  it("streams through the documented endpoint", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain('const CHAT_ENDPOINT = "/api/v1/chat/completions"');
    expect(source).toContain('Accept: "text/event-stream"');
    expect(source).toContain("buildTurnBody");
  });

  it("reads reasoning and usage deltas", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("reasoning_content");
    expect(source).toContain("finish_reason");
    expect(source).toContain("chunk?.usage");
  });

  it("reports partial turns as stopped", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain('error?.name === "AbortError"');
    expect(source).toContain("stopped: true");
    expect(source).toContain("abortRef.current?.abort()");
  });

  it("pushes every update through the page callbacks", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("onAppend(sessionId");
    expect(source).toContain("onPatch(sessionId");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: FAIL — `ENOENT` for `usePlaygroundChat.js`.

- [ ] **Step 3: Implement the hook**

```javascript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildTurnBody } from "./playgroundUtils";

// Chat goes through the same OpenAI-compatible endpoint every other client uses,
// so combos, provider fallback, translation and usage tracking all apply unchanged.
const CHAT_ENDPOINT = "/api/v1/chat/completions";

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function errorMessageFrom(payload) {
  const raw = payload?.error?.message ?? payload?.error ?? payload?.message ?? payload?.msg;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return "";
}

function reasoningDeltaFrom(delta) {
  const raw = delta?.reasoning_content ?? delta?.reasoning;
  return typeof raw === "string" ? raw : "";
}

export default function usePlaygroundChat({ apiKey, settings, onAppend, onPatch, onFinish }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async ({ sessionId, question, history, model }) => {
    const text = (question || "").trim();
    if (!text || !model?.value || streamingRef.current) return;

    const assistantId = createId();
    const startedAt = Date.now();
    const userMessage = { id: createId(), role: "user", content: text };

    onAppend(sessionId, [
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        modelName: model.name,
        providerId: model.providerId,
        providerName: model.providerName,
        isCombo: model.isCombo,
        startedAt,
        reasoning: "",
        thinkingMs: null,
        elapsedMs: null,
        meta: null,
      },
    ]);

    streamingRef.current = true;
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (values) => onPatch(sessionId, assistantId, values);

    let content = "";
    let reasoning = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";
    let firstTokenMs = null;
    let thinkingMs = null;
    let thinkingStartedAt = null;
    let thinkingEndedAt = null;

    const finalize = (status, extra = {}) => {
      const elapsedMs = Date.now() - startedAt;
      patch({
        content,
        reasoning,
        status,
        elapsedMs,
        thinkingMs: thinkingMs ?? (thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null),
        meta: {
          latencyMs: elapsedMs,
          firstTokenMs,
          usage,
          finishReason,
          responseModel,
          requestedModel: model.value,
          ...extra,
        },
      });
      onFinish?.({
        sessionId,
        assistantId,
        status,
        content,
        messages: [...history, userMessage, { role: "assistant", content }],
      });
    };

    try {
      const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const body = buildTurnBody({ model, messages: [...history, userMessage] }, settings);
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(errorMessageFrom(payload) || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error("The response contained no body to read.");

      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const payload = await response.json().catch(() => null);
        const failure = errorMessageFrom(payload);
        if (failure) throw new Error(failure);
        const message = payload?.choices?.[0]?.message;
        content = typeof message?.content === "string" ? message.content : "";
        reasoning = reasoningDeltaFrom(message);
        usage = payload?.usage || null;
        finishReason = payload?.choices?.[0]?.finish_reason || "";
        responseModel = typeof payload?.model === "string" ? payload.model : "";
        finalize(content || reasoning ? "done" : "empty");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          if (chunk?.error) throw new Error(errorMessageFrom(chunk) || "Request failed.");

          const choice = chunk?.choices?.[0];
          const deltaText = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
          const deltaReasoning = reasoningDeltaFrom(choice?.delta);
          if (deltaReasoning) {
            if (!thinkingStartedAt) thinkingStartedAt = Date.now();
            reasoning += deltaReasoning;
          }
          if (deltaText) {
            if (!firstTokenMs) firstTokenMs = Date.now() - startedAt;
            if (thinkingStartedAt && !thinkingEndedAt) thinkingEndedAt = Date.now();
            content += deltaText;
          }
          if (deltaText || deltaReasoning) patch({ content, reasoning });
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
          if (typeof chunk?.model === "string" && chunk.model) responseModel = chunk.model;
        }
      }

      thinkingMs = thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null;
      finalize(content || reasoning ? "done" : "empty");
    } catch (error) {
      thinkingMs = thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null;
      if (error?.name === "AbortError") {
        finalize("done", { stopped: true });
      } else {
        patch({
          content,
          reasoning,
          status: "error",
          thinkingMs,
          error: error?.message || "Request failed.",
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
    }
  }, [apiKey, settings, onAppend, onPatch, onFinish]);

  return { isStreaming, run, stop };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/usePlaygroundChat.js"
git add "src/app/(dashboard)/dashboard/playground/usePlaygroundChat.js" tests/unit/playground-redesign-behavior.test.js
git commit -m "feat(playground): extract the streaming turn engine"
```

### Task 7: Empty state and transcript viewport

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundEmpty.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js`
- Test: `tests/unit/playground-redesign-shell.test.js` (create)

**Interfaces:**
- `PlaygroundEmpty({ hint, showSuggestions, onSuggestion })` — renders the decorative SVG, `Start a conversation`, the hint, and four suggestion buttons.
- `PlaygroundTranscript({ messages, isStreaming, renderMessage, empty, loadError })` — owns the scroll container (80px bottom threshold), autoscroll, and the scroll-to-bottom pill. `renderMessage(message)` returns the row node.
- Class names referenced here are authored in Task 13: `viewport`, `transcript`, `column`, `scrollPill`, `loadError`, `empty`, `emptyArt`, `emptyTitle`, `emptyHint`, `suggestions`, `suggestion`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/playground-redesign-shell.test.js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PLAYGROUND = "src/app/(dashboard)/dashboard/playground";

describe("playground transcript shell", () => {
  it("renders the empty state art and four suggestions", () => {
    const source = read(`${PLAYGROUND}/PlaygroundEmpty.js`);
    expect(source).toContain("Start a conversation");
    expect(source).toContain("aria-hidden=\"true\"");
    expect(source.match(/suggestion\b/g)?.length).toBeGreaterThan(0);
    expect(source).toContain("Explain how fallback works in a combo");
    expect(source).toContain("Write a curl command to test my endpoint");
    expect(source).toContain("Draft a system prompt for a code reviewer");
    expect(source).toContain("Summarize this stack trace and suggest a fix");
  });

  it("scrolls only its own viewport", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toContain('role="log"');
    expect(source).toContain("aria-label=\"Conversation\"");
    expect(source).toContain("BOTTOM_THRESHOLD = 80");
    expect(source).toContain("element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD");
    expect(source).toContain("Scroll to bottom");
  });

  it("autoscrolls only while the reader is at the bottom", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toMatch(/if \(!atBottomRef\.current\) return/);
    expect(source).toContain("onScroll");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `PlaygroundEmpty.js`.

- [ ] **Step 3: Create the empty state**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundEmpty.js
"use client";

import PropTypes from "prop-types";
import styles from "./playground.module.css";

const SUGGESTIONS = [
  "Explain how fallback works in a combo",
  "Write a curl command to test my endpoint",
  "Draft a system prompt for a code reviewer",
  "Summarize this stack trace and suggest a fix",
];

export default function PlaygroundEmpty({ hint, showSuggestions, onSuggestion }) {
  return (
    <div className={styles.empty}>
      <svg className={styles.emptyArt} viewBox="0 0 300 140" aria-hidden="true">
        <defs>
          <radialGradient id="pgArtA" cx="0.35" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#ff9cc0" />
            <stop offset="1" stopColor="#ff4d8b" />
          </radialGradient>
          <radialGradient id="pgArtB" cx="0.4" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#d9ccf8" />
            <stop offset="1" stopColor="#b8a4ed" />
          </radialGradient>
          <radialGradient id="pgArtC" cx="0.4" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#f6d98a" />
            <stop offset="1" stopColor="#e8b94a" />
          </radialGradient>
        </defs>
        <circle cx="232" cy="38" r="20" fill="#ffb084" />
        <path d="M0 140C16 140 34 62 68 62C102 62 120 140 140 140Z" fill="url(#pgArtA)" />
        <path d="M120 140C134 140 150 70 182 12C214 70 228 140 244 140Z" fill="url(#pgArtB)" transform="translate(6 0)" />
        <path d="M200 140C212 140 226 84 252 84C278 84 290 140 300 140Z" fill="url(#pgArtC)" />
      </svg>
      <h2 className={styles.emptyTitle}>Start a conversation</h2>
      <p className={styles.emptyHint}>{hint}</p>
      {showSuggestions ? (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestion}
              onClick={() => onSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

PlaygroundEmpty.propTypes = {
  hint: PropTypes.string.isRequired,
  showSuggestions: PropTypes.bool,
  onSuggestion: PropTypes.func.isRequired,
};
```

- [ ] **Step 4: Create the transcript viewport**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js
"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/shared/components/Icon";
import styles from "./playground.module.css";

const BOTTOM_THRESHOLD = 80;

export default function PlaygroundTranscript({ messages, isStreaming, renderMessage, empty, loadError }) {
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const [showPill, setShowPill] = useState(false);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const syncAtBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD;
    setShowPill(!atBottomRef.current);
  }, []);

  // New output only pulls the reader down while they are already at the bottom.
  useEffect(() => {
    if (!atBottomRef.current) return;
    scrollToBottom();
    setShowPill(false);
  }, [messages, isStreaming, scrollToBottom]);

  return (
    <div className={styles.viewport}>
      <div
        ref={scrollRef}
        className={styles.transcript}
        role="log"
        aria-label="Conversation"
        tabIndex={0}
        onScroll={syncAtBottom}
      >
        <div className={styles.column}>
          {loadError ? (
            <p className={styles.loadError} role="alert">
              <Icon>error</Icon>
              {loadError}
            </p>
          ) : null}
          {messages.length === 0 ? empty : messages.map(renderMessage)}
        </div>
      </div>

      <button
        type="button"
        className={styles.scrollPill}
        hidden={!showPill}
        onClick={() => {
          atBottomRef.current = true;
          scrollToBottom();
          setShowPill(false);
        }}
      >
        <Icon>arrow_downward</Icon>
        <span>Scroll to bottom</span>
      </button>
    </div>
  );
}

PlaygroundTranscript.propTypes = {
  messages: PropTypes.array.isRequired,
  isStreaming: PropTypes.bool,
  renderMessage: PropTypes.func.isRequired,
  empty: PropTypes.node.isRequired,
  loadError: PropTypes.string,
};
```

- [ ] **Step 5: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundEmpty.js" "src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundEmpty.js" "src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): add the transcript viewport and empty state"
```

---

### Task 8: Message row

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundMessage.js`
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- `PlaygroundModelIcon({ providerId, providerName, providerColor, isCombo, size })` — provider logo or neutral tile.
- `PlaygroundMessage({ message, isLast, isStreaming, thinkingOpen, raw, copied, onCopy, onDelete, onRetry, onToggleThinking, onToggleRaw, onFollowUp })`.
- Uses `buildMetaParts` and `formatSeconds` from Task 4, and `PlaygroundMarkdown` unchanged.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground message row", () => {
  it("keeps the template message anatomy", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("YOU");
    expect(source).toContain("Thought for");
    expect(source).toContain("Retry");
    expect(source).toContain("Rendered");
    expect(source).toContain("Raw");
    expect(source).toContain("Delete reply");
  });

  it("renders user bubbles on the right and dividers between turns", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("rowUser");
    expect(source).toContain("divider");
  });

  it("keeps the real metric line", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("buildMetaParts");
    expect(source).toContain("metaSep");
  });

  it("only offers retry on the last reply", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("isLast ?");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `PlaygroundMessage.js`.

- [ ] **Step 3: Create the model icon**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import styles from "./playground.module.css";

export default function PlaygroundModelIcon({ providerId, providerName, providerColor, isCombo, size = 18 }) {
  if (!providerId) {
    return (
      <span className={styles.modelFallback} style={{ width: size, height: size }}>
        <Icon style={{ fontSize: Math.max(10, Math.round(size * 0.7)) }}>
          {isCombo ? "layers" : "science"}
        </Icon>
      </span>
    );
  }
  return (
    <ProviderIcon
      providerId={providerId}
      alt={providerName || "model"}
      size={size}
      fallbackText={(providerName || "?").slice(0, 2).toUpperCase()}
      fallbackColor={providerColor}
    />
  );
}

PlaygroundModelIcon.propTypes = {
  providerId: PropTypes.string,
  providerName: PropTypes.string,
  providerColor: PropTypes.string,
  isCombo: PropTypes.bool,
  size: PropTypes.number,
};
```

- [ ] **Step 4: Create the message row**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundMessage.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import PlaygroundModelIcon from "./PlaygroundModelIcon";
import { buildMetaParts, formatSeconds } from "./playgroundUtils";
import styles from "./playground.module.css";

function statusLabel(message) {
  if (message.status === "streaming") {
    if (message.content) return "writing…";
    if (message.reasoning) return "thinking…";
    return "waiting…";
  }
  if (message.elapsedMs) return `for ${formatSeconds(message.elapsedMs)}`;
  return "";
}

export default function PlaygroundMessage({
  message,
  isLast,
  isStreaming,
  thinkingOpen,
  raw,
  copied,
  onCopy,
  onDelete,
  onRetry,
  onToggleThinking,
  onToggleRaw,
  onFollowUp,
}) {
  if (message.role === "divider") {
    return <p className={styles.divider}>{message.content}</p>;
  }

  if (message.role === "user") {
    return (
      <div className={`${styles.row} ${styles.rowUser}`}>
        <div className={styles.userBubble}>{message.content}</div>
        <div className={styles.userMeta}>
          <span>YOU</span>
          <button type="button" className={styles.iconAction} onClick={() => onCopy(message)} aria-label="Copy message">
            <Icon>{copied ? "check" : "content_copy"}</Icon>
          </button>
          <button type="button" className={styles.iconAction} onClick={() => onDelete(message.id)} aria-label="Delete message">
            <Icon>delete</Icon>
          </button>
        </div>
      </div>
    );
  }

  const status = statusLabel(message);
  const isWaiting = message.status === "streaming" && !message.content && !message.reasoning;
  const isThinking = message.status === "streaming" && !!message.reasoning && !message.content;
  const showActions = message.status !== "streaming" && message.status !== "error";
  const parts = message.meta ? buildMetaParts(message.meta) : [];
  const thoughtLabel = isThinking
    ? "Thinking…"
    : message.thinkingMs
      ? `Thought for ${formatSeconds(message.thinkingMs)}`
      : "Thoughts";

  return (
    <article className={styles.assistantCard}>
      <header className={styles.assistantHead}>
        <span className={styles.modelTile}>
          <PlaygroundModelIcon
            providerId={message.providerId}
            providerName={message.providerName}
            isCombo={message.isCombo}
            size={18}
          />
        </span>
        <b className={styles.assistantName}>{message.modelName || "Assistant"}</b>
        <span className={styles.assistantTag}>{message.isCombo ? "combo" : message.providerName || ""}</span>
        <span className={styles.assistantStatus}>
          {isWaiting ? <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span> : null}
          {status}
        </span>

        {showActions ? (
          <div className={styles.actions}>
            {isLast ? (
              <button type="button" className={styles.actionButton} onClick={() => onRetry(message.id)}>
                <Icon>refresh</Icon>
                <span>Retry</span>
              </button>
            ) : null}
            <button type="button" className={styles.actionButton} onClick={() => onToggleRaw(message.id)}>
              <Icon>code</Icon>
              <span>{raw ? "Rendered" : "Raw"}</span>
            </button>
            <button type="button" className={styles.actionButton} onClick={() => onCopy(message)}>
              <Icon>{copied ? "check" : "content_copy"}</Icon>
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" className={styles.iconAction} onClick={() => onDelete(message.id)} aria-label="Delete reply">
              <Icon>delete</Icon>
            </button>
          </div>
        ) : null}
      </header>

      {message.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorHead}><Icon>error</Icon> Request failed</p>
          <p className={styles.errorBody}>{message.error || "Request failed."}</p>
          <button type="button" className={styles.retryButton} onClick={() => onRetry(message.id)}>
            <Icon>refresh</Icon>
            Retry
          </button>
        </div>
      ) : (
        <>
          {message.reasoning ? (
            <div className={styles.thinking}>
              <button
                type="button"
                className={styles.thinkingToggle}
                onClick={() => onToggleThinking(message.id)}
                aria-expanded={thinkingOpen}
              >
                <Icon>stars</Icon>
                {thoughtLabel}
                <Icon className={styles.chevronSmall}>{thinkingOpen ? "expand_less" : "expand_more"}</Icon>
              </button>
              {thinkingOpen ? <div className={styles.thinkingBody}>{message.reasoning}</div> : null}
            </div>
          ) : null}

          {message.content ? (
            <div className={styles.assistantBody}>
              {raw ? (
                <pre className={styles.rawBody}>{message.content}</pre>
              ) : (
                <PlaygroundMarkdown content={message.content} />
              )}
              {isStreaming && message.status === "streaming" && message.content ? (
                <span className={styles.caret} aria-hidden="true">▍</span>
              ) : null}
            </div>
          ) : null}

          {!message.content && !message.reasoning && message.status !== "streaming" ? (
            <p className={styles.note}>
              {message.meta?.stopped ? "Stopped before any output." : "The model returned no text."}
            </p>
          ) : null}

          {!message.content && message.reasoning && message.status !== "streaming" ? (
            <p className={styles.note}>This model returned reasoning only.</p>
          ) : null}
        </>
      )}

      {isLast && !isStreaming && message.followUps?.length ? (
        <div className={styles.followUps}>
          {message.followUps.map((question) => (
            <button key={question} type="button" className={styles.followUp} onClick={() => onFollowUp(question)}>
              {question}
            </button>
          ))}
        </div>
      ) : null}

      {parts.length > 0 ? (
        <p className={styles.meta}>
          {parts.map((part, index) => (
            <span key={`${part}-${index}`}>
              {index > 0 ? <span className={styles.metaSep}>·</span> : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

PlaygroundMessage.propTypes = {
  message: PropTypes.object.isRequired,
  isLast: PropTypes.bool,
  isStreaming: PropTypes.bool,
  thinkingOpen: PropTypes.bool,
  raw: PropTypes.bool,
  copied: PropTypes.bool,
  onCopy: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  onToggleThinking: PropTypes.func.isRequired,
  onToggleRaw: PropTypes.func.isRequired,
  onFollowUp: PropTypes.func.isRequired,
};
```

- [ ] **Step 5: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundMessage.js" "src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundMessage.js" "src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): render message rows with thinking and raw modes"
```

---

### Task 9: Composer, command palette and rail popover

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundComposer.js`
- Modify: `src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js` (rewrite)
- Modify: `src/app/(dashboard)/dashboard/playground/ModelPickerPopover.module.css` (rewrite)
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- `PlaygroundComposer({ value, onChange, onSend, onStop, isStreaming, canSend, model, pickerOpen, onOpenPicker, picker, onOpenHistory, historyCount, think, onToggleThink, settingsOpen, onToggleSettings, settingsPanel, onCommand, textareaRef })`.
- `onCommand(key)` receives one of `"/new" | "/clear" | "/history" | "/model" | "/settings" | "/export"`; the page runs it and clears the input.
- Rewritten `ModelPickerPopover({ isOpen, onClose, onSelect, selectedModel, activeProviders, modelAliases, favorites, onToggleFavorite })` renders `ModelPickerList variant="rail"`.
- Class names authored in Task 13: `composerShell`, `composerWrap`, `composer`, `textarea`, `composerBar`, `tool`, `toolBadge`, `toolLabel`, `spacer`, `sendButton`, `hint`, `palette`, `paletteItem`.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground composer", () => {
  it("hosts the model trigger and toggles in the composer", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    expect(source).toContain("data-model-trigger");
    expect(source).toContain("History");
    expect(source).toContain("Think");
    expect(source).toContain("aria-pressed={think}");
    expect(source).toContain("aria-expanded={settingsOpen}");
  });

  it("implements the six slash commands", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    for (const key of ["/new", "/clear", "/history", "/model", "/settings", "/export"]) {
      expect(source).toContain(`key: "${key}"`);
    }
    expect(source).toContain("ArrowDown");
    expect(source).toContain("ArrowUp");
  });

  it("keeps Enter to send and Shift+Enter for a newline", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    expect(source).toContain("!event.shiftKey");
    expect(source).toContain("isComposing");
  });

  it("uses the shared rail picker", () => {
    const popover = read(`${PLAYGROUND}/ModelPickerPopover.js`);
    expect(popover).toContain('variant="rail"');
    expect(popover).toContain("favorites={favorites}");
    expect(popover).toContain("onToggleFavorite={onToggleFavorite}");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `PlaygroundComposer.js`.

- [ ] **Step 3: Create the composer**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundComposer.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import PlaygroundModelIcon from "./PlaygroundModelIcon";
import styles from "./playground.module.css";

const MAX_COMPOSER_HEIGHT = 200;

const COMMANDS = [
  { key: "/new", label: "New conversation" },
  { key: "/clear", label: "Clear this conversation" },
  { key: "/history", label: "Open conversations" },
  { key: "/model", label: "Choose a model" },
  { key: "/settings", label: "Open settings" },
  { key: "/export", label: "Export code" },
];

export default function PlaygroundComposer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  canSend,
  model,
  pickerOpen,
  onOpenPicker,
  picker,
  onOpenHistory,
  historyCount,
  think,
  onToggleThink,
  settingsOpen,
  onToggleSettings,
  settingsPanel,
  onCommand,
  textareaRef,
}) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const commands = useMemo(() => {
    if (!/^\/\w*$/.test(value)) return [];
    return COMMANDS.filter((command) => command.key.startsWith(value.toLowerCase()));
  }, [value]);

  const paletteOpen = commands.length > 0 && !dismissed;

  useEffect(() => {
    setCommandIndex(0);
  }, [value]);

  useEffect(() => {
    setDismissed(false);
  }, [value]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [value, textareaRef]);

  const runCommand = (key) => {
    setDismissed(true);
    onCommand(key);
  };

  const handleKeyDown = (event) => {
    if (paletteOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((index) => (index + 1) % commands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex((index) => (index - 1 + commands.length) % commands.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        runCommand(commands[commandIndex].key);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className={styles.composerShell}>
      <div className={styles.column}>
        <div className={styles.composerWrap}>
          {picker}
          {settingsPanel}

          {paletteOpen ? (
            <div id="playground-commands" className={styles.palette} role="listbox" aria-label="Commands">
              {commands.map((command, index) => (
                <button
                  key={command.key}
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  className={styles.paletteItem}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(command.key)}
                >
                  <b>{command.key}</b>
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.composer}>
            <textarea
              ref={textareaRef}
              rows={1}
              className={styles.textarea}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={model ? `Ask ${model.name} anything, or type / for commands…` : "Select a model to start…"}
              aria-label="Message"
              aria-controls={paletteOpen ? "playground-commands" : undefined}
            />

            <div className={styles.composerBar}>
              <button
                type="button"
                data-model-trigger
                className={styles.tool}
                onClick={onOpenPicker}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
              >
                <PlaygroundModelIcon
                  providerId={model?.providerId}
                  providerName={model?.providerName}
                  providerColor={model?.providerColor}
                  isCombo={model?.isCombo}
                  size={16}
                />
                <span className={styles.toolLabel}>{model ? model.name : "Select a model"}</span>
                <Icon>expand_more</Icon>
              </button>

              <button type="button" className={styles.tool} onClick={onOpenHistory}>
                <Icon>chat</Icon>
                <span className={styles.toolLabel}>History</span>
                <span className={styles.toolBadge}>{historyCount}</span>
              </button>

              <button
                type="button"
                className={styles.tool}
                aria-pressed={think}
                onClick={onToggleThink}
              >
                <Icon>psychology</Icon>
                <span className={styles.toolLabel}>Think</span>
              </button>

              <button
                type="button"
                className={styles.tool}
                aria-label="Playground settings"
                aria-expanded={settingsOpen}
                onClick={onToggleSettings}
              >
                <Icon>more_vert</Icon>
              </button>

              <span className={styles.spacer} />

              {isStreaming ? (
                <button type="button" className={styles.sendButton} data-mode="stop" onClick={onStop} aria-label="Stop generating">
                  <Icon>stop</Icon>
                </button>
              ) : (
                <button type="button" className={styles.sendButton} onClick={onSend} disabled={!canSend} aria-label="Send message">
                  <Icon>arrow_upward</Icon>
                </button>
              )}
            </div>
          </div>

          <p className={styles.hint}>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

PlaygroundComposer.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  onStop: PropTypes.func.isRequired,
  isStreaming: PropTypes.bool,
  canSend: PropTypes.bool,
  model: PropTypes.object,
  pickerOpen: PropTypes.bool,
  onOpenPicker: PropTypes.func.isRequired,
  picker: PropTypes.node,
  onOpenHistory: PropTypes.func.isRequired,
  historyCount: PropTypes.number,
  think: PropTypes.bool,
  onToggleThink: PropTypes.func.isRequired,
  settingsOpen: PropTypes.bool,
  onToggleSettings: PropTypes.func.isRequired,
  settingsPanel: PropTypes.node,
  onCommand: PropTypes.func.isRequired,
  textareaRef: PropTypes.object.isRequired,
};
```

Add `id="playground-commands"` (already in the code above) so `aria-controls` resolves.

- [ ] **Step 4: Rewrite the picker popover**

```javascript
// src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js
"use client";

import PropTypes from "prop-types";
import { useEffect, useLayoutEffect, useRef } from "react";
import ModelPickerList from "@/shared/components/ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import styles from "./ModelPickerPopover.module.css";

// Anchored above the composer trigger. The catalog is the same hook the Combos
// dialogs use, so rail counts, aliases and custom models cannot drift.
export default function ModelPickerPopover({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  activeProviders = [],
  modelAliases = {},
  favorites = [],
  onToggleFavorite,
}) {
  const ref = useRef(null);
  const { visibleGroups, filteredCombos, searchQuery, setSearchQuery } = useModelCatalog({
    isOpen,
    activeProviders,
    modelAliases,
  });

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const popover = ref.current;
    if (!popover) return undefined;
    const updateHeight = () => {
      popover.style.setProperty("--picker-max-height", `${Math.max(240, window.innerHeight - 260)}px`);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (ref.current?.contains(target)) return;
      if (target?.closest?.("[data-model-trigger]")) return;
      setSearchQuery("");
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setSearchQuery("");
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, setSearchQuery]);

  if (!isOpen) return null;

  const handleSelect = (model, group) => {
    setSearchQuery("");
    onSelect({
      ...model,
      providerId: group?.providerId || "",
      providerName: group?.name || "",
      providerColor: group?.color || "",
      isCombo: group?.isCombo === true,
    });
  };

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-label="Select a model">
      <ModelPickerList
        variant="rail"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        combos={filteredCombos}
        groups={visibleGroups}
        selectedModel={selectedModel}
        onSelect={handleSelect}
        autoFocusSearch
        emptyLabel="No model matches that search"
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

ModelPickerPopover.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.array,
  modelAliases: PropTypes.object,
  favorites: PropTypes.arrayOf(PropTypes.string),
  onToggleFavorite: PropTypes.func,
};
```

- [ ] **Step 5: Rewrite the popover stylesheet**

```css
/* src/app/(dashboard)/dashboard/playground/ModelPickerPopover.module.css */
.popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: min(720px, calc(100vw - 48px));
  max-height: var(--picker-max-height, 480px);
  padding: 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r4);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  animation: pickerIn 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.popover > div {
  min-height: 0;
}

@keyframes pickerIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 700px) {
  .popover {
    right: 0;
    width: auto;
    max-height: min(420px, 60dvh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .popover { animation: none; }
}
```

- [ ] **Step 6: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (11 tests).

- [ ] **Step 7: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundComposer.js" "src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundComposer.js" "src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js" "src/app/(dashboard)/dashboard/playground/ModelPickerPopover.module.css" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): move controls into the composer"
```

### Task 10: Settings popover

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundSettingsPopover.js`
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- `PlaygroundSettingsPopover({ settings, onChange(patch), onClose, onExport, onClear })`.
- `onChange` receives a partial settings object (`{system}`, `{temperature}`, `{maxTokens}`, `{topP}`, `{helper}`).
- `onClear` is invoked only after the two-step confirmation; the component owns the armed state.
- Class names authored in Task 13: `settingsPopover`, `settingsHead`, `settingsClose`, `settingsLabel`, `settingsCount`, `settingsTextarea`, `presets`, `preset`, `settingsBlock`, `slider`, `sliderLabels`, `tokens`, `token`, `tokenCustom`, `settingsToggle`, `switch`, `settingsActions`.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground settings popover", () => {
  it("carries the four template presets", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    for (const name of ["Default", "Senior dev", "JSON output", "Concise"]) {
      expect(source).toContain(`"${name}"`);
    }
  });

  it("exposes the sampling controls", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain("min=\"0\"");
    expect(source).toContain("max=\"2\"");
    expect(source).toContain("step=\"0.05\"");
    for (const value of [1024, 2048, 4096, 8192]) {
      expect(source).toContain(String(value));
    }
    expect(source).toContain("Top P");
  });

  it("labels the helper as billed extra calls", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain('role="switch"');
    expect(source).toContain("Extra billed calls");
  });

  it("requires a second click to clear", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain("Click again to clear");
    expect(source).toContain("clearArmed");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `PlaygroundSettingsPopover.js`.

- [ ] **Step 3: Implement the popover**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundSettingsPopover.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { settingsToSliderValue } from "./playgroundUtils";
import styles from "./playground.module.css";

const PRESETS = [
  ["Default", ""],
  ["Senior dev", "You are a senior software engineer. Give precise, production-ready answers, explain trade-offs briefly, and show code when it helps."],
  ["JSON output", "Respond only with valid JSON. Do not add prose or code fences."],
  ["Concise", "Answer as briefly as possible. Skip preambles and filler."],
];

const TOKEN_PRESETS = [1024, 2048, 4096, 8192];

export default function PlaygroundSettingsPopover({ settings, onChange, onClose, onExport, onClear }) {
  const [clearArmed, setClearArmed] = useState(false);
  const [tokensDraft, setTokensDraft] = useState(String(settings.maxTokens));
  const [topPDraft, setTopPDraft] = useState(settings.topP);

  useEffect(() => {
    setTokensDraft(String(settings.maxTokens));
  }, [settings.maxTokens]);

  useEffect(() => {
    setTopPDraft(settings.topP);
  }, [settings.topP]);

  useEffect(() => {
    if (!clearArmed) return undefined;
    const timer = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const commitTokens = () => {
    const value = Number.parseInt(tokensDraft, 10);
    if (Number.isFinite(value) && value > 0) {
      onChange({ maxTokens: value });
    } else {
      setTokensDraft(String(settings.maxTokens));
    }
  };

  const commitTopP = () => {
    const value = Number.parseFloat(topPDraft);
    if (topPDraft === "") {
      onChange({ topP: "" });
    } else if (Number.isFinite(value)) {
      onChange({ topP: String(Math.min(1, Math.max(0, value))) });
    } else {
      setTopPDraft(settings.topP);
    }
  };

  return (
    <div className={styles.settingsPopover} role="dialog" aria-label="Playground settings" data-playground-settings>
      <div className={styles.settingsHead}>
        <span>Playground settings</span>
        <button type="button" className={styles.settingsClose} onClick={onClose} aria-label="Close settings">
          <Icon>close</Icon>
        </button>
      </div>

      <div className={styles.settingsLabel}>
        <span>System prompt</span>
        <small className={styles.settingsCount}>{settings.system.length} chars</small>
      </div>
      <textarea
        className={styles.settingsTextarea}
        value={settings.system}
        onChange={(event) => onChange({ system: event.target.value })}
        placeholder="Give the model behavioral instructions, persona, or output format constraints…"
      />

      <div className={styles.presets}>
        {PRESETS.map(([label, value]) => (
          <button
            key={label}
            type="button"
            className={styles.preset}
            aria-pressed={settings.system === value}
            onClick={() => onChange({ system: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.settingsBlock}>
        <div className={styles.settingsLabel}>
          <span>Temperature</span>
          <small className={styles.settingsCount}>{settingsToSliderValue(settings.temperature).toFixed(2)}</small>
        </div>
        <input
          type="range"
          className={styles.slider}
          min="0"
          max="2"
          step="0.05"
          value={settingsToSliderValue(settings.temperature)}
          onChange={(event) => onChange({ temperature: Number(event.target.value) })}
          aria-label="Temperature"
        />
        <div className={styles.sliderLabels}>
          <span>0.0 (Precise)</span>
          <span>1.0 (Balanced)</span>
          <span>2.0 (Creative)</span>
        </div>
      </div>

      <div className={styles.settingsBlock}>
        <div className={styles.settingsLabel}>
          <span>Max output tokens</span>
        </div>
        <div className={styles.tokens}>
          {TOKEN_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.token}
              aria-pressed={Number(settings.maxTokens) === value}
              onClick={() => onChange({ maxTokens: value })}
            >
              {value}
            </button>
          ))}
        </div>
        <label className={styles.tokenCustom}>
          <span>Custom</span>
          <input
            type="number"
            min="1"
            step="1"
            value={tokensDraft}
            onChange={(event) => setTokensDraft(event.target.value)}
            onBlur={commitTokens}
            onKeyDown={(event) => { if (event.key === "Enter") commitTokens(); }}
          />
        </label>

        <label className={styles.tokenCustom}>
          <span>Top P</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            placeholder="default"
            value={topPDraft}
            onChange={(event) => setTopPDraft(event.target.value)}
            onBlur={commitTopP}
            onKeyDown={(event) => { if (event.key === "Enter") commitTopP(); }}
          />
        </label>
      </div>

      <div className={styles.settingsBlock}>
        <button
          type="button"
          role="switch"
          aria-checked={settings.helper}
          className={styles.settingsToggle}
          onClick={() => onChange({ helper: !settings.helper })}
        >
          <span>
            AI helper requests
            <small>Auto title and follow-up suggestions. Extra billed calls.</small>
          </span>
          <span className={styles.switch} />
        </button>
      </div>

      <div className={styles.settingsActions}>
        <button type="button" className={styles.settingsSecondary} onClick={onExport}>
          <Icon>code</Icon>
          Export code
        </button>
        <button
          type="button"
          className={styles.settingsDanger}
          aria-label={clearArmed ? "Confirm clear conversation" : "Clear conversation"}
          onClick={() => {
            if (!clearArmed) {
              setClearArmed(true);
              return;
            }
            setClearArmed(false);
            onClear();
          }}
        >
          <Icon>delete</Icon>
          {clearArmed ? "Click again to clear" : "Clear"}
        </button>
      </div>
    </div>
  );
}

PlaygroundSettingsPopover.propTypes = {
  settings: PropTypes.shape({
    system: PropTypes.string,
    temperature: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    maxTokens: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    topP: PropTypes.string,
    helper: PropTypes.bool,
    think: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
};
```

- [ ] **Step 4: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundSettingsPopover.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundSettingsPopover.js" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): add the settings popover"
```

---

### Task 11: Conversations and export modals

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundHistoryModal.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundExportModal.js`
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- `PlaygroundHistoryModal({ isOpen, onClose, sessions, activeId, onSelect, onNew, onDuplicate, onDelete })`.
- `PlaygroundExportModal({ isOpen, onClose, body, onCopy })` — `body` is the built export payload (Task 4 `buildExportBody`); the modal renders it in three languages and calls `onCopy(code)`.
- Uses the shared `Modal` (`bare` + `trapFocus` for history, titled for export).
- Class names authored in Task 14: `historyDialog`, `historyHead`, `historyTile`, `historyTitle`, `historySub`, `historyNew`, `historySearch`, `historyList`, `historyRow`, `historyRowActive`, `historyMeta`, `activeBadge`, `historyActions`, `exportDialog`, `exportTabs`, `exportCode`, `exportActions`.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground dialogs", () => {
  it("lists conversations with search and per-row actions", () => {
    const source = read(`${PLAYGROUND}/PlaygroundHistoryModal.js`);
    expect(source).toContain("Conversations");
    expect(source).toContain("Switch or manage saved chat sessions");
    expect(source).toContain("Search chats");
    expect(source).toContain("Active");
    expect(source).toContain("onDuplicate");
    expect(source).toContain("onDelete");
    expect(source).toContain("trapFocus");
  });

  it("exports the three languages", () => {
    const source = read(`${PLAYGROUND}/PlaygroundExportModal.js`);
    expect(source).toContain('"cURL"');
    expect(source).toContain('"JavaScript"');
    expect(source).toContain('"Python"');
    expect(source).toContain("renderCurl");
    expect(source).toContain("renderJavaScript");
    expect(source).toContain("renderPython");
    expect(source).toContain("onCopy");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `PlaygroundHistoryModal.js`.

- [ ] **Step 3: Create the conversations modal**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundHistoryModal.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/Modal";
import { relativeTime } from "./playgroundUtils";
import styles from "./playground-dialogs.module.css";

export default function PlaygroundHistoryModal({ isOpen, onClose, sessions, activeId, onSelect, onNew, onDuplicate, onDelete }) {
  const [query, setQuery] = useState("");
  const [armedId, setArmedId] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setArmedId("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!armedId) return undefined;
    const timer = setTimeout(() => setArmedId(""), 3000);
    return () => clearTimeout(timer);
  }, [armedId]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((session) => {
        if (!needle) return true;
        const haystack = [session.title, session.model?.name || "", ...session.messages.map((message) => message.content)].join(" ").toLowerCase();
        return haystack.includes(needle);
      });
  }, [sessions, query]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conversations" bare trapFocus className={styles.historyDialog}>
      <div className={styles.historyHead}>
        <span className={styles.historyTile}><Icon>chat</Icon></span>
        <div className={styles.historyTitle}>
          <h2>Conversations ({sessions.length})</h2>
          <p className={styles.historySub}>Switch or manage saved chat sessions</p>
        </div>
        <button type="button" className={styles.historyNew} onClick={onNew}>
          <Icon>add</Icon>
          New
        </button>
        <button type="button" className={styles.historyClose} onClick={onClose} aria-label="Close conversations">
          <Icon>close</Icon>
        </button>
      </div>

      <label className={styles.historySearch}>
        <Icon>search</Icon>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats by title, model, or content…"
          aria-label="Search chats"
        />
      </label>

      <div className={styles.historyList}>
        {rows.length === 0 ? (
          <p className={styles.historyEmpty}>No chats match “{query.trim()}”.</p>
        ) : rows.map((session) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            className={`${styles.historyRow} ${session.id === activeId ? styles.historyRowActive : ""}`}
            onClick={() => onSelect(session.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(session.id);
              }
            }}
          >
            <div className={styles.historyMetaWrap}>
              <b>
                {session.title}
                {session.id === activeId ? <span className={styles.activeBadge}>Active</span> : null}
              </b>
              <div className={styles.historyMeta}>
                <span><Icon>bot</Icon>{session.model?.name || "No model"}</span>
                <span>{session.messages.length} msg{session.messages.length === 1 ? "" : "s"}</span>
                <span>{relativeTime(session.updatedAt)}</span>
              </div>
            </div>

            <div className={styles.historyActions}>
              <button
                type="button"
                className={styles.historyAction}
                aria-label={`Duplicate ${session.title}`}
                onClick={(event) => { event.stopPropagation(); onDuplicate(session); }}
              >
                <Icon>content_copy</Icon>
              </button>
              <button
                type="button"
                className={armedId === session.id ? styles.historyConfirm : styles.historyAction}
                aria-label={armedId === session.id ? "Confirm delete" : `Delete ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (armedId !== session.id) {
                    setArmedId(session.id);
                    return;
                  }
                  setArmedId("");
                  onDelete(session.id);
                }}
              >
                {armedId === session.id ? "Confirm" : <Icon>delete</Icon>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

PlaygroundHistoryModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  sessions: PropTypes.array.isRequired,
  activeId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  onNew: PropTypes.func.isRequired,
  onDuplicate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
```

- [ ] **Step 4: Create the export modal**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundExportModal.js
"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import Modal from "@/shared/components/Modal";
import { renderCurl, renderJavaScript, renderPython } from "./playgroundUtils";
import styles from "./playground-dialogs.module.css";

const TABS = [
  { key: "curl", label: "cURL" },
  { key: "javascript", label: "JavaScript" },
  { key: "python", label: "Python" },
];

function buildCode(tab, body) {
  const origin = typeof window === "undefined" ? "http://localhost:20128" : window.location.origin;
  if (tab === "javascript") return renderJavaScript(body, origin);
  if (tab === "python") return renderPython(body, origin);
  return renderCurl(body, origin);
}

export default function PlaygroundExportModal({ isOpen, onClose, body, onCopy }) {
  const [tab, setTab] = useState("curl");

  useEffect(() => {
    if (!isOpen) setTab("curl");
  }, [isOpen]);

  const code = buildCode(tab, body);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export code" size="full" className={styles.exportDialog}>
      <p className={styles.exportLead}>The request for this conversation, with your current settings.</p>

      <div className={styles.exportTabs} role="group" aria-label="Language">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={tab === entry.key}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <pre className={styles.exportCode}>{code}</pre>

      <div className={styles.exportActions}>
        <button type="button" className={styles.exportSecondary} onClick={onClose}>Close</button>
        <button type="button" className={styles.exportPrimary} onClick={() => onCopy(code)}>
          <Icon>content_copy</Icon>
          Copy
        </button>
      </div>
    </Modal>
  );
}

PlaygroundExportModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  body: PropTypes.object.isRequired,
  onCopy: PropTypes.func.isRequired,
};
```

- [ ] **Step 5: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (17 tests).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundHistoryModal.js" "src/app/(dashboard)/dashboard/playground/PlaygroundExportModal.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundHistoryModal.js" "src/app/(dashboard)/dashboard/playground/PlaygroundExportModal.js" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): add conversation history and export dialogs"
```

---

### Task 12: AI helper hook

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/usePlaygroundHints.js`
- Test: `tests/unit/playground-redesign-behavior.test.js` (append)

**Interfaces:**
- Consumes: `sanitizeTitle`, `parseFollowUps` (Task 4).
- Produces: `usePlaygroundHints({ apiKey, model, helper, onTitle, onFollowUps })` returning
  `{ requestTitle(sessionId, question), requestFollowUps(sessionId, assistantId, messages), cancelAll() }`.
  - `onTitle(sessionId, title)`, `onFollowUps(sessionId, assistantId, questions)`.
  - Both requests are non-stream (`stream: false`), abortable, and silent on failure.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground AI helper", () => {
  it("uses non-streaming calls with tight token budgets", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("stream: false");
    expect(source).toContain("24");
    expect(source).toContain("160");
    expect(source).toContain("/api/v1/chat/completions");
  });

  it("parses instead of trusting the model", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("sanitizeTitle");
    expect(source).toContain("parseFollowUps");
  });

  it("is abortable and silent on failure", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("AbortController");
    expect(source).toContain("cancelAll");
    expect(source).toContain('error?.name !== "AbortError"');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: FAIL — `ENOENT` for `usePlaygroundHints.js`.

- [ ] **Step 3: Implement the hook**

```javascript
// src/app/(dashboard)/dashboard/playground/usePlaygroundHints.js
"use client";

import { useCallback, useEffect, useRef } from "react";
import { parseFollowUps, sanitizeTitle } from "./playgroundUtils";

const CHAT_ENDPOINT = "/api/v1/chat/completions";

const TITLE_SYSTEM = "Write a 3 to 6 word title for this conversation. Reply with the title only, no quotes, no trailing punctuation.";
const FOLLOW_UP_SYSTEM = "Suggest exactly three short follow-up questions the user might ask next. Reply with a JSON array of three strings and nothing else.";

async function callHelper({ apiKey, model, messages, maxTokens, temperature, signal }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.value,
      messages,
      stream: false,
      max_tokens: maxTokens,
      temperature,
    }),
    signal,
  });
  if (!response.ok) return "";

  const payload = await response.json().catch(() => null);
  const message = payload?.choices?.[0]?.message;
  return typeof message?.content === "string" ? message.content : "";
}

// Extra billed calls are opt-in through the AI helper setting. Both requests are
// fire-and-forget: they never block a turn, and a failure simply removes the
// title or the suggestion pills.
export default function usePlaygroundHints({ apiKey, model, helper, onTitle, onFollowUps }) {
  const controllersRef = useRef(new Set());

  const cancelAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  useEffect(() => cancelAll, [cancelAll]);

  const call = useCallback(async (messages, maxTokens, temperature) => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      return await callHelper({ apiKey, model, messages, maxTokens, temperature, signal: controller.signal });
    } catch (error) {
      if (error?.name !== "AbortError") console.warn("Playground helper call failed:", error);
      return "";
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [apiKey, model]);

  const requestTitle = useCallback(async (sessionId, question) => {
    if (!helper || !model?.value) return;
    const raw = await call([
      { role: "system", content: TITLE_SYSTEM },
      { role: "user", content: question.slice(0, 1200) },
    ], 24, 0.3);
    const title = sanitizeTitle(raw);
    if (title) onTitle(sessionId, title);
  }, [helper, model, call, onTitle]);

  const requestFollowUps = useCallback(async (sessionId, assistantId, messages) => {
    if (!helper || !model?.value) return;
    const recent = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 1200) }));

    const raw = await call([
      { role: "system", content: FOLLOW_UP_SYSTEM },
      ...recent,
    ], 160, 0.7);

    const questions = parseFollowUps(raw);
    if (questions.length > 0) onFollowUps(sessionId, assistantId, questions);
  }, [helper, model, call, onFollowUps]);

  return { requestTitle, requestFollowUps, cancelAll };
}
```

- [ ] **Step 4: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-behavior.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/usePlaygroundHints.js"
git add "src/app/(dashboard)/dashboard/playground/usePlaygroundHints.js" tests/unit/playground-redesign-behavior.test.js
git commit -m "feat(playground): add opt-in title and follow-up helper calls"
```

### Task 13: Main stylesheet

**Files:**
- Modify: `src/app/(dashboard)/dashboard/playground/playground.module.css` (full rewrite)
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- Consumes: every class name declared in Tasks 7–12 and the page shell in Task 15.
- Produces: the complete set of class names those components import. No other module may redefine them.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground stylesheet", () => {
  it("uses the template radius and tokens", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).toContain("border-radius: var(--r4)");
    expect(css).toContain("var(--brand-lavender)");
    expect(css).toContain("var(--surface-card)");
  });

  it("drops the old toolbar layout", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).not.toContain(".toolbar");
    expect(css).not.toContain(".modelTrigger");
  });

  it("keeps the composer flat and the mobile caps", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).not.toContain(".composerWrap::before");
    const composer = css.slice(css.indexOf(".composer {"), css.indexOf(".composer:focus-within"));
    expect(composer).not.toContain("box-shadow");
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 639px)"));
    expect(mobile).toContain("max-height: min(200px, 25dvh)");
    const landscape = css.slice(css.indexOf("@media (max-width: 1023px) and (max-height: 500px)"));
    expect(landscape).toContain("max-height: min(200px, 20dvh)");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — the old sheet still contains `.toolbar` and `.modelTrigger`.

- [ ] **Step 3: Replace the stylesheet**

Replace the entire contents of `src/app/(dashboard)/dashboard/playground/playground.module.css` with:

```css
/* Chat-first playground surface. Tokens only; both themes come from globals.css. */

.page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 20px 32px 24px;
  color: var(--text);
}

.card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r4);
  background: var(--surface);
}

/* ------------------------------------------------------------------ transcript */

.viewport {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 28px;
  scrollbar-width: thin;
}

.transcript:focus-visible {
  outline: none;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  max-width: 820px;
  min-height: 100%;
  min-width: 0;
  margin-inline: auto;
}

.scrollPill {
  position: absolute;
  right: 24px;
  bottom: 14px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 99px;
  background: var(--text);
  color: var(--surface);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
}

.scrollPill[hidden] { display: none; }
.scrollPill svg { font-size: 16px; }

.loadError {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.loadError svg { flex: none; margin-top: 1px; color: var(--danger); font-size: 14px; }

/* ----------------------------------------------------------------- empty state */

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
  text-align: center;
}

.emptyArt { width: 220px; max-width: 70%; height: auto; }

.emptyTitle {
  margin-top: 12px;
  color: var(--text);
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 500;
  letter-spacing: -0.05em;
  line-height: 1.2;
}

.emptyHint {
  max-width: 46ch;
  margin-top: 6px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.6;
}

.suggestions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
  max-width: 640px;
  margin-top: 24px;
}

.suggestion {
  padding: 14px 16px;
  border: 0;
  border-radius: var(--r3);
  background: var(--surface-card);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.suggestion:hover { background: var(--surface-strong); }
.suggestion:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

/* --------------------------------------------------------------------- messages */

.row { display: flex; flex-direction: column; min-width: 0; }
.rowUser { align-items: flex-end; }

.userBubble {
  max-width: min(580px, 90%);
  padding: 12px 16px;
  border-radius: 20px 20px 6px 20px;
  background: var(--brand-lavender);
  color: #0a0a0a;
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.userMeta {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  color: var(--text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.userMeta span { margin-right: 6px; }

.iconAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.iconAction:hover { background: var(--surface-2); color: var(--text); }
.iconAction svg { font-size: 14px; }

.assistantCard {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 24px 20px;
  border: 1px solid var(--line);
  border-radius: var(--r4);
  background: var(--surface);
}

.assistantHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.modelTile {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text);
}

.modelFallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  color: var(--text-2);
}

.assistantName {
  max-width: 240px;
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistantTag { color: var(--text-3); font-size: 12.5px; }

.assistantStatus {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.dots { display: inline-flex; gap: 4px; }
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-3);
  animation: dotPulse 1.2s infinite;
}
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-wrap: wrap;
}

.actionButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.actionButton:hover { background: var(--surface-strong); color: var(--text); }
.actionButton:disabled { opacity: 0.45; cursor: not-allowed; }
.actionButton svg { font-size: 15px; }

.thinking { margin-top: 12px; }

.thinkingToggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.thinkingToggle svg { color: var(--text-3); font-size: 16px; }
.chevronSmall { font-size: 15px; }

.thinkingBody {
  max-height: 320px;
  margin: 6px 0 0 28px;
  overflow-y: auto;
  padding: 10px 14px;
  border-left: 2px solid var(--line);
  color: var(--text-3);
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.assistantBody {
  margin-top: 14px;
  min-width: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.rawBody {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.caret {
  display: inline-block;
  width: 7px;
  margin-left: 2px;
  color: var(--text-3);
  animation: caretBlink 1.1s steps(2, start) infinite;
}

.note { margin-top: 10px; color: var(--text-3); font-size: 12.5px; font-style: italic; }

.followUps { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }

.followUp {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 99px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.followUp:hover { background: var(--surface-card); }

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 7px;
  margin-top: 10px;
  color: var(--text-3);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.metaSep { opacity: 0.5; }

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-3);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
}

.divider::before,
.divider::after { flex: 1; height: 1px; background: var(--line); content: ""; }

.error {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--danger) 6%, var(--surface));
}

.errorHead { display: flex; align-items: center; gap: 6px; color: var(--danger); font-size: 12.5px; font-weight: 500; }
.errorHead svg { font-size: 14px; }
.errorBody { margin-top: 4px; color: var(--text-2); font-size: 12.5px; line-height: 1.6; overflow-wrap: anywhere; }

.retryButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin-top: 9px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 9px;
  background: transparent;
  color: var(--danger);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* --------------------------------------------------------------------- composer */

.composerShell {
  flex: none;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.composerWrap { position: relative; }

.composer {
  padding: 14px 14px 10px 18px;
  border-radius: 22px;
  background: var(--surface-card);
}

.composer:focus-within { outline: 2px solid color-mix(in srgb, var(--text) 18%, transparent); }

.textarea {
  display: block;
  width: 100%;
  min-height: 28px;
  max-height: 200px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 15px;
  line-height: 1.6;
  outline: none;
  resize: none;
}

.textarea::placeholder { color: var(--text-3); }
.textarea:focus-visible { outline: none; }

.composerBar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.tool:hover { background: var(--surface-strong); }

.tool[aria-pressed="true"],
.tool[aria-expanded="true"] {
  border-color: var(--brand-lavender);
  background: var(--brand-lavender);
  color: #0a0a0a;
}

.tool .toolLabel { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.tool svg { font-size: 15px; color: var(--text-2); }
.tool[aria-pressed="true"] svg,
.tool[aria-expanded="true"] svg { color: #0a0a0a; }

.toolBadge {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 99px;
  background: var(--surface-strong);
  font-size: 11px;
  font-weight: 600;
}

.spacer { flex: 1; }

.sendButton {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: var(--text);
  color: var(--surface);
  cursor: pointer;
}

.sendButton:hover:not(:disabled) { opacity: 0.88; }
.sendButton:disabled { opacity: 0.3; cursor: not-allowed; }
.sendButton[data-mode="stop"] { background: var(--surface-strong); color: var(--text); }
.sendButton svg { font-size: 18px; }

.hint {
  margin-top: 8px;
  color: var(--text-3);
  font-size: 11.5px;
  text-align: center;
}

.hint kbd {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
}

.palette {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 30;
  width: min(420px, 100%);
  max-height: 260px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r3);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.paletteItem {
  display: flex;
  gap: 12px;
  align-items: baseline;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-3);
  text-align: left;
  cursor: pointer;
}

.paletteItem b {
  color: var(--text);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
}

.paletteItem[aria-selected="true"] { background: var(--surface-card); }

/* --------------------------------------------------------------------- settings */

.settingsPopover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  width: min(440px, 100%);
  max-height: min(640px, 62dvh);
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--line-2);
  border-radius: var(--r4);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.settingsHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.settingsClose {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.settingsClose:hover { background: var(--surface-2); color: var(--text); }

.settingsLabel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 8px;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}

.settingsCount { color: var(--text-3); font-size: 12px; font-weight: 500; }

.settingsTextarea {
  width: 100%;
  height: 96px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface-card);
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
  line-height: 1.5;
  resize: none;
}

.settingsTextarea:focus { border-color: var(--text-3); outline: none; }

.presets { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }

.preset {
  flex: 1;
  min-width: 64px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.preset[aria-pressed="true"] { background: var(--text); color: var(--surface); }

.settingsBlock {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--surface-card);
}

.settingsBlock .settingsLabel { margin-top: 0; }

.slider { width: 100%; margin-top: 6px; accent-color: var(--text); }

.sliderLabels {
  display: flex;
  justify-content: space-between;
  color: var(--text-3);
  font-size: 11px;
}

.tokens { display: flex; gap: 6px; flex-wrap: wrap; }

.token {
  flex: 1;
  min-width: 64px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.token[aria-pressed="true"] { background: var(--text); color: var(--surface); }

.tokenCustom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  color: var(--text-2);
  font-size: 12.5px;
}

.tokenCustom input {
  width: 110px;
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  text-align: right;
}

.settingsToggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.settingsToggle small {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 400;
}

.switch {
  position: relative;
  flex: none;
  width: 42px;
  height: 26px;
  border-radius: 99px;
  background: var(--surface-strong);
  transition: background 150ms;
}

.switch::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  content: "";
  transition: transform 150ms;
}

.settingsToggle[aria-checked="true"] .switch { background: var(--text); }
.settingsToggle[aria-checked="true"] .switch::after { transform: translateX(16px); }

.settingsActions { display: flex; gap: 8px; margin-top: 16px; }

.settingsSecondary,
.settingsDanger {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  border-radius: var(--r2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.settingsSecondary { border: 1px solid var(--line-2); background: var(--surface); color: var(--text); }
.settingsDanger { border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); background: transparent; color: var(--danger); }

/* ------------------------------------------------------------------- motion */

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.25; }
  30% { opacity: 1; }
}

@keyframes caretBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}

/* ---------------------------------------------------------------- responsive */

@media (max-width: 1023px) {
  .page { padding: 16px 24px 20px; }
}

@media (max-width: 700px) {
  .suggestions { grid-template-columns: 1fr; }
  .actions .actionButton span { display: none; }
  .tool .toolLabel { display: none; }
  .settingsPopover { right: 0; width: auto; }
}

@media (max-width: 639px) {
  .page { padding: 12px; }
  .transcript { padding: 18px 14px; }
  .assistantCard { padding: 14px 16px 16px; }
  .composerShell { padding: 10px 12px; }
  .composer { padding: 12px 12px 8px 14px; }
  .textarea { max-height: min(200px, 25dvh); font-size: 16px; }
  .hint { display: none; }
  .userBubble { max-width: 92%; }
  .scrollPill { right: 12px; }
  .scrollPill span { display: none; }
  .scrollPill { width: 40px; padding: 0; justify-content: center; }
}

@media (max-width: 1023px) and (max-height: 500px) {
  .textarea { max-height: min(200px, 20dvh); }
}

@media (prefers-reduced-motion: reduce) {
  .dots i,
  .caret { animation: none; }
  .switch,
  .switch::after { transition: none; }
}
```

- [ ] **Step 4: Run the test**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js unit/playground-full-chat.test.js`
Expected: PASS (20 + 7 tests). If `playground-full-chat` fails on the composer slice, check that `.composer {` and `.composer:focus-within` both exist exactly once.

- [ ] **Step 5: Lint and commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/playground.module.css" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): restyle the page as a chat-first surface"
```

---

### Task 14: Dialog, markdown and responsive polish

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/playground-dialogs.module.css`
- Modify: `src/app/(dashboard)/dashboard/playground/playground-markdown.module.css`
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- Consumes: class names required by `PlaygroundHistoryModal` and `PlaygroundExportModal` (Task 11), and the markdown classes used by the untouched `PlaygroundMarkdown.js` (`inlineCode`, `strong`, `strike`, `link`, `codeBlock`, `codeHeader`, `codeLang`, `copyButton`, `codeBody`, `table`, `list`, `quote`, …).
- Produces: the final visual layer for dialogs and assistant prose.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground dialogs and markdown", () => {
  it("styles the history and export dialogs", () => {
    const css = read(`${PLAYGROUND}/playground-dialogs.module.css`);
    for (const name of ["historyDialog", "historyRow", "activeBadge", "exportTabs", "exportCode", "exportActions"]) {
      expect(css).toContain(`.${name}`);
    }
    expect(css).toContain("width: min(660px");
  });

  it("keeps the assistant type scale", () => {
    const css = read(`${PLAYGROUND}/playground-markdown.module.css`);
    expect(css).toContain("font-size: 15px");
    expect(css).toContain("border-radius: 14px");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — `ENOENT` for `playground-dialogs.module.css`.

- [ ] **Step 3: Create the dialog stylesheet**

```css
/* Conversations and export dialogs. Modal supplies the overlay and shell. */

.historyDialog {
  display: flex;
  flex-direction: column;
  width: min(660px, calc(100vw - 32px));
  max-width: min(660px, calc(100vw - 32px));
  max-height: min(640px, calc(100dvh - 32px));
  overflow: hidden;
}

.historyHead {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 20px 16px 24px;
  border-bottom: 1px solid var(--line);
}

.historyTile {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: var(--r3);
  background: var(--surface-card);
  color: var(--text);
}

.historyTile svg { font-size: 20px; }

.historyTitle { flex: 1; min-width: 0; }
.historyTitle h2 { color: var(--text); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.historySub { margin-top: 2px; color: var(--text-3); font-size: 12.5px; }

.historyNew {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--text);
  color: var(--surface);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.historyNew svg { font-size: 15px; }

.historyClose {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.historyClose:hover { background: var(--surface-2); color: var(--text); }

.historySearch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 24px 12px;
  height: 44px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  color: var(--text-3);
}

.historySearch:focus-within { border-color: var(--text-3); }
.historySearch svg { font-size: 16px; flex: none; }

.historySearch input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  outline: none;
}

.historyList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 24px 24px;
}

.historyRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  cursor: pointer;
}

.historyRow:hover { background: var(--surface-card); }
.historyRowActive { background: var(--surface-card); border-color: var(--line-2); }

.historyMetaWrap { flex: 1; min-width: 0; }
.historyMetaWrap b {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activeBadge {
  flex: none;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--text);
  color: var(--surface);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.historyMeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 3px;
  color: var(--text-3);
  font-size: 12px;
}

.historyMeta span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.historyMeta svg { font-size: 13px; flex: none; }

.historyActions { display: flex; align-items: center; gap: 2px; flex: none; }

.historyAction {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.historyAction:hover { background: var(--surface-strong); color: var(--text); }

.historyConfirm {
  height: 32px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 9px;
  background: transparent;
  color: var(--danger);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.historyEmpty {
  padding: 28px 0;
  color: var(--text-3);
  font-size: 12.5px;
  text-align: center;
}

.exportDialog {
  width: min(680px, calc(100vw - 32px));
  max-width: min(680px, calc(100vw - 32px));
}

.exportLead { margin-top: 4px; color: var(--text-2); font-size: 12.5px; }

.exportTabs {
  display: inline-flex;
  gap: 2px;
  margin: 14px 0;
  padding: 4px;
  border-radius: 99px;
  background: var(--surface-card);
}

.exportTabs button {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 99px;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.exportTabs button[aria-pressed="true"] {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--line);
}

.exportCode {
  max-height: 340px;
  overflow: auto;
  margin: 0;
  padding: 16px;
  border: 1px solid #2a3c3c;
  border-radius: var(--r3);
  background: #0a1a1a;
  color: #e6f1ed;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre;
}

.exportActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

.exportSecondary,
.exportPrimary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border-radius: var(--r2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.exportSecondary { border: 1px solid var(--line-2); background: var(--surface); color: var(--text); }
.exportPrimary { border: 0; background: var(--text); color: var(--surface); }

@media (max-width: 639px) {
  .historyHead { flex-wrap: wrap; }
  .historySearch { margin: 12px 16px 10px; }
  .historyList { padding: 4px 16px 16px; }
  .exportTabs { display: flex; }
  .exportTabs button { flex: 1; padding: 0 8px; }
}
```

- [ ] **Step 4: Restyle the markdown sheet**

Replace `src/app/(dashboard)/dashboard/playground/playground-markdown.module.css` with:

```css
/* Assistant prose. Sizes live in .prose; blocks stay token-driven. */
.prose { color: var(--text); font-size: 15px; line-height: 1.7; overflow-wrap: anywhere; }
.prose > :first-child { margin-top: 0; }
.prose > :last-child { margin-bottom: 0; }

.paragraph { margin: 0 0 12px; }

.heading { margin: 18px 0 8px; color: var(--text); font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; }
.heading1 { font-size: 22px; }
.heading2 { font-size: 20px; }
.heading3 { font-size: 18px; }
.heading4 { font-size: 16px; }
.heading5 { font-size: 15px; }
.heading6 { color: var(--text-2); font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; }

.list { margin: 0 0 12px; padding-left: 22px; }
.listOrdered { list-style: decimal; }
.listUnordered { list-style: disc; }
.list li { margin: 4px 0; }

.blockquote {
  margin: 0 0 12px;
  padding: 2px 0 2px 14px;
  border-left: 2px solid var(--line-2);
  color: var(--text-2);
}

.rule { height: 1px; margin: 16px 0; border: 0; background: var(--line); }

.inlineCode {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--surface-card);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
}

.strong { font-weight: 600; }
.strike { text-decoration: line-through; opacity: 0.8; }
.link { color: inherit; text-decoration: underline; text-underline-offset: 2px; }

.codeBlock {
  position: relative;
  margin: 12px 0;
  border: 1px solid #2a3c3c;
  border-radius: 14px;
  background: #0a1a1a;
  overflow: hidden;
}

.codeHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 6px 14px;
  border-bottom: 1px solid #2a3c3c;
}

.codeLang {
  color: #a0b8b0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.copyButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #e6f1ed;
  font-size: 11px;
  cursor: pointer;
}

.copyButton:hover { background: #1a2a2a; }
.copyButton[data-copied="true"] { color: #4ade80; }

.codeBody {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  color: #e6f1ed;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
}

.tableWrap { margin: 12px 0; overflow-x: auto; }

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th,
.table td {
  padding: 8px 10px;
  border: 1px solid var(--line);
  text-align: left;
}

.table th { background: var(--surface-card); font-weight: 600; }

@media (max-width: 639px) {
  .heading1 { font-size: 20px; }
  .heading2 { font-size: 18px; }
  .codeBody { font-size: 12px; }
}
**Important:** open `PlaygroundMarkdown.js` and confirm every class it references exists in this sheet (it uses `styles.X` names). If it uses a class not listed above, add a rule for that exact class instead of renaming the component. Do not change `PlaygroundMarkdown.js`.

- [ ] **Step 5: Run the tests**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: PASS (22 tests).

- [ ] **Step 6: Lint and commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/playground-dialogs.module.css" "src/app/(dashboard)/dashboard/playground/playground-markdown.module.css" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): style dialogs and assistant prose"
```

### Task 15: Page composition

**Files:**
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` (full rewrite)
- Test: `tests/unit/playground-redesign-shell.test.js` (append)

**Interfaces:**
- Consumes every component and hook from Tasks 5–14.
- Produces the page shell: `page > card > (PlaygroundTranscript, PlaygroundComposer)` plus the two modals outside the card.
- Keeps the existing data loading (`/api/providers`, `/api/models/alias`, `/api/keys`) and the real streaming endpoint through `usePlaygroundChat`.

- [ ] **Step 1: Extend the failing test**

```javascript
describe("playground page composition", () => {
  it("drops the top toolbar and mounts the new surface", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).not.toContain("styles.toolbar");
    expect(source).not.toContain("styles.modelTrigger");
    for (const name of ["PlaygroundTranscript", "PlaygroundComposer", "PlaygroundHistoryModal", "PlaygroundExportModal", "PlaygroundSettingsPopover"]) {
      expect(source).toContain(name);
    }
  });

  it("wires sessions, helpers and the header title", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("usePlaygroundSessions");
    expect(source).toContain("usePlaygroundChat");
    expect(source).toContain("usePlaygroundHints");
    expect(source).toContain("useHeaderTitleStore");
    expect(source).toContain("SETTINGS_KEY");
    expect(source).toContain("FAVORITES_KEY");
  });

  it("persists the active conversation model and dividers", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("Model switched to");
    expect(source).toContain("localTitle");
  });

  it("keeps the old page-header strings out", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).not.toContain("Test and compare models through JRouter");
    expect(source).not.toContain("styles.header");
    expect(source).not.toContain("styles.eyebrow");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js`
Expected: FAIL — the current page still contains `styles.toolbar`.

- [ ] **Step 3: Replace the page client**

```javascript
// src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useHeaderTitleStore } from "@/store/headerTitleStore";
import { useNotificationStore } from "@/store/notificationStore";
import ModelPickerPopover from "./ModelPickerPopover";
import PlaygroundComposer from "./PlaygroundComposer";
import PlaygroundEmpty from "./PlaygroundEmpty";
import PlaygroundExportModal from "./PlaygroundExportModal";
import PlaygroundHistoryModal from "./PlaygroundHistoryModal";
import PlaygroundMessage from "./PlaygroundMessage";
import PlaygroundSettingsPopover from "./PlaygroundSettingsPopover";
import PlaygroundTranscript from "./PlaygroundTranscript";
import usePlaygroundChat from "./usePlaygroundChat";
import usePlaygroundHints from "./usePlaygroundHints";
import usePlaygroundSessions from "./usePlaygroundSessions";
import {
  DEFAULT_SETTINGS,
  FAVORITES_KEY,
  SETTINGS_KEY,
  buildExportBody,
  localTitle,
  normalizeSettings,
  readStorage,
  writeStorage,
} from "./playgroundUtils";
import styles from "./playground.module.css";

const DIVIDER_PREFIX = "Model switched to ";

export default function PlaygroundPageClient() {
  const [providers, setProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);

  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState({});
  const [rawById, setRawById] = useState({});

  const textareaRef = useRef(null);
  const activeIdRef = useRef("");
  const { copied, copy } = useCopyToClipboard();
  const notify = useNotificationStore((state) => state.addNotification);
  const setCrumbs = useHeaderTitleStore((state) => state.setCrumbs);
  const clearCrumbs = useHeaderTitleStore((state) => state.clearCrumbs);

  const {
    sessions,
    activeId,
    activeSession,
    setActiveId,
    newSession,
    duplicateSession,
    deleteSession,
    updateSession,
  } = usePlaygroundSessions();

  const updateSessionMessages = useCallback((sessionId, updater) => {
    updateSession(sessionId, (session) => ({ ...session, messages: updater(session.messages) }));
  }, [updateSession]);

  const appendMessages = useCallback((sessionId, messages) => {
    updateSessionMessages(sessionId, (current) => [...current, ...messages]);
  }, [updateSessionMessages]);

  const patchMessage = useCallback((sessionId, messageId, patch) => {
    updateSessionMessages(sessionId, (current) => current.map((message) => (
      message.id === messageId ? { ...message, ...patch } : message
    )));
  }, [updateSessionMessages]);

  const applyTitle = useCallback((sessionId, title) => {
    updateSession(sessionId, (session) => ({ ...session, title }));
  }, [updateSession]);

  const applyFollowUps = useCallback((sessionId, assistantId, questions) => {
    updateSessionMessages(sessionId, (current) => current.map((message) => (
      message.id === assistantId ? { ...message, followUps: questions } : message
    )));
  }, [updateSessionMessages]);

  const { requestTitle, requestFollowUps, cancelAll } = usePlaygroundHints({
    apiKey,
    model: activeSession?.model || null,
    helper: settings.helper,
    onTitle: applyTitle,
    onFollowUps: applyFollowUps,
  });

  // Follow-ups run only for the turn that just finished and produced text.
  const finishTurn = useCallback(({ sessionId, assistantId, status, content, messages }) => {
    if (status !== "done" || !content || !content.trim() || !settings.helper) return;
    // A turn can finish after the reader moved on; never start a helper call for it.
    if (sessionId !== activeIdRef.current) return;
    requestFollowUps(sessionId, assistantId, messages);
  }, [requestFollowUps, settings.helper]);

  const { isStreaming, run, stop } = usePlaygroundChat({
    apiKey,
    settings,
    onAppend: appendMessages,
    onPatch: patchMessage,
    onFinish: finishTurn,
  });

  // Model picker sources: same connections/aliases data the Combo picker uses.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [providersRes, aliasesRes, keysRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models/alias", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
        ]);
        const providersData = providersRes.ok ? await providersRes.json().catch(() => ({})) : {};
        const aliasesData = aliasesRes.ok ? await aliasesRes.json().catch(() => ({})) : {};
        const keysData = keysRes.ok ? await keysRes.json().catch(() => ({})) : {};
        if (cancelled) return;

        setProviders(
          Array.isArray(providersData.connections)
            ? providersData.connections.filter((connection) => connection?.isActive !== false)
            : [],
        );
        setModelAliases(aliasesData.aliases && typeof aliasesData.aliases === "object" ? aliasesData.aliases : {});
        setApiKey((keysData.keys || []).find((key) => key.isActive !== false)?.key || "");
        if (!providersRes.ok) setLoadError("Providers could not be loaded. Reload the page to try again.");
      } catch (error) {
        if (!cancelled) setLoadError(error?.message || "Providers and models could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stored = readStorage(SETTINGS_KEY, (value) => !!value && typeof value === "object");
    if (stored) setSettings(normalizeSettings(stored));
    setSettingsHydrated(true);

    const storedFavorites = readStorage(FAVORITES_KEY, Array.isArray);
    if (storedFavorites) setFavorites(storedFavorites.filter((value) => typeof value === "string"));
    setFavoritesHydrated(true);
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (settingsHydrated) writeStorage(SETTINGS_KEY, settings);
  }, [settings, settingsHydrated]);

  useEffect(() => {
    if (favoritesHydrated) writeStorage(FAVORITES_KEY, favorites);
  }, [favorites, favoritesHydrated]);

  useEffect(() => {
    textareaRef.current?.focus();
    return () => cancelAll();
  }, [cancelAll]);

  function inputRefFocus() {
    textareaRef.current?.focus();
  }

  const title = activeSession?.title || "New chat";
  useEffect(() => {
    setCrumbs([
      { label: "Playground", href: "/dashboard/playground" },
      { label: title },
    ]);
    return () => clearCrumbs();
  }, [title, setCrumbs, clearCrumbs]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointerDown = (event) => {
      if (event.target.closest?.("[data-playground-settings]")) return;
      if (event.target.closest?.('[aria-label="Playground settings"]')) return;
      setSettingsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const messages = activeSession?.messages || [];
  const lastId = messages[messages.length - 1]?.id;
  const canSend = !isStreaming && !!activeSession?.model && input.trim().length > 0;

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    if (!activeSession?.model) {
      setPickerOpen(true);
      notify({ type: "info", message: "Pick a model to send this message", duration: 3000 });
      return;
    }
    const sessionId = activeSession.id;
    const firstTurn = activeSession.title === "New chat";
    setInput("");
    if (firstTurn) applyTitle(sessionId, localTitle(text));
    run({ sessionId, question: text, history: activeSession.messages, model: activeSession.model });
    if (settings.helper) requestTitle(sessionId, text);
  };

  const handleFollowUp = (question) => {
    if (isStreaming || !activeSession?.model) return;
    run({
      sessionId: activeSession.id,
      question,
      history: activeSession.messages,
      model: activeSession.model,
    });
  };

  const handleRetry = (assistantId) => {
    if (isStreaming) return;
    const index = messages.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    let questionIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === "user") {
        questionIndex = cursor;
        break;
      }
    }
    if (questionIndex < 0) return;
    const answered = messages[index];
    const value = answered.meta?.requestedModel || activeSession?.model?.value || "";
    if (!value) return;
    run({
      sessionId: activeSession.id,
      question: messages[questionIndex].content,
      history: messages.slice(0, questionIndex),
      model: {
        value,
        name: answered.modelName || value,
        providerId: answered.providerId || "",
        providerName: answered.providerName || "",
        providerColor: activeSession?.model?.providerColor || "",
        isCombo: answered.isCombo === true,
      },
    });
  };

  const handleStop = () => stop();

  const handleDeleteMessage = (messageId) => {
    if (isStreaming) stop();
    updateSessionMessages(activeId, (current) => current.filter((message) => message.id !== messageId));
    notify({ type: "info", message: "Message deleted", duration: 2000 });
  };

  const handleCopy = (message) => {
    const text = message.content || message.reasoning || "";
    if (text) copy(text, message.id);
  };

  const handleToggleThinking = (messageId) => {
    setThinkingOpen((current) => ({ ...current, [messageId]: !current[messageId] }));
  };

  const handleToggleRaw = (messageId) => {
    setRawById((current) => ({ ...current, [messageId]: !current[messageId] }));
  };

  const handleSelectModel = (model) => {
    if (!model?.value || !activeSession) return;
    const previous = activeSession.model;
    const changed = previous?.value !== model.value;
    const next = {
      value: model.value,
      name: model.name || model.value,
      providerId: model.providerId || "",
      providerName: model.providerName || "",
      providerColor: model.providerColor || "",
      isCombo: model.isCombo === true,
    };
    updateSession(activeSession.id, (session) => ({
      ...session,
      model: next,
      messages: changed && session.messages.length > 0
        ? [...session.messages, {
          id: `divider_${Date.now()}`,
          role: "divider",
          content: `${DIVIDER_PREFIX}${next.name}`,
        }]
        : session.messages,
    }));
    setPickerOpen(false);
    inputRefFocus();
  };

  const resetTransient = () => {
    setInput("");
    setThinkingOpen({});
    setRawById({});
    setPickerOpen(false);
    setSettingsOpen(false);
  };

  const handleNewChat = () => {
    stop();
    cancelAll();
    if (!activeSession || activeSession.messages.length === 0) {
      resetTransient();
      inputRefFocus();
      return;
    }
    newSession(activeSession.model || null);
    resetTransient();
    inputRefFocus();
  };

  const handleSelectSession = (id) => {
    if (id !== activeId) {
      stop();
      cancelAll();
      setActiveId(id);
      resetTransient();
    }
    setHistoryOpen(false);
  };

  const handleDuplicateSession = (session) => {
    duplicateSession(session);
    resetTransient();
  };

  const handleDeleteSession = (id) => {
    if (id === activeId) {
      stop();
      cancelAll();
    }
    deleteSession(id);
  };

  const handleClear = () => {
    stop();
    cancelAll();
    updateSession(activeId, (session) => ({ ...session, messages: [], title: "New chat" }));
    resetTransient();
    setSettingsOpen(false);
    notify({ type: "success", message: "Conversation cleared", duration: 2000 });
  };

  const handleSettingsChange = (patch) => {
    setSettings((current) => normalizeSettings({ ...current, ...patch }));
  };

  const toggleFavorite = (value) => {
    setFavorites((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
  };

  const runCommand = (key) => {
    setInput("");
    if (key === "/new") handleNewChat();
    else if (key === "/clear") handleClear();
    else if (key === "/history") setHistoryOpen(true);
    else if (key === "/model") setPickerOpen(true);
    else if (key === "/settings") setSettingsOpen(true);
    else if (key === "/export") setExportOpen(true);
  };

  const exportBody = useMemo(
    () => buildExportBody(activeSession || { model: null, messages: [] }, settings),
    [activeSession, settings],
  );

  const emptyHint = !loading && providers.length === 0
    ? "No providers connected yet. Connect one from the Providers page to test models here."
    : activeSession?.model
      ? `Test ${activeSession.model.name} through JRouter.`
      : "Pick a model, then send your first message through JRouter.";

  const renderMessage = (message) => (
    <PlaygroundMessage
      key={message.id}
      message={message}
      isLast={message.id === lastId}
      isStreaming={message.status === "streaming"}
      thinkingOpen={!!thinkingOpen[message.id]}
      raw={!!rawById[message.id]}
      copied={copied === message.id}
      onCopy={handleCopy}
      onDelete={handleDeleteMessage}
      onRetry={handleRetry}
      onToggleThinking={handleToggleThinking}
      onToggleRaw={handleToggleRaw}
      onFollowUp={handleFollowUp}
    />
  );

  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="Playground">
        <PlaygroundTranscript
          messages={messages}
          isStreaming={isStreaming}
          renderMessage={renderMessage}
          loadError={loadError}
          empty={(
            <PlaygroundEmpty
              hint={emptyHint}
              showSuggestions={!!activeSession?.model && providers.length > 0}
              onSuggestion={(suggestion) => {
                setInput(suggestion);
                inputRefFocus();
              }}
            />
          )}
        />

        <PlaygroundComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          canSend={canSend}
          model={activeSession?.model || null}
          pickerOpen={pickerOpen}
          onOpenPicker={() => {
            setSettingsOpen(false);
            setPickerOpen((open) => !open);
          }}
          picker={(
            <ModelPickerPopover
              isOpen={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelect={handleSelectModel}
              selectedModel={activeSession?.model?.value || ""}
              activeProviders={providers}
              modelAliases={modelAliases}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
            />
          )}
          onOpenHistory={() => {
            setPickerOpen(false);
            setSettingsOpen(false);
            setHistoryOpen(true);
          }}
          historyCount={sessions.length}
          think={settings.think}
          onToggleThink={() => handleSettingsChange({ think: !settings.think })}
          settingsOpen={settingsOpen}
          onToggleSettings={() => {
            setPickerOpen(false);
            setSettingsOpen((open) => !open);
          }}
          settingsPanel={settingsOpen ? (
            <PlaygroundSettingsPopover
              settings={settings}
              onChange={handleSettingsChange}
              onClose={() => setSettingsOpen(false)}
              onExport={() => {
                setSettingsOpen(false);
                setExportOpen(true);
              }}
              onClear={handleClear}
            />
          ) : null}
          onCommand={runCommand}
          textareaRef={textareaRef}
        />
      </section>

      <PlaygroundHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelectSession}
        onNew={() => {
          setHistoryOpen(false);
          handleNewChat();
        }}
        onDuplicate={handleDuplicateSession}
        onDelete={handleDeleteSession}
      />

      <PlaygroundExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        body={exportBody}
        onCopy={(code) => {
          copy(code, "export");
          notify({ type: "success", message: "Code copied", duration: 2000 });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd tests && npx vitest run unit/playground-redesign-shell.test.js unit/playground-redesign-behavior.test.js unit/playground-utils.test.js unit/playground-full-chat.test.js unit/model-picker-rail.test.js unit/header-title-store.test.js`
Expected: PASS (shell 26, behavior 11, utils 16, full-chat 7, picker 8, header 3).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js"
git add "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" tests/unit/playground-redesign-shell.test.js
git commit -m "feat(playground): compose the chat-first page"
```

---

### Task 16: Verification and cleanup

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Lint every touched file**

```bash
npx eslint \
  "src/app/(dashboard)/dashboard/playground" \
  "src/shared/components/ModelPickerList.js" \
  "src/shared/components/ModelSelectModal.js" \
  "src/shared/components/Header.js" \
  "src/store/headerTitleStore.js" \
  "src/app/(dashboard)/dashboard/combos/page.js"
```

Expected: no errors. Fix only issues introduced by this work.

- [ ] **Step 2: Run the targeted suite**

```bash
cd tests && npx vitest run \
  unit/playground-redesign-shell.test.js \
  unit/playground-redesign-behavior.test.js \
  unit/playground-utils.test.js \
  unit/playground-full-chat.test.js \
  unit/model-picker-rail.test.js \
  unit/header-title-store.test.js
```

Expected: all pass. Record the counts in the task report.

- [ ] **Step 3: Start the dev server**

```bash
npm run dev
```

Background it; the app serves on `http://localhost:20128` with `DATA_DIR=%APPDATA%\jrouter`. Wait for the "Ready" line before browsing.

- [ ] **Step 4: Manual matrix**

| Check | Expected |
| --- | --- |
| Empty state | illustration, title, hint, four suggestions; clicking fills the composer |
| Pick a model | rail picker above the composer, provider counts, search narrows, arrow keys + Enter select |
| Send | user bubble right, streaming assistant card, thinking block, status label, metric line |
| Raw / Rendered | raw shows unformatted text, rendered restores markdown |
| Stop mid-stream | partial text kept, `stopped` in the metric line, input enabled |
| Retry | last reply only; replays the same question with the same model |
| Delete message | row disappears; deleting the streaming reply stops it |
| Settings | system prompt + presets, slider, token presets + custom, Top P, helper switch |
| Export | three tabs, valid code, env placeholder only, Copy notifies |
| History | new, switch, duplicate, delete (two clicks), search by content, titles survive reload |
| Header | breadcrumb shows `Playground / <title>` and clears on another route |
| Favorites | star toggles, persists after reload, Favorites rail entry appears |
| Commands | `/new`, `/clear`, `/history`, `/model`, `/settings`, `/export`; ↑/↓/Enter/Escape |
| Layout | 1440×900, 1280×800, 1024×768 and 390×844; no clipped composer, no page scrollbar |
| Theme | light and dark both use tokens; no unreadable text |

- [ ] **Step 5: Build**

```bash
npm run build
```

Run it in the background with notification (webpack, repo-wide lock, 15–20 min). If another agent holds the lock, report it instead of forcing. Expected: successful production build.

- [ ] **Step 6: Report and stop**

Report: files changed, test counts, manual matrix results, build result, and any deviation from the spec. Do not commit the build output.

---

## Spec Coverage

| Spec section | Task(s) |
| --- | --- |
| §2 decisions, deviations | 1, 6, 10, 15 |
| §3 data sources | 4, 5, 6, 15 |
| §4 layout | 13, 14, 15 |
| §5 visual system | 7–14 |
| §6 state and persistence | 4, 5, 15 |
| §7 conversation lifecycle | 5, 15 |
| §8 turn engine | 4, 6 |
| §9 AI helper | 12, 15 |
| §10 shared picker | 1, 2, 9 |
| §11 header store | 3, 15 |
| §12 accessibility and responsive | 7–15 |
| §13 architecture | all |
| §14 testing | 1–16 |

## Self-Review Notes

- Embedded `playgroundUtils` was executed in Node against 61 assertions (`node --check` plus an assert harness) before being written into this plan; two expectations were corrected during that run (six-word title, system prompt included in the export fallback).
- Every task ends with a runnable test command and a commit. No task claims a UI behaviour without a manual step in Task 16.
- `PlaygroundMarkdown.js` is never edited; Task 14 verifies its class names against the stylesheet instead of renaming anything.
- The rail variant is opt-in, so the CLI-tool pickers keep their chip rendering and their `DashboardControls` overrides.

