# Profile Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/profile` on the shipped dashboard language — sticky jump chips, seven hairline panels, one row system — while splitting the 1,693-line page into a shell, a settings hook and seven section components with zero behaviour change.

**Architecture:** Shared presentational primitives (`FieldRow`, `FieldGroup`, `SettingsPanel`, `SettingRow`, `ActionRow`, `StatusLine`) carry all layout; `useProfileSettings` owns the `GET/PATCH /api/settings` state; each panel owns its own form state and calls the endpoints it needs; `page.js` becomes composition plus the three modals.

**Tech Stack:** Next.js App Router (client components), CSS Modules on the tokens in `src/app/globals.css`, Vitest (node environment; pure helpers unit-tested, JSX files covered by source-text contract tests).

**Spec:** `docs/superpowers/specs/2026-11-01-profile-redesign-design.md`

## Global Constraints

- Only existing tokens: `--canvas`, `--surface`, `--surface-2`, `--surface-inset`, `--surface-hover`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--pos`, `--warn`, `--danger`, `--r1`–`--r4`, `--r-full`, `--font-sans`, `--font-display`, `--font-mono`. No raw colour values.
- No new API route, no settings key, no change to any request body, validation or success copy.
- CLI Tools must stay at 34 passing tests; its 15 cards are not edited by this plan.
- Tests run from `tests/`: `cd tests && npx vitest run --config ./vitest.config.js unit/<file>.test.js`.
- Lint runs from the repo root per file: `npx eslint <path>`. The route carries pre-existing `react-hooks` diagnostics in `page.js`; the gate is "no new diagnostics", checked per file against its pre-change count.
- No `npm run build` inside a task; the controller runs it once at the end. No dev-server commands — port 20128 belongs to another process.
- The checkout is shared with other agents: stage exact paths only, never `git add -A`/`git add .`/`git commit -a`/`git stash`/`git reset`/`git checkout`, never amend a commit you did not create.

## File Structure

Create:

| Path | Responsibility |
| --- | --- |
| `src/shared/components/ui/FieldRow.js` | Moved from `cli-tools/components/ui/`; renders label + arrow + control + optional aside |
| `src/shared/components/ui/FieldGroup.js` | Moved; titled group of rows |
| `src/shared/components/ui/field.module.css` | `.field*` and `.fieldGroup*` rules moved out of `cli-tools.module.css` |
| `profile/profileSections.js` | Section metadata + `activeSectionId` (pure) |
| `profile/settingsApi.js` | `patchSettings(payload)` fetch helper |
| `profile/useProfileSettings.js` | Loads `/api/settings`, exposes `{ settings, setSettings, loading, loadError, reload }` |
| `profile/components/SettingsPanel.js` | Panel + header + body |
| `profile/components/SettingRow.js` | Label/hint row with a control slot |
| `profile/components/ActionRow.js` | Status line + action buttons |
| `profile/components/StatusLine.js` | Success/error line |
| `profile/components/PreferencesPanel.js` | Preferences & data |
| `profile/components/SecurityPanel.js` | Security |
| `profile/components/RoutingPanel.js` | Routing strategy |
| `profile/components/NetworkPanel.js` | Network |
| `profile/components/ObservabilityPanel.js` | Observability |
| `profile/components/SessionPanel.js` | Session & server |
| `profile/components/SsoPanel.js` | Single Sign-On |
| `tests/unit/profile-sections.test.js` | Unit tests for the pure module |
| `tests/unit/profile-redesign.test.js` | Source-text contracts |

Modify: `profile/page.js`, `profile/profile.module.css`, `cli-tools/components/ui/FieldRow.js`, `cli-tools/components/ui/FieldGroup.js`, `cli-tools/cli-tools.module.css`.

---

### Task 1: Promote the field primitives to the shared layer

**Files:**
- Create: `src/shared/components/ui/FieldRow.js`, `src/shared/components/ui/FieldGroup.js`, `src/shared/components/ui/field.module.css`
- Modify: `src/app/(dashboard)/dashboard/cli-tools/components/ui/FieldRow.js`, `.../FieldGroup.js` (one-line re-exports)
- Modify: `src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css` (drop the moved rules)

**Interfaces:**
- Produces: `FieldRow({ label, hint, aside, className, children })` and `FieldGroup({ title, description, children })` importable from `@/shared/components/ui/FieldRow` and `@/shared/components/ui/FieldGroup`.

- [ ] **Step 1: Move the components**

Copy `cli-tools/components/ui/FieldRow.js` to `src/shared/components/ui/FieldRow.js` and change its import from `"../../cli-tools.module.css"` to `"./field.module.css"`. Do the same for `FieldGroup.js`.

- [ ] **Step 2: Move the CSS**

Create `src/shared/components/ui/field.module.css` containing, verbatim, these rules from `cli-tools.module.css`: `.field`, `.fieldWithAside`, `.fieldLabel`, `.fieldArrow`, `.fieldControl`, `.fieldAside`, `.fieldHint`, `.fieldGroup`, `.fieldGroup + .fieldGroup`, `.fieldGroupHeader`, `.fieldGroupTitle`, `.fieldGroupDescription`, plus the `@media (max-width: 899px)` block that collapses `.field`/`.fieldWithAside`. Delete those rules from `cli-tools.module.css`. Keep `.currentValue` and `.fieldTop` there — cards still import them from the route module — and change `.fieldTop` to the compound selector `.field.fieldTop { align-items: start; }` so it keeps winning over the shared `.field` rule regardless of CSS chunk order.

- [ ] **Step 3: Replace the route files with re-exports**

```js
// src/app/(dashboard)/dashboard/cli-tools/components/ui/FieldRow.js
export { default } from "@/shared/components/ui/FieldRow";
```

```js
// src/app/(dashboard)/dashboard/cli-tools/components/ui/FieldGroup.js
export { default } from "@/shared/components/ui/FieldGroup";
```

- [ ] **Step 4: Verify CLI Tools is untouched behaviourally**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/cli-tools-redesign.test.js unit/cli-tools-groups.test.js`
Expected: 34 passed.

