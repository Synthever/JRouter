# Profile Page Redesign Specification

**Date:** 2026-11-01
**Route:** `/dashboard/profile`
**Reference:** shipped redesigns of `/dashboard`, `/dashboard/endpoint`, `/dashboard/providers`, `/dashboard/combos`, `/dashboard/usage`, `/dashboard/health`, `/dashboard/quota`, `/dashboard/cli-tools`
**Status:** Approved design, implementation plan pending

## 1. Context & Objectives

`/dashboard/profile` is the last settings surface still built from the pre-redesign vocabulary. `page.js` is 1,693 lines holding six major sections, one SSO wizard, four IdP guides, a backup import flow and a shutdown confirmation; `profile.module.css` is 260 lines of row and panel styles that overlap what the rest of the dashboard already encodes. The page mixes Tailwind utilities with module classes, has no navigation between sections, and its seven card headers compete with the setting labels for attention.

This spec brings the page onto the shipped language and pays down the file size:

1. One page intro, one sticky jump-chip toolbar, seven section panels with hairline rows.
2. `FieldRow` / `FieldGroup` promoted from the CLI Tools route into `src/shared/components/ui/` so both surfaces share one row system.
3. `page.js` becomes state + composition; each section becomes its own component file.
4. Zero behavioural change: same endpoints, same payloads, same validations, same confirmations.

## 2. Decisions Taken During Brainstorming

| Question | Decision |
| --- | --- |
| Page shape | Single column with a sticky jump-chip toolbar (the `/dashboard/providers` pattern), not a left rail and not tabs. |
| SSO section | Stays on this page as a collapsible panel, closed by default; OIDC/SAML switch via pill tabs. No new route. |
| Instance info strip | None. Intro line only; version and Local/Remote mode stay in the footer as today. |
| Code structure | Promote `FieldRow`/`FieldGroup` to `shared/components/ui/`, keep the CLI Tools imports working through re-exports, and extract the seven sections into `profile/components/`. |

## 3. Data Sources

All client-side; no new API route, no handler change.

| Source | Used for |
| --- | --- |
| `GET /api/settings` | every toggle, form seed and auth mode on the page |
| `PATCH /api/settings` | password change, fallback/combo strategy, sticky limits, require-login, observability, outbound proxy, OIDC/SAML settings |
| `POST /api/settings/proxy-test` | proxy connectivity test |
| `POST /api/auth/oidc/test`, `POST /api/auth/saml/test` | SSO connection tests |
| `GET /api/settings/database`, `POST /api/settings/database` | database export/import, unchanged |
| `POST /api/version/shutdown`, logout route | session and server actions, unchanged |

A failed `GET /api/settings` renders the existing load-error state and keeps every control disabled; it never renders fabricated defaults.

## 4. Layout

```
.page                    flex column, gap 24px, padding-bottom 40px
├── .intro               h1 "Profile" clamp(28–40px)/500/-0.05em + sub 16px
├── .toolbar             sticky, top calc(-1 * var(--usage-stick-offset)), z 30
│   └── .chip × 7        pill, 36px, radius --r-full, counts excluded
├── section × 7          <section id="profile-…"> panel radius 24px, padding 28px, 1px --line
│   ├── .panelHeader     icon 18px + h2 18px/600 + description 13px --text-2
│   └── rows             SettingRow | FieldRow | ActionRow  (see §6)
└── .appInfo             version + Local/Remote mode, 12px --text-3
```

Section order is unchanged: Preferences & data → Security → Single Sign-On → Routing Strategy → Network → Observability → Session & server.

The active chip is driven by an `IntersectionObserver` over the seven sections, not only by click state, so manual scrolling keeps the toolbar honest.

## 5. Visual System

