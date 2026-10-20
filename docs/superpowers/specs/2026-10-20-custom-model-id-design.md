# Custom Model-ID & API Key Roles — Design Specification

Status: approved for planning (2026-10-20)
Scope: JRouter (`/root/workspace/JRouter`, branch `master`)

## 1. Context & Objectives

JRouter is being opened to users beyond its owner. Today every API key can call
everything: any combo, any provider directly, and any model alias. That is fine
while the instance serves one person and is unacceptable once keys are handed to
other people, because a user can consume the owner's provider accounts through
paths the owner never chose to publish.

This specification introduces two things:

1. **Custom Model-IDs (CMID)** — the owner publishes selected combos under a
   stable public model name that API-key users may call.
2. **API key roles** — `owner` keys keep full access; `user` keys may call only
   published CMIDs.

The design deliberately reuses the existing combo execution engine. The previous
virtual-namespace subsystem (Models Aliases, namespace `jrouter/*`) was rolled
back on 2026-10-17 because its member-eligibility path bypassed the capacity
adapter. This design does not restore that code; it adds a thin publication layer
on top of the combo path that is already exercised in production.

### Non-goals

- No new routing engine, no second execution path, no `jrouter/*` namespace.
- No per-CMID member eligibility rules separate from the combo's own members.
- No billing, metering or quota product on top of roles; existing per-key policy
  (quotas, rate limits, expiry, output caps) keeps working unchanged.
- No change to how combos are created or to member ordering/strategy semantics.

## 2. Terminology

- **CMID / public name** — the bare model string a client sends
  (`model: "gpt-fast"`). Resolves to exactly one combo.
- **Internal combo** — the combo row that actually holds members, strategy and
  prompt settings.
- **Role** — `owner` or `user` on an API key.
- **Publish** — setting a combo's `visibility` to `public`.

## 3. Data Model

All changes are additive. `SCHEMA_VERSION` moves from `5` to `6`; `migrate.js`
takes the pre-migration safety backup automatically because the central version
is bumped.

### 3.1 `combos`

| Column | Type | Default | Notes |
|---|---|---|---|
| `visibility` | `TEXT NOT NULL DEFAULT 'private'` | `private` | `private` \| `public` |
| `publicName` | `TEXT` | `NULL` | `NULL` ⇒ public name is `name` |

Migration `004-custom-model-id.js`, following the shape of
`003-combo-prompt-injection.js`: `buildCreateTableSql("combos", TABLES.combos)`
then `ALTER TABLE combos ADD COLUMN` for each missing column.

No new DB-level unique index is added on `publicName`. The uniqueness rule spans
several namespaces (combo names, other public names, provider ids/aliases,
provider-node prefixes) and cannot be expressed as a single-column constraint.
It is enforced in the API layer (§5.1) and covered by tests.

### 3.2 `apiKeys`

| Column | Type | Default | Notes |
|---|---|---|---|
| `role` | `TEXT NOT NULL DEFAULT 'owner'` | `owner` | `owner` \| `user` |

`DEFAULT 'owner'` is what keeps the live instance working: every existing key
(whether or not it carries `accessRestricted`) stays full-access after the
migration. There is no backfill that changes `role` or `accessRestricted`.

For **new** keys, the DB/API default stays `owner` (backward compatible for CLI
and older dashboard code). The dashboard create dialog defaults the control to
`user`, so accidental owner-key issuance requires a deliberate selection.

### 3.3 Repos

- `combosRepo.rowToCombo` exposes `visibility` and `publicName`.
- `createCombo`/`updateCombo` persist both.
- New `getComboByPublicName(publicName)` — exact match on `COALESCE(publicName, name)`.
- `apiKeysRepo.rowToKey` exposes `role`; `createApiKey` accepts an optional role
  (default `owner`); `updateApiKey` persists role changes.
- `sanitizeApiKey` passes `role` through (it strips only `key` and `machineId`).