Run: `grep -c "styles.fieldLabel" "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css"`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/ui "src/app/(dashboard)/dashboard/cli-tools/components/ui" "src/app/(dashboard)/dashboard/cli-tools/cli-tools.module.css"
git commit -m "refactor(ui): share the FieldRow and FieldGroup primitives"
```

---

### Task 2: Section metadata and the scroll-spy helper

**Files:**
- Create: `src/app/(dashboard)/dashboard/profile/profileSections.js`
- Test: `tests/unit/profile-sections.test.js`

**Interfaces:**
- Produces:
  - `PROFILE_SECTIONS: { id, label, icon, title, description }[]`
  - `activeSectionId(offsets, line)` → id string or `null`, where `offsets` is `[{ id, top }]` in document order.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { PROFILE_SECTIONS, activeSectionId } from "@/app/(dashboard)/dashboard/profile/profileSections";

describe("PROFILE_SECTIONS", () => {
  it("lists the seven sections in page order with unique ids", () => {
    expect(PROFILE_SECTIONS.map((s) => s.id)).toEqual([
      "profile-preferences",
      "profile-security",
      "profile-sso",
      "profile-routing",
      "profile-network",
      "profile-observability",
      "profile-session",
    ]);
    expect(new Set(PROFILE_SECTIONS.map((s) => s.id)).size).toBe(7);
  });

  it("gives every section a chip label and an icon", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("activeSectionId", () => {
  const offsets = [
    { id: "a", top: 0 },
    { id: "b", top: 300 },
    { id: "c", top: 700 },
  ];

  it("returns the last section whose top passed the reading line", () => {
    expect(activeSectionId(offsets, 0)).toBe("a");
    expect(activeSectionId(offsets, 299)).toBe("a");
    expect(activeSectionId(offsets, 300)).toBe("b");
    expect(activeSectionId(offsets, 900)).toBe("c");
  });

  it("falls back to the first section when the line is above everything", () => {
    expect(activeSectionId([{ id: "a", top: 120 }], 0)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(activeSectionId([], 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/profile-sections.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```js
// Section metadata for /dashboard/profile. Pure data + one helper so both the
// chip toolbar and the scroll spy read from a single source.

export const PROFILE_SECTIONS = [
  {
    id: "profile-preferences",
    label: "Preferences",
    icon: "settings",
    title: "Preferences & data",
    description: "Display preferences and database backups.",
  },
  {
    id: "profile-security",
    label: "Security",
    icon: "shield",
    title: "Security",
    description: "Dashboard access and password management.",
  },
  {
    id: "profile-sso",
    label: "SSO",
    icon: "lock_open",
    title: "Single Sign-On (SSO)",
    description: "Optional SSO via Okta, Entra ID, Keycloak, or OIDC.",
  },
  {
    id: "profile-routing",
    label: "Routing",
    icon: "route",
    title: "Routing Strategy",
    description: "Account and combo rotation preferences.",
  },
  {
    id: "profile-network",
    label: "Network",
    icon: "wifi",
    title: "Network",
    description: "Outbound connections for OAuth and provider requests.",
  },
  {
    id: "profile-observability",
    label: "Observability",
    icon: "monitoring",
    title: "Observability",
    description: "Request logging for the logs view.",
  },
  {
    id: "profile-session",
    label: "Session",
    icon: "logout",
    title: "Session & server",
    description: "Dashboard session and the proxy process.",
  },
];