Only existing tokens: `--canvas`, `--surface`, `--surface-2`, `--surface-inset`, `--surface-hover`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--pos`, `--warn`, `--danger`, `--r1`–`--r4`, `--r-full`, `--font-sans`, `--font-display`, `--font-mono`. No raw colour values and no new tokens.

Type: intro `clamp(28px, 3.4vw, 40px)` weight 500 `-0.05em`; section `h2` 18px/600; row label 14px/500; hint and description 12–13px `--text-2`; mono labels (field rows, read-only values) 11px `--font-mono`. Row separators are 1px `--line` except after the last row in a panel.

## 6. Rows

Three row types. `SettingRow` lays out a label block and its control at opposite ends of the row (the current page's toggle pattern); `FieldRow` uses the 8rem label column from the CLI Tools kit. They are deliberately different: a toggle reads better with its hint beside the switch, while an input needs a stable label column.

**`SettingRow`** — `{ label, hint, children, stacked }`. Label and hint on the left, control right-aligned. Used by: every toggle, the theme segmented control, the language button, read-only value rows, and the two session buttons. `stacked` switches to label-above-control for wide controls.

**`FieldRow`** (shared) — `{ label, hint, aside, children }`. Mono label, arrow, control, optional trailing slot. Used by every `Input`, `select` and `textarea` on the page.

**`ActionRow`** — `{ message, tone, children }`. Renders the section's `role="status"` line on the left and its buttons on the right; replaces the inline `flex … border-t` blocks. Sections without a message render buttons only.

Read-only values (database path, ACS URL, SP metadata URL, OIDC redirect URI) render as `<code>` inside `--surface-2` with a copy button, wrapped in `SettingRow` so their width matches the rest.

## 7. Section Specification

| Section id | Contents |
| --- | --- |
| `profile-preferences` | Appearance (segmented Light/Dark/System); Display language (button opening `LanguageSwitcher`); Local mode row (running on this machine); Database location row with path + Download backup / Import backup |
| `profile-security` | Require login toggle; password form: current / new / confirm (`FieldRow`, password type) + `Update password` in the action row; mismatch error in the row's status slot |
| `profile-sso` | Collapsible header (status chip: `Password` / `OIDC` / `SAML` / `Both`); auth-mode select; pill tabs `SAML 2.0` / `OIDC`; per-method fields; IdP guide disclosure with four cards; metadata-import row; ACS + metadata URL rows; `Save` / `Test` in the action row |
| `profile-routing` | Round Robin toggle; Sticky limit (`FieldRow`, number, visible only when round-robin); Combo round robin toggle; Combo sticky limit (same visibility rule); one-line summary in the panel description position |
| `profile-network` | Outbound proxy toggle; Proxy URL + No proxy (`FieldRow`); `Test proxy URL` / `Apply` in the action row, both disabled while the toggle is off |
| `profile-observability` | Enable observability toggle with its hint |
| `profile-session` | Dashboard session (Logout, secondary); Stop proxy server (Shutdown, danger, opens the existing confirm modal) |

`appInfo` stays outside the panels: `{APP_CONFIG.name} v{APP_CONFIG.version}` and the Local/Remote line.

## 8. Code Structure

Create:

| Path | Responsibility |
| --- | --- |
| `src/shared/components/ui/FieldRow.js` | Moved verbatim from `cli-tools/components/ui/`; CSS moves to `src/shared/components/ui/field.module.css` |
| `src/shared/components/ui/FieldGroup.js` | Same move |
| `src/app/(dashboard)/dashboard/profile/profileSections.js` | Section metadata (`id`, chip label, icon, description) + `activeSectionId(entries, scrollTop)` helper — pure, unit-tested |
| `profile/components/SettingsPanel.js` | Panel + header + `aria-labelledby` |
| `profile/components/SettingRow.js` | Label/hint + control row |
| `profile/components/ActionRow.js` | Status line + buttons |
| `profile/components/StatusLine.js` | Success/error line with icon, replaces `ProfileStatus` |
| `profile/components/PreferencesPanel.js` | Preferences & data |
| `profile/components/SecurityPanel.js` | Security |
| `profile/components/SsoPanel.js` | SSO (largest; owns its own collapsible state via props) |
| `profile/components/RoutingPanel.js` | Routing strategy |
| `profile/components/NetworkPanel.js` | Network |
| `profile/components/SessionPanel.js` | Two panels: Observability and Session & server |

Modify: `profile/page.js` (state, fetches, composition — target under 300 lines), `profile/profile.module.css` (layout + row styles only), `cli-tools/components/ui/FieldRow.js` and `FieldGroup.js` (become one-line re-exports so the 15 tool cards are untouched).

The CLI Tools CSS keeps its own `.field`/`.fieldLabel` rules until the shared module lands; the move must leave `cli-tools.module.css` with no duplicated field rules after the cutover.

## 9. Preserved Behaviour

- Password change: mismatch blocks submit; same PATCH body; same success/error copy.
- OIDC save: requires issuer + client id + secret unless `settings.oidcConfigured`; test saves first, then calls the test route with the saved values.
- SAML save/test: same field mapping, same metadata/cert parsing, same ACS and metadata URLs.
- Routing: same `fallbackStrategy` / `comboStrategy` values and the same `stickyRoundRobinLimit` clamps (1–10 / 1–100).
- Network: proxy fields disabled while the toggle is off; test requires a URL.
- Backup import/export keeps the password confirm modal and its existing flow.
- Shutdown keeps its `ConfirmModal` and copy.

## 10. Responsive

| Width | Behaviour |
| --- | --- |
| > 1280px | 8rem label column, chips in one row |
| 900–1280px | 6rem label column, chips may wrap |
| 640–900px | rows stack label-over-control, chips scroll horizontally inside their own container |
| < 640px | page padding 12px, panel padding 16px, 44px targets, 16px input font, action buttons full width |

## 11. Accessibility

- Each panel is a `<section aria-labelledby>` pointing at its `h2`; the chip toolbar is a `<nav aria-label="Jump to a settings section">`.
- Chips are anchor links to `#profile-…` with `aria-current="true"` on the active one, so keyboard users can jump without the scroll spy.
- Every toggle keeps its `aria-label`; every field keeps its label or `aria-label`; status lines keep `role="status"` and errors `role="alert"`.
- Focus ring: `outline: 2px solid var(--text)` offset 2px on all interactive elements in the route.
- `prefers-reduced-motion: reduce` disables the panel transitions.