## 4. Resolution & Enforcement

### 4.1 Public-name resolution (all roles)

New helper in `src/sse/services/model.js`:

```
resolvePublicCombo(modelStr)  →  combo | null
```

Matches `COALESCE(publicName, name) = modelStr` and requires
`visibility = 'public'`.

It is consulted **before** the existing internal-combo lookup and applies to
every key role, so a public name means the same thing regardless of who calls it.
A public name that also happens to equal a private combo's `name` is rejected at
write time (§5.1), so there is no ambiguity to resolve at request time.

Call sites to update:

- `getComboModels(modelStr)` — return the resolved combo's members for a public
  name (still returns `null` when the string contains `/`).
- `getModelInfo(modelStr)` — return `{ provider: null, model: <internal combo name> }`
  for a public name, so callers route through the combo path.
- `handleChat` → `applyComboBehavior` — look up the **internal** combo (so its
  prompt settings apply) but pass the client's original string as
  `requestedModel`, which `COMBO_PROMPT_VARIABLES` already exposes as
  `requested_model`.

The `jrouter/*` guard in `getModelInfo` is untouched.

### 4.2 Role gate

`getKeyAccessContext(request)` additionally returns `role` (read from the key
row). Keys are still only **authenticated** elsewhere (`dashboardGuard`,
`requireApiKey`); this layer decides what an identified key may call.

Rules, applied inside the existing gate functions
(`enforceKeyAccess`, `enforceKeyAccessResolved`, `enforceKeyAccessProvider`,
`filterModelsListForKey`):

- `owner` — unchanged; no restriction is added anywhere.
- `user` — allowed **iff** the requested string is a bare name (no `/`) that
  resolves to a combo with `visibility = 'public'`.
  Everything else is denied with HTTP 403, code `role_not_allowed`:
  - direct provider calls (`provider/model`),
  - internal/private combos,
  - model aliases, custom models, provider-as-model endpoints
    (search/fetch) — a user key has no granted provider.
- `restricted` + `access.allow` keeps applying **inside** the role. A `user` key
  is additionally narrowed by its allow list; the two checks stack and never
  widen each other.
- Allow entries may name a public name. `getAllowSets` must resolve each entry
  through `resolvePublicCombo` before the internal-combo/model lookups, otherwise
  an allow list holding `gpt-fast` silently resolves to nothing (it is not an
  internal combo name and not a `provider/model`) and the key appears to grant
  no access at all.

Denial messages name only what the client sent; they never include the key name,
the role internals or a list of published names.

### 4.3 Adapter models are granted by the parent combo

`filterAdapterModels` currently keeps an adapter model only when the key's allow
list names it. A `user` key has no allow entries, so today's logic would strip
every Vision Adapter fallback and break image requests for a perfectly healthy
public combo.