/**
 * Picks the section currently under the reading line.
 * `offsets` must be in document order; `line` is the scroll offset that counts
 * as "read" (the sticky toolbar height).
 */
export function activeSectionId(offsets, line = 0) {
  if (!Array.isArray(offsets) || offsets.length === 0) return null;
  let active = offsets[0].id;
  for (const entry of offsets) {
    if (entry.top <= line) active = entry.id;
  }
  return active;
}
```

- [ ] **Step 4: Run the test**

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile/profileSections.js" tests/unit/profile-sections.test.js
git commit -m "feat(profile): add section metadata and the scroll-spy helper"
```

---

### Task 3: The profile kit

**Files:**
- Create: `profile/components/SettingsPanel.js`, `SettingRow.js`, `ActionRow.js`, `StatusLine.js`
- Modify: `profile/profile.module.css`

**Interfaces:**
- `SettingsPanel({ id, title, icon, description, children, actions })`
- `SettingRow({ label, hint, stacked, children })`
- `ActionRow({ message, tone, children })` with `tone` in `neutral | success | danger`
- `StatusLine({ message, tone })` — renders `null` when message is empty
- CSS classes: `.panel`, `.panelHeader`, `.panelHeading`, `.panelTitle`, `.panelIcon`, `.panelDescription`, `.panelBody`, `.panelActions`, `.settingRow`, `.settingRowStacked`, `.settingText`, `.settingLabel`, `.settingHint`, `.settingControl`, `.actionRow`, `.actionButtons`, `.statusLine`.

- [ ] **Step 1: Add the CSS**

Append to `profile.module.css` (keep the existing rules until Task 9):

```css
/* Panels ---------------------------------------------------------------- */

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: var(--r4);
  background: var(--canvas);
  scroll-margin-top: 84px;
}

.panelHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.panelHeading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.panelTitle {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.panelIcon {
  flex: none;
  color: var(--text-2);
  font-size: 18px;
}

.panelDescription {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
}

.panelBody {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panelActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Rows ------------------------------------------------------------------ */

.settingRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 16px;
  min-width: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}

.settingRow:first-child {
  padding-top: 0;
}

.settingRow:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.settingRowStacked {
  align-items: flex-start;
  flex-direction: column;
}

.settingText {
  flex: 1 1 240px;
  min-width: 0;
}

.settingLabel {
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}

.settingHint {
  margin-top: 2px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.settingControl {
  flex: none;
  min-width: 0;
}

/* Action row ------------------------------------------------------------ */

.actionRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.actionButtons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.statusLine {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  min-width: 0;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.statusLine[data-tone="success"] {
  color: var(--pos);
}

.statusLine[data-tone="danger"] {
  color: var(--danger);
}

@media (max-width: 639px) {
  .panel {
    padding: 16px;
  }

  .settingText {
    flex-basis: 180px;
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

- [ ] **Step 2: Add the components**

`SettingsPanel.js`:

```jsx
"use client";

import Icon from "@/shared/components/Icon";
import styles from "../profile.module.css";