## 12. Testing & Verification

Unit (`tests/unit/profile-sections.test.js`): section metadata has seven unique ids in the documented order; `activeSectionId` picks the last section whose top has passed the reading line; empty input returns the first id.

Contract (`tests/unit/profile-redesign.test.js`, source-text): `page.js` renders the intro, the chip toolbar and the seven section components; no `<Card` remains in `page.js`; every section id in `profileSections.js` appears in a panel component; `cli-tools/components/ui/FieldRow.js` is a re-export of the shared module.

Commands: `npx eslint` on every touched file; `cd tests && npx vitest run --config ./vitest.config.js unit/profile-sections.test.js unit/profile-redesign.test.js`; `npm run build`; runtime matrix at 1440 / 1024 / 390 in both themes, covering SSO collapsed→expanded, password mismatch, proxy toggle on/off, and the shutdown dialog.

## 13. Non-goals

- No new API route, no settings key, no migration.
- No change to backup/import, SSO protocols, or shutdown behaviour.
- No left rail, no tabs, no per-section URLs beyond in-page anchors.
- No new colour tokens, fonts or icons.
- The `Settings` route (`/dashboard/settings/pricing`) is untouched.

## 14. Rollout

1. **Foundation** — move `FieldRow`/`FieldGroup` to `shared/components/ui/` with re-exports, add `profileSections.js` + its unit test; CLI Tools stays green (34 tests).
2. **Shell + panels** — `SettingsPanel`, `SettingRow`, `ActionRow`, `StatusLine`, the two simplest sections (Observability, Session) and the page skeleton with toolbar; contract test lands here.
3. **Remaining sections** — Preferences, Security, Routing, Network, then SSO, each replacing its JSX in place and deleting the old block from `page.js`; the contract test extends per section.
4. **Cleanup** — drop dead `profile.module.css` rules, confirm `page.js` is under 300 lines and every CLI Tools test still passes.