Rule: for role `user`, adapter models injected by the server for an
already-authorized target are retained (same principle as "an allowed combo
grants the members it routes to"). Nested combos follow the same rule: members of
a published combo are server-owned internals, not client-chosen targets.

### 4.4 Per-key model restrictions vs. role

`assertCurrentModelAllowed` (invoked from `getModelInfo`, and re-invoked for each
combo member while `context.isCombo`) must not let an owner's
`allowedModels`/`blockedModels` entries silently break a user key whose only
authorized target is the public name.

Decision: when `policy.role === 'user'` and `context.isCombo`, member-level
assertion is skipped. The public-name gate in §4.2 is the authorization decision;
members are implementation detail. For `owner` keys, member-level assertion is
unchanged.

### 4.5 Discovery

`/v1/models` (and `/v1beta/models`, `/api/v1/models`) for a `user` key returns
only published CMIDs: `id = publicName`, `owned_by: "combo"`, with the same
capability and limit aggregation combos already publish (`aggregateComboCapabilities`,
`comboSeatLimits`, `comboSeatCapabilities`). No provider models, no private
combos, no custom models.

### 4.6 `count_tokens`

`POST /v1/messages/count_tokens` runs inside `withApiKeyPolicy(..., { billable: false })`
and never calls `getModelInfo`, so a user key can currently pass any model string.
The endpoint is cheap and returns an estimate, but it is a policy inconsistency:
it accepts model names the key may not use.

Decision: add the role gate to this route in the same scope. It must not become
an existence oracle — the response for a denied model is the same
`role_not_allowed` 403 the chat path returns, and no upstream is contacted.

## 5. API Changes

### 5.1 `POST/PUT /api/combos`

Accepts `visibility` and `publicName` alongside the existing fields.

Validation (server-side, in the route, rejecting with 400 rather than repairing):

- `visibility ∈ { 'private', 'public' }`.
- `publicName` is `null` or a string of 1–64 chars matching
  `/^[a-zA-Z0-9_.\-]+$/` (same grammar as combo names).
- `publicName` must not collide with: any other combo's effective public name,
  any combo's internal `name`, any provider id or provider alias from the
  registry, or any configured provider-node prefix.
- `publicName === name` is the identity mapping and needs no extra rule: `name`
  is already `UNIQUE` in the schema, so only the row's own name can equal it.
- Publishing requires a non-empty `models` list (an empty public model that
  routes nowhere is a footgun for users).

`GET /api/combos` returns the new fields; no shape change for existing consumers.

### 5.2 `POST/PATCH /api/keys`

Accepts `role ∈ { 'owner', 'user' }`. `validateKeySettings` already validates an
allowlist of accepted fields (`DEFAULT_KEY_POLICY` keys plus `name`/`isActive`);
`role` is added to that allowlist and validated there, so every write path
(`createApiKey`, `updateApiKey`, both routes) shares one validation point rather
than duplicating a check in the routes. Existing clients that omit `role` keep
the `owner` default.

## 6. UI

### 6.1 `Combos & Custom Model-IDs` (`/dashboard/combos`)

One route, `SegmentedControl` tabs (pattern already used by `/dashboard/usage`):

- **Models** (default) — the table.
- **Vision Adapter** — the existing `CapacityAdapterSection`, moved verbatim.

The Vision Adapter is not stacked under the table: it is global configuration
that must not be filtered by a search box, and burying it below a long table
means dead scrolling.

Table columns:

1. **Model** — `publicName` in mono as the primary label, internal `name` beneath
   it when they differ, copy control. The public name leads because it is what
   users see.
2. **Members** — first 3 chips + `+N`, plus capability badges and
   `ctx … · max …` from the existing resolvers.
3. **Strategy** — the existing inline strategy select (fallback / round-robin /
   fusion + judge).
4. **Visibility** — `Public`/`Private` badge + publish toggle (`Toggle` +
   `StatusBadge` as used elsewhere). Toggling issues `PUT /api/combos/[id]`.
5. **Updated** — relative timestamp; supports sorting.
6. **Actions** — icon-only Edit, Settings (prompt injection), Limits, Delete,
   each with an accessible name and 44px target, reusing
   `DashboardControls.iconButton` via `comboActions`.

Toolbar: search input (matches `name`, `publicName`, and member strings), filter
`All / Public / Private`, filter by strategy, and the existing select-all + bulk
actions (set strategy, delete) plus bulk Publish/Unpublish (cheap: the payload is
only `visibility`).

Create/Edit stay in the existing `ComboFormModal`; Settings stays
`ComboSettingsModal`; Limits stays `ComboLimitsModal`. No new modal.

Styling: reuse `combos.module.css` tokens and existing control components. The
existing `.table` is `table-layout: fixed` with centered columns, sized for the
4-column adapter pool; the model table uses a separate `.modelTable` class with
`table-layout: auto` so Members chips are not clipped. No new colors, fonts or
visual language.

Mobile (< 640px): rows collapse to stacked cards (name + members + badges, actions
right-aligned). A 6-column table at 320px always breaks; this is the only
genuinely new CSS.

### 6.2 Sidebar

Label becomes `Combos & Custom Model-IDs`. Still one entry, same route.

### 6.3 Endpoint / API key dialog

A **Role** section (`Owner` / `User`) with a one-line consequence hint sits above
Model Restrictions. When role is `user`, the Model Restrictions section renders
the published-CMID picker as information (a user key can only call published
CMIDs anyway) instead of implying it can be widened to providers.

## 7. Rollout

Ordered so each step is independently testable and behaviorally compatible:

1. Schema + migration + repos + `SCHEMA_VERSION` bump. No behavior change.
2. Public-name resolution + tests. Still a no-op: nothing is published and no
   row has `publicName`.
3. Role gate + tests. Every key is `owner`, so behavior is identical.
4. Combo API validation + key `role` API + key dialog.
5. Combos table UI.
6. Publish toggle + discovery filtering.
7. `count_tokens` gate.

Commit and release are separate authorizations, per repo convention. The release
uses the durable pipeline (`/root/workspace/.jrouter-releases/deploy_jrouter_release.py <slug>`)
with per-feature marker assertions, not a fresh copy.

## 8. Testing

New unit tests:

- `custom-model-id-resolution.test.js` — public name resolves before the internal
  combo lookup; `publicName` defaulting to `name`; unrelated names unaffected.
- `custom-model-id-validation.test.js` — collisions against combo names, other
  public names, provider ids/aliases and node prefixes are all rejected; grammar
  and length limits; publishing an empty combo rejected.
- `key-role-gate.test.js` — owner passes every path; user passes only published
  bare names; user denied for direct provider, private combo, alias, custom
  model, search/fetch; `restricted` + role stacking; adapter models retained for
  a user key on a published combo; nested-combo members allowed.
- `key-role-migration.test.js` — pre-existing rows become `role='owner'` and
  `visibility='private'`; `accessRestricted` untouched.

Regression suites that must stay green: `key-access.test.js`,
`key-access-controls.test.js`, `key-access-handlers.test.js`,
`key-access-migration.test.js`, `combo-routing.test.js`,
`combo-prompt-*.test.js`, `v1-models-combo-context.test.js`.

Standalone smoke (port 20129, fresh `HOME`/`DATA_DIR`, synthetic fixtures per the
runbook): owner key → private combo 200; user key → private combo 403, direct
provider 403, published CMID 200; `/v1/models` for the user key lists only the
published name.

Live gate after cutover: existing keys still work as owner, publish/unpublish
round-trip via the dashboard, and a user-key `count_tokens` call returns the
typed 403 rather than a body.

Browser gate: table renders desktop + 320/390px, light/dark, search and filters
work against real data, actions reachable at 44px, publish toggle persists.

## 9. Blast Radius & Rollback

Highest risks and their mitigations:

1. **Public-name collision** → request routed to the wrong target without an
   error. Mitigation: API-level validation (§5.1) + adversarial tests.
2. **User key loses Vision Adapter** → image requests fail on a healthy combo.
   Mitigation: §4.3 + explicit test.
3. **Live keys change behavior** → production traffic breaks. Mitigation:
   `role` defaults to `owner`, `visibility` defaults to `private`, no backfill
   touching access columns.

Rollback: artifact-only via the release pipeline, as with previous releases. The
new columns are additive and ignored by the previous build, so rolling the build
pointer back does not require restoring the database. The pre-migration backup
taken by `migrate.js` remains available if data-level recovery is ever needed.

## 10. Open Decisions

None. Decisions taken during brainstorming and recorded here: A2 (publish flag
plus separate `publicName`), bare-name namespace, owner-default at the API with a
user-default control in the create dialog, prompt injection inherited from the
combo (no second editor), and `count_tokens` gated in this scope.