export default function SettingsPanel({ id, title, icon, description, children, actions }) {
  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <h2 id={`${id}-title`} className={styles.panelTitle}>
            <Icon className={styles.panelIcon} aria-hidden="true">{icon}</Icon>
            {title}
          </h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
```

`SettingRow.js`:

```jsx
"use client";

import { cn } from "@/shared/utils/cn";
import styles from "../profile.module.css";

export default function SettingRow({ label, hint, stacked = false, children }) {
  return (
    <div className={cn(styles.settingRow, stacked && styles.settingRowStacked)}>
      <div className={styles.settingText}>
        <p className={styles.settingLabel}>{label}</p>
        {hint ? <p className={styles.settingHint}>{hint}</p> : null}
      </div>
      {children ? <div className={styles.settingControl}>{children}</div> : null}
    </div>
  );
}
```

`StatusLine.js`:

```jsx
"use client";

import Icon from "@/shared/components/Icon";
import styles from "../profile.module.css";

export default function StatusLine({ message, tone = "neutral" }) {
  if (!message) return null;
  return (
    <p
      className={styles.statusLine}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className="text-[14px]" aria-hidden="true">
        {tone === "danger" ? "error" : "check_circle"}
      </Icon>
      {message}
    </p>
  );
}
```

`ActionRow.js`:

```jsx
"use client";

import StatusLine from "./StatusLine";
import styles from "../profile.module.css";

export default function ActionRow({ message, tone = "neutral", children }) {
  return (
    <div className={styles.actionRow}>
      <StatusLine message={message} tone={tone} />
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/profile/components"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile/components" "src/app/(dashboard)/dashboard/profile/profile.module.css"
git commit -m "feat(profile): add panel, row, action and status primitives"
```

---

### Task 4: Settings hook, API helper, page shell and the Preferences panel

**Files:**
- Create: `profile/settingsApi.js`, `profile/useProfileSettings.js`, `profile/components/PreferencesPanel.js`
- Modify: `profile/page.js` (new shell), `profile/profile.module.css` (intro + toolbar + chips)
- Test: `tests/unit/profile-redesign.test.js`

**Interfaces:**
- `patchSettings(payload)` → `Promise<{ ok, data }>`
- `useProfileSettings()` → `{ settings, setSettings, loading, loadError, reload }`
- `PreferencesPanel({ settings, theme, setTheme, locale, onOpenLanguage, isRemoteHost, dbStatus, dbLoading, onExport, onImport, importFileRef })`
- Page shell renders: `.intro`, `.toolbar` (chips from `PROFILE_SECTIONS`), `PreferencesPanel`, and — temporarily — the remaining six sections as-is from the old file.

- [ ] **Step 1: Write the contract test**

Create `tests/unit/profile-redesign.test.js`:

```js
/**
 * Profile redesign — source-text contracts.
 * The page is JSX, so Vitest (node environment, no JSX transform) reads the
 * sources and asserts the structural promises instead of importing them.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ROUTE = "src/app/(dashboard)/dashboard/profile";

describe("Profile shell", () => {
  const page = read(`${ROUTE}/page.js`);

  it("renders the intro and the sticky chip toolbar", () => {
    expect(page).toContain("styles.introTitle");
    expect(page).toContain("styles.toolbar");
    expect(page).toContain("PROFILE_SECTIONS.map");
  });

  it("wires the scroll spy to the section offsets", () => {
    expect(page).toContain("activeSectionId");
    expect(page).toContain("aria-current");
  });
});

describe("Profile panels", () => {
  it("no longer renders a Card wrapper anywhere in the page", () => {
    expect(read(`${ROUTE}/page.js`)).not.toContain("<Card");
  });

  it("renders one panel component per section", () => {
    const page = read(`${ROUTE}/page.js`);
    for (const name of [
      "PreferencesPanel",
      "SecurityPanel",
      "SsoPanel",
      "RoutingPanel",
      "NetworkPanel",
      "ObservabilityPanel",
      "SessionPanel",
    ]) {
      expect(page).toContain(`<${name}`);
    }
  });

  it("derives every panel id from the section metadata", () => {
    const meta = read(`${ROUTE}/profileSections.js`);
    const ids = [...meta.matchAll(/id: "(profile-[a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(7);
    for (const file of [
      "PreferencesPanel",
      "SecurityPanel",
      "SsoPanel",
      "RoutingPanel",
      "NetworkPanel",
      "ObservabilityPanel",
      "SessionPanel",
    ]) {
      expect(read(`${ROUTE}/components/${file}.js`)).toMatch(/PROFILE_SECTIONS\[\d\]/);
    }
  });
});
```

Note: this test only passes once Tasks 5–8 land; in this task run it with `-t "Profile shell"` and expect the shell block green, the panel block red. That is the expected intermediate state.

- [ ] **Step 2: Add the API helper**

```js
// Single place that talks to /api/settings for the profile page.
export async function patchSettings(payload) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
```

- [ ] **Step 3: Add the settings hook**

```jsx
"use client";

import { useCallback, useEffect, useState } from "react";

/** Loads instance settings once and exposes the shared setter. */
export function useProfileSettings() {
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return fetch("/api/settings")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSettings(data || {});
        return data;
      })
      .catch(() => {
        setLoadError("Could not load your instance settings. Try again.");
        return null;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { settings, setSettings, loading, loadError, reload };
}
```

- [ ] **Step 4: Add the Preferences panel**

```jsx
"use client";

import { Button, SegmentedControl } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import ActionRow from "./ActionRow";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[0];

export default function PreferencesPanel({
  theme,
  setTheme,
  locale,
  onOpenLanguage,
  isRemoteHost,
  dbStatus,
  dbLoading,
  onExport,
  onImport,
  importFileRef,
}) {
  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow label="Appearance" hint="Use a light, dark, or system theme.">
        <SegmentedControl
          aria-label="Appearance"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light", icon: "light_mode" },
            { value: "dark", label: "Dark", icon: "dark_mode" },
            { value: "system", label: "System", icon: "contrast" },
          ]}
        />
      </SettingRow>

      <SettingRow label="Display language" hint="Choose the language used in the dashboard.">
        <Button variant="secondary" onClick={onOpenLanguage} aria-label="Change display language" data-i18n-skip="true">
          <span aria-hidden="true">{LOCALE_FLAGS[locale] || "🌐"}</span>
          <span>{locale}</span>
          <Icon className="text-[14px]" aria-hidden="true">expand_more</Icon>
        </Button>
      </SettingRow>

      <SettingRow
        label={isRemoteHost ? "Remote Mode" : "Local Mode"}
        hint={isRemoteHost ? "Connected to a remote instance." : "Running on your machine."}
      />

      <SettingRow label="Database location" hint="~/.jrouter/db/data.sqlite">
        <div className={styles.actions}>
          <Button variant="secondary" icon="download" loading={dbLoading} onClick={onExport}>
            Download Backup
          </Button>
          <Button variant="secondary" icon="upload" disabled={dbLoading} onClick={() => importFileRef.current?.click()}>
            Import Backup
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImport}
          />
        </div>
      </SettingRow>

      <ActionRow message={dbStatus.message} tone={dbStatus.type === "error" ? "danger" : dbStatus.type === "success" ? "success" : "neutral"} />
    </SettingsPanel>
  );
}
```

`styles.actions` already exists in `profile.module.css` (`display:flex; gap:8px`), so keep it.

- [ ] **Step 5: Rebuild `page.js` around the shell**

Keep every existing handler and state value. Replace only the returned JSX and the imports:

```jsx
return (
  <div className={styles.page}>
    <header className={styles.intro}>
      <div className={styles.introText}>
        <h1 className={styles.introTitle}>Profile</h1>
        <p className={styles.introSub}>Preferences, security, and settings for your JRouter instance.</p>
      </div>
    </header>

    <nav className={styles.toolbar} aria-label="Jump to a settings section">
      {PROFILE_SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={styles.chip}
          aria-current={activeId === section.id ? "true" : undefined}
          onClick={() => setActiveId(section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>

    {loading ? <CardSkeleton /> : loadError ? (
      <p className={styles.loadError} role="alert">{loadError}</p>
    ) : (
      <>
        <PreferencesPanel … />
        {/* Tasks 5–8 replace the blocks below with their panels */}
        {oldSections}
      </>
    )}

    <div className={styles.appInfo}>…unchanged…</div>
    …modals unchanged…
  </div>
);
```

Scroll spy, added next to the other effects:

```js
const [activeId, setActiveId] = useState(PROFILE_SECTIONS[0].id);

useEffect(() => {
  const scroller = document.querySelector("[data-page-scroller]");
  const target = scroller || window;
  const measure = () => {
    const offsets = PROFILE_SECTIONS.map((section) => {
      const el = document.getElementById(section.id);
      if (!el) return { id: section.id, top: Number.POSITIVE_INFINITY };
      const top = scroller
        ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        : el.getBoundingClientRect().top;
      return { id: section.id, top };
    });
    setActiveId(activeSectionId(offsets, 96));
  };
  measure();
  target.addEventListener("scroll", measure, { passive: true });
  window.addEventListener("resize", measure);
  return () => {
    target.removeEventListener("scroll", measure);
    window.removeEventListener("resize", measure);
  };
}, [loading]);
```

If no `[data-page-scroller]` exists in the shell, fall back to `window` as written — the helper stays honest either way.

- [ ] **Step 6: Add the shell CSS**

```css
.intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.toolbar {
  position: sticky;
  top: calc(-1 * var(--usage-stick-offset, 24px));
  z-index: 30;
  display: flex;
  gap: 8px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 12px 0;
  background: var(--canvas);
}

.toolbar::-webkit-scrollbar {
  display: none;
}

.chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 150ms;
}

.chip:hover {
  background: var(--surface-hover);
}

.chip[aria-current="true"] {
  background: var(--canvas);
  box-shadow: 0 0 0 1px var(--line);
  font-weight: 600;
}

.loadError {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  color: var(--danger);
  font-size: 13px;
}
```

- [ ] **Step 7: Run the shell contracts**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/profile-redesign.test.js -t "Profile shell"`
Expected: PASS — 2 tests (intro/toolbar, scroll spy). The "Profile panels" block fails until Tasks 5–8; that is expected.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile" tests/unit/profile-redesign.test.js
git commit -m "feat(profile): rebuild the page shell with jump chips and the preferences panel"
```

---

### Task 5: Security panel

**Files:**
- Create: `profile/components/SecurityPanel.js`
- Modify: `profile/page.js` (swap the inline Security block)

**Interfaces:**
- `SecurityPanel({ settings, onRequireLoginChange, passwords, setPasswords, passStatus, passLoading, onSubmit })`

- [ ] **Step 1: Build the panel**

Rows in order: `Require login` (`SettingRow` + `Toggle`, same copy as today), then — only when `settings.requireLogin === true` — a `<form onSubmit={onSubmit}>` containing:
- `Current Password` (`FieldRow`, password, required) only when `settings.hasPassword`.
- `New Password` + `Confirm New Password` (`FieldRow` each, password, required).
- `ActionRow` with `passStatus` and the submit button (`variant="contrast"`, label `Update Password` when `hasPassword` else `Set Password`, `loading={passLoading}`).

Preserve the exact `autoComplete` values (`current-password`, `new-password`).

- [ ] **Step 2: Swap it into the page**

Replace the whole `{/* Security */}` `ProfileSection` block with `<SecurityPanel … />`, passing the values `handlePasswordChange` already consumes.

- [ ] **Step 3: Verify**

Run: `npx eslint "src/app/(dashboard)/dashboard/profile/components/SecurityPanel.js" "src/app/(dashboard)/dashboard/profile/page.js"` — no new diagnostics.
Run: `grep -c "profile-security" "src/app/(dashboard)/dashboard/profile/page.js"` — 1.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile"
git commit -m "refactor(profile): extract the security panel"
```

---

### Task 6: Routing and Network panels

**Files:**
- Create: `profile/components/RoutingPanel.js`, `profile/components/NetworkPanel.js`
- Modify: `profile/page.js`

**Interfaces:**
- `RoutingPanel({ settings, onFallbackStrategy, onStickyLimit, onComboStrategy, onComboStickyLimit })`
- `NetworkPanel({ settings, proxyForm, setProxyForm, proxyStatus, proxyLoading, proxyTestLoading, onToggleEnabled, onSubmit, onTest })`

- [ ] **Step 1: Routing panel**

Rows: `Round Robin` (toggle, hint `Cycle through accounts to distribute load`), conditional `Sticky Limit` (`FieldRow`, number, min 1 max 10, width 80px), `Combo Round Robin` (toggle, hint `Cycle through providers in combos instead of always starting with first`), conditional `Combo Sticky Limit` (number, min 1 max 100). The closing summary sentence becomes the panel description line, computed with the same strings as today.

- [ ] **Step 2: Network panel**

Rows: `Outbound Proxy` (toggle, disabled while `loading || proxyLoading`), then, when enabled, a form with `Proxy URL` and `No Proxy` (`FieldRow`s, same hints), and an `ActionRow` with `Test proxy URL` (secondary, `onTest`) and `Apply` (contrast, submit).

- [ ] **Step 3: Swap both into the page, verify, commit**

Run: `npx eslint "src/app/(dashboard)/dashboard/profile/components"` — clean.
Run: `grep -c "profile-routing\|profile-network" "src/app/(dashboard)/dashboard/profile/page.js"` — 2.

```bash
git add "src/app/(dashboard)/dashboard/profile"
git commit -m "refactor(profile): extract the routing and network panels"
```

---

### Task 7: Observability and Session panels

**Files:**
- Create: `profile/components/ObservabilityPanel.js`, `profile/components/SessionPanel.js`
- Modify: `profile/page.js`

**Interfaces:**
- `ObservabilityPanel({ enabled, onChange, disabled })`
- `SessionPanel({ onLogout, onShutdown })`

- [ ] **Step 1: Observability**

One `SettingRow`: label `Enable Observability`, hint `Record request details for inspection in the logs view`, `Toggle` bound to `onChange`.

- [ ] **Step 2: Session**

Two `SettingRow`s: `Dashboard session` / hint `Sign out of the dashboard.` with a `secondary` Logout button; `Stop proxy server` / hint `Shut down this JRouter instance.` with a `danger` Shutdown button that calls `onShutdown` (the page still owns the confirm modal).

- [ ] **Step 3: Swap, verify, commit**

With these two in place the "Profile panels" contract block passes except for the SSO entry.

```bash
git add "src/app/(dashboard)/dashboard/profile"
git commit -m "refactor(profile): extract the observability and session panels"
```

---

### Task 8: SSO panel

**Files:**
- Create: `profile/components/SsoPanel.js`
- Modify: `profile/page.js`

**Interfaces:**
- `SsoPanel({ settings, expanded, onToggleExpanded, ssoTypeTab, setSsoTypeTab, oidcForm, updateOidcForm, oidcClientSecret, setOidcClientSecret, oidcStatus, oidcLoading, oidcTestStatus, oidcTestLoading, onSaveOidc, onTestOidc, samlForm, updateSamlForm, samlStatus, samlLoading, samlTestStatus, samlTestLoading, onSaveSaml, onTestSaml, onIdpMetadataUpload, onCertUpload, samlAcsUrl, samlMetadataUrl, oidcRedirectUri, idpMetadataFileRef, certFileRef })`

- [ ] **Step 1: Header**

`SettingsPanel` with an `actions` slot holding a secondary button that toggles `expanded` (`aria-expanded`, `aria-controls="profile-sso-settings"`, chevron `expand_more`/`expand_less`). The panel description reflects live state: `<SAML 2.0|OIDC> SSO active`, `Password + <method> active`, or the default sentence — same strings as today.

- [ ] **Step 2: Body**

When expanded, render: protocol `SegmentedControl` (`SAML 2.0` / `OIDC`), then either the SAML block or the OIDC block, both converted to `FieldRow`s with the existing labels, the IdP guide disclosure unchanged in content but using `SettingRow`/`panel` styling, the metadata-import row, the read-only ACS / metadata / redirect URI rows (`SettingRow` + `<code>` + copy button), and an `ActionRow` with `Save` (contrast) and `Test` (outline) plus the two status lines.

When collapsed, render only the header — no body.

- [ ] **Step 3: Swap it into the page and run the full contract suite**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/profile-redesign.test.js unit/profile-sections.test.js`
Expected: 5 + 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile"
git commit -m "refactor(profile): extract the single sign-on panel"
```

---

### Task 9: Cleanup and the final gate

**Files:**
- Modify: `profile/page.js`, `profile/profile.module.css`
- Verify: whole route + CLI Tools

- [ ] **Step 1: Delete what the panels replaced**

Remove from `page.js`: `ProfileSection`, `ProfileStatus`, `ProfileHeader` and every inline section block now rendered by a panel. Remove from `profile.module.css`: `.section`, `.sectionHeader`, `.sectionDescription`, `.settingRow` if superseded (the kit owns it), `.settingTitle`, `.settingDescription`, `.form`, `.ssoForm`, `.formGrid`, `.disclosure`, `.choice`, `.guide`, `.status`, `.notice`, `.stack`, `.fieldLabel` — only after each reports zero references:

```bash
cd "src/app/(dashboard)/dashboard/profile"
for c in section sectionHeader sectionDescription settingRow settingTitle settingDescription form ssoForm formGrid disclosure choice guide status notice stack fieldLabel; do
  echo "$c $(grep -rho "styles\.$c\b" . | wc -l)"
done
```

Delete only the classes that report `0`.

- [ ] **Step 2: Confirm the page shrank**

Run: `wc -l "src/app/(dashboard)/dashboard/profile/page.js"` and every `components/*.js`.
Expected: `page.js` under 320 lines (Task 10 moves the handler bodies into hooks); no component file over 400.

- [ ] **Step 3: Run every test**

Run: `cd tests && npx vitest run --config ./vitest.config.js unit/profile-redesign.test.js unit/profile-sections.test.js unit/cli-tools-redesign.test.js unit/cli-tools-groups.test.js`
Expected: 44 passed (5 + 5 + 14 + 20).

- [ ] **Step 4: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/profile" "src/shared/components/ui"`
Expected: no new diagnostics versus the pre-change count recorded in Task 5.

- [ ] **Step 4b: Fix the three defects the panel extractions surfaced**

1. `tests/unit/profile-redesign.test.js` asserts `not.toContain("<Card")`, which `<CardSkeleton` also matches — `page.js` currently dodges it with `CardSkeleton as LoadingSkeleton`. Tighten the assertion to `expect(read(`${ROUTE}/page.js`)).not.toMatch(/<Card[\s/>]/);` and restore the plain `CardSkeleton` import.
2. `SettingRow`'s stacked variant is broken: `.settingRowStacked .settingText` keeps `flex: 1 1 240px`, which becomes a 240px *height* in column mode. Add `flex: 0 0 auto;` for the stacked case.
3. The hairline between `styles.form`'s `border-top` and the previous `SettingRow`'s `border-bottom` is doubled: drop the `border-top` from `.form`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile" tests/unit/profile-redesign.test.js
git commit -m "refactor(profile): drop the superseded styles"
```

Controller then runs `npm run build` and the runtime matrix (1440/1024/390, both themes, SSO collapsed→expanded, password mismatch, proxy toggle, shutdown dialog).

### Task 10: Move the handler bodies into hooks

**Files:**
- Create: `profile/hooks/useSsoSettings.js`, `profile/hooks/useNetworkSettings.js`, `profile/hooks/useBackupSettings.js`
- Modify: `profile/page.js`

The page still carries ~765 lines of state and handlers before its JSX. Each hook owns one area end to end — state, refs, handlers, status objects — and returns them as one object. Bodies move **verbatim**: no renamed variables, no reordered `await`s, no "while I'm here" fixes. If a body references something outside its area, pass it in (`patchSettings`, `settings`, `reload`, `router`).

- [ ] **Step 1: `useSsoSettings({ settings, patchSettings })`**

Move lines 43–77 (OIDC + SAML state, `ssoTypeTab`, `oidcExpanded`, `idpMetadataFileRef`, `certFileRef`) and handlers
`updateOidcForm` (375), `saveOidcSettings` (379), `testOidcConnection` (444), `updateSamlForm` (513), `handleIdpMetadataUpload` (517), `handleCertFileUpload` (570), `saveSamlSettings` (584), `testSamlConnection` (637), plus `oidcRedirectUri`/`samlAcsUrl`/`samlMetadataUrl` (58–60).
Return every value `SsoPanel` receives today, under the same names.

- [ ] **Step 2: `useNetworkSettings({ settings, setSettings, patchSettings })`**

Move lines 80–88 (`proxyForm`, `proxyStatus`, `proxyLoading`, `proxyTestLoading`) and handlers `updateOutboundProxy` (162), `testOutboundProxy` (192), `updateOutboundProxyEnabled` (230), `updateFallbackStrategy` (294), `updateComboStrategy` (309), `updateStickyLimit` (324), `updateComboStickyLimit` (342).

- [ ] **Step 3: `useBackupSettings({ reload })`**

Move lines 39–42, 79 (`dbLoading`, `dbStatus`, `dbAuth`, `pendingImportRef`, `importFileRef`) and `handleExportDatabase` (692), `handleImportDatabase` (725), `runImportDatabase` (734), `handleDbAuthConfirm` (764), `isRemoteHost` (89–96).

- [ ] **Step 4: Rewire `page.js`**

Replace the moved blocks with three hook calls; spread each hook's return into the panel props it already feeds. Password change (259), `updateRequireLogin` (360), `updateObservabilityEnabled` (666), `handleShutdown` (773), `handleLogout` (784), `applySettingsToForms` (98) and the shell state stay in the page.

- [ ] **Step 5: Gate**

```bash
cd tests && npx vitest run --config ./vitest.config.js unit/profile-redesign.test.js unit/profile-sections.test.js unit/cli-tools-redesign.test.js unit/cli-tools-groups.test.js
cd .. && npx eslint "src/app/(dashboard)/dashboard/profile"
wc -l "src/app/(dashboard)/dashboard/profile/page.js" "src/app/(dashboard)/dashboard/profile/hooks/"*.js
```
Expected: 44 passed; only the pre-existing `set-state-in-effect`; `page.js` under 320 lines and every hook under 400. Compare the panel prop lists before and after with `grep -c "=" proof` — no prop may disappear.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/profile"
git commit -m "refactor(profile): move the sso, network and backup handlers into hooks"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §4 layout (intro, sticky chips, panels) | 4 |
| §5 visual system | 3, 4 |
| §6 three row types | 3 |
| §7 seven sections | 4, 5, 6, 7, 8 |
| §8 code structure + shared promotion | 1, 2, 3, 9, 10 |
| §9 preserved behaviour | 5, 6, 8 (each panel passes the existing handlers verbatim) |
| §10 responsive | 3, 4 (CSS blocks) |
| §11 accessibility | 3, 4 (aria-labelledby, aria-current, role=status) |
| §12 testing | 2, 4, 8, 9, 10 |

**Placeholder scan:** no TBD/TODO; every new file ships full code; panels that reuse existing JSX say exactly which rows and which handlers, and the executor reads the source for the unchanged bodies.

**Type consistency:** `patchSettings` returns `{ ok, data }` and every panel destructures those names; `useProfileSettings` returns `{ settings, setSettings, loading, loadError, reload }`; `ActionRow` takes `message`/`tone`/`children`, and panels pass `tone` as `success | danger | neutral`; `activeSectionId` takes `(offsets, line)` and returns an id or `null`.
