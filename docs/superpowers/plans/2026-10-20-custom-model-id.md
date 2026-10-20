# Custom Model-ID & API Key Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner publish selected combos under stable public model names and restrict `user` API keys to exactly those names.

**Architecture:** A publication flag (`combos.visibility` + `combos.publicName`) layered on the existing combo execution engine, plus a `role` column on `apiKeys`. Public-name resolution runs before the internal-combo lookup and applies to every role; the role gate is enforced inside the existing `keyAccess.js` gate functions so all seven inference handlers, `/v1/models` and `/v1beta` are covered without per-handler edits.

**Tech Stack:** Next.js 16, React 19, plain JavaScript (ESM), `node:sqlite` adapter, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-custom-model-id-design.md`

## Global Constraints

- All schema changes are additive; `SCHEMA_VERSION` goes `5 → 6` and `migrate.js` takes the pre-migration backup.
- `combos.visibility` defaults to `'private'`; `apiKeys.role` defaults to `'owner'`. No backfill may change an existing key's effective access.
- Public names are **bare** (no `/`). The `jrouter/*` namespace guard in `getModelInfo` stays untouched.
- `visibility` and `publicName` are validated server-side in the route and rejected with 400 rather than repaired.
- Role rules: `owner` unchanged; `user` may call only published bare names. `access.restricted`/`allow` stack inside the role and never widen it.
- Denial messages name only what the client sent — never the key name, its role internals, or the list of published names.
- Reuse existing dashboard components and CSS tokens (no new visual language); `DashboardControls.iconButton`, `StatusBadge`, `Toggle`, `SegmentedControl`, `Input`, `ConfirmModal`.
- Commit style: Conventional Commits. Commit and release are separate authorizations; no push without instruction.
- Test isolation: every vitest command runs with `DATA_DIR`, `HOME` and `TMPDIR` pointing at fresh scratch dirs.

---

### Task 1: Schema, migration and repos

**Files:**
- Modify: `src/lib/db/schema.js` (`combos`, `apiKeys`, `SCHEMA_VERSION`)
- Create: `src/lib/db/migrations/004-custom-model-id.js`
- Modify: `src/lib/db/migrations/index.js`
- Modify: `src/lib/db/repos/combosRepo.js`
- Modify: `src/lib/db/repos/apiKeysRepo.js`
- Modify: `src/lib/db/index.js`, `src/lib/localDb.js`, `src/models/index.js` (re-export `getComboByPublicName`)
- Test: `tests/unit/custom-model-id-migration.test.js`

**Interfaces:**
- Produces: `getComboByPublicName(publicName) → combo|null`; `rowToCombo` gains `visibility: 'private'|'public'` and `publicName: string|null`; `rowToKey` gains `role: 'owner'|'user'`; `createApiKey(name, machineId, role?)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing migration test**

```js
// tests/unit/custom-model-id-migration.test.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '3'), ('backupSchemaVersion', '3')`);
  db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL, policy TEXT NOT NULL DEFAULT '{}', accessRestricted INTEGER DEFAULT 0, accessAllow TEXT)`);
  db.exec(`CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT, models TEXT NOT NULL, promptInjectionEnabled INTEGER NOT NULL DEFAULT 0, promptInjectionMode TEXT NOT NULL DEFAULT 'prepend', systemPrompt TEXT, displayIdentity TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  db.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES (?,?,?,?,?,?,?,?)`)
    .run("k1", "sk-legacy-1", "Default Key", "m", 1, "2026-09-01T00:00:00.000Z", 1, '["Main"]');
  db.prepare(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`)
    .run("c1", "Main", null, '["openai/model-a"]', "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  db.close();
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jr-cmid-migrate-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("custom-model-id migration", () => {
  it("adds role/visibility without changing existing access", async () => {
    writeLegacyDb(tempDir);
    delete global._dbAdapter;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");

    const keys = await db.getApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ id: "k1", role: "owner", access: { restricted: true, allow: ["Main"] } });

    const combos = await db.getCombos();
    expect(combos).toHaveLength(1);
    expect(combos[0]).toMatchObject({ name: "Main", visibility: "private", publicName: null });
    expect(combos[0].models).toEqual(["openai/model-a"]);
  });

  it("looks a combo up by its effective public name", async () => {
    writeLegacyDb(tempDir);
    delete global._dbAdapter;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");
    await db.updateCombo("c1", { visibility: "public", publicName: "gpt-fast" });

    expect((await db.getComboByPublicName("gpt-fast"))?.id).toBe("c1");
    expect(await db.getComboByPublicName("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/custom-model-id-migration.test.js`
Expected: FAIL — `db.getComboByPublicName is not a function` / `role` undefined.

- [ ] **Step 3: Add the columns and bump the schema version**

In `src/lib/db/schema.js`:

```js
export const SCHEMA_VERSION = 6;
```

In `TABLES.combos.columns`, after `displayIdentity`:

```js
      // Publication for Custom Model-IDs. Private by default so a deploy never
      // exposes a combo the owner did not publish. publicName NULL ⇒ the
      // combo's own `name` is its public model id.
      visibility: "TEXT NOT NULL DEFAULT 'private'",
      publicName: "TEXT",
```

In `TABLES.apiKeys.columns`, after `accessAllow`:

```js
      // owner = full access (today's behaviour for every existing key);
      // user = may call published Custom Model-IDs only.
      role: "TEXT NOT NULL DEFAULT 'owner'",
```

- [ ] **Step 4: Write migration 004**

```js
// src/lib/db/migrations/004-custom-model-id.js
import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 4,
  name: "custom-model-id",
  up(db) {
    db.exec(buildCreateTableSql("combos", TABLES.combos));
    db.exec(buildCreateTableSql("apiKeys", TABLES.apiKeys));
    const comboCols = new Set(db.all("PRAGMA table_info(combos)").map((column) => column.name));
    for (const name of ["visibility", "publicName"]) {
      if (!comboCols.has(name)) db.exec(`ALTER TABLE combos ADD COLUMN ${name} ${TABLES.combos.columns[name]}`);
    }
    const keyCols = new Set(db.all("PRAGMA table_info(apiKeys)").map((column) => column.name));
    if (!keyCols.has("role")) db.exec(`ALTER TABLE apiKeys ADD COLUMN role ${TABLES.apiKeys.columns.role}`);
  },
};

export default migration;
```

Register it in `src/lib/db/migrations/index.js`:

```js
import m004 from "./004-custom-model-id.js";

export const MIGRATIONS = [m001, m002, m003, m004].sort((a, b) => a.version - b.version);
```

- [ ] **Step 5: Persist and expose the new fields in `combosRepo.js`**

`rowToCombo` gains:

```js
    visibility: row.visibility === "public" ? "public" : "private",
    publicName: row.publicName || null,
```

`createCombo` insert (add the two columns and their placeholders):

```js
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt, promptInjectionEnabled, promptInjectionMode, systemPrompt, displayIdentity, visibility, publicName) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt, combo.promptInjectionEnabled ? 1 : 0, combo.promptInjectionMode, combo.systemPrompt, combo.displayIdentity, combo.visibility, combo.publicName]
  );
```

with, in the built object:

```js
    visibility: data.visibility === "public" ? "public" : "private",
    publicName: typeof data.publicName === "string" ? data.publicName : null,
```

`updateCombo`'s `UPDATE` gains `visible = ?, publicName = ?` — use exactly:

```js
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ?, promptInjectionEnabled = ?, promptInjectionMode = ?, systemPrompt = ?, displayIdentity = ?, visibility = ?, publicName = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, merged.promptInjectionEnabled ? 1 : 0, merged.promptInjectionMode, merged.systemPrompt, merged.displayIdentity, merged.visibility === "public" ? "public" : "private", merged.publicName ?? null, id]
    );
```

and add the lookup:

```js
// A public name is the combo's publicName when set, otherwise its name.
// Case-sensitive, exact match: the same comparison the model router uses.
export async function getComboByPublicName(publicName) {
  if (!publicName) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM combos WHERE COALESCE(NULLIF(publicName, ''), name) = ?`,
    [publicName]
  );
  return rowToCombo(row);
}
```

- [ ] **Step 6: Persist and expose `role` in `apiKeysRepo.js`**

`rowToKey` gains:

```js
    role: row.role === "user" ? "user" : "owner",
```

`createApiKey` takes an optional role and inserts it:

```js
export async function createApiKey(name, machineId, role = "owner") {
  ...
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    role,
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow, role) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow, apiKey.role]
  );
```

`updateApiKey` destructures role out of the settings and writes the column:

```js
    const { name, isActive, role, ...policyChanges } = validated;
    ...
    db.run(
      `UPDATE apiKeys SET name = ?, isActive = ?, policy = ?, updatedAt = ?, accessRestricted = ?, accessAllow = ?, role = ? WHERE id = ?`,
      [name ?? row.name, isActive === undefined ? row.isActive : (isActive ? 1 : 0), stringifyJson(policy), updatedAt, cols.accessRestricted, cols.accessAllow, role ?? (row.role === "user" ? "user" : "owner"), id]
    );
```

- [ ] **Step 7: Re-export the new repo function**

Add `getComboByPublicName` to the combo export lists in all three:
- `src/lib/db/index.js` → `getCombos, getComboById, getComboByName, getComboByPublicName,`
- `src/lib/localDb.js` → same line
- `src/models/index.js` → same line

- [ ] **Step 8: Run the migration test and the existing DB suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) \
  npx vitest run unit/custom-model-id-migration.test.js unit/key-access-migration.test.js unit/combo-prompt-settings.test.js
```
Expected: PASS (3 files). `key-access-migration` proves schema 1 → 6 still upgrades without touching access columns.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.js src/lib/db/migrations/004-custom-model-id.js src/lib/db/migrations/index.js \
  src/lib/db/repos/combosRepo.js src/lib/db/repos/apiKeysRepo.js src/lib/db/index.js src/lib/localDb.js src/models/index.js \
  tests/unit/custom-model-id-migration.test.js
git commit -m "feat(db): add combo visibility/publicName and api key role"
```

---

### Task 2: Public-name resolution in the model router

**Files:**
- Modify: `src/sse/services/model.js`
- Modify: `src/sse/handlers/chat.js` (`applyComboBehavior`, strategy keys)
- Test: `tests/unit/custom-model-id-resolution.test.js`
- Test mocks: the 8 unit files listed in Step 6

**Interfaces:**
- Consumes: `getComboByPublicName` from Task 1.
- Produces: `resolvePublicCombo(modelStr) → combo|null` (exported from `@/sse/services/model.js`); `getComboModels` / `getModelInfo` accept a public bare name.

- [ ] **Step 1: Write the failing resolution test**

```js
// tests/unit/custom-model-id-resolution.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "fast-fallback", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] },
    { id: "c2", name: "internal-only", visibility: "private", publicName: null, models: ["openai/model-b"] },
    { id: "c3", name: "named-combo", visibility: "public", publicName: null, models: ["openai/model-c"] },
  ],
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) =>
    fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => [],
}));

const { getComboModels, getModelInfo, resolvePublicCombo } = await import("../../src/sse/services/model.js");

beforeEach(() => {
  fx.combos = fx.combos.map((c) => ({ ...c }));
});

describe("custom model-id resolution", () => {
  it("resolves a published publicName to its members", async () => {
    expect(await resolvePublicCombo("gpt-fast")).toMatchObject({ name: "fast-fallback" });
    expect(await getComboModels("gpt-fast")).toEqual(["openai/model-a"]);
  });

  it("falls back to the combo name when publicName is null", async () => {
    expect(await getComboModels("named-combo")).toEqual(["openai/model-c"]);
  });

  it("does not expose a private combo through a public lookup", async () => {
    expect(await resolvePublicCombo("internal-only")).toBeNull();
    // the internal combo stays callable by its own name, exactly as today
    expect(await getComboModels("internal-only")).toEqual(["openai/model-b"]);
  });

  it("routes a public name through the combo path, not to a provider", async () => {
    expect(await getModelInfo("gpt-fast")).toEqual({ provider: null, model: "fast-fallback" });
  });

  it("leaves provider/model strings and unknown names alone", async () => {
    expect((await getModelInfo("openai/model-a")).provider).toBe("openai");
    expect(await resolvePublicCombo("nope")).toBeNull();
    expect(await getComboModels("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/custom-model-id-resolution.test.js`
Expected: FAIL — `resolvePublicCombo is not a function`.

- [ ] **Step 3: Implement `resolvePublicCombo` and wire it in**

In `src/sse/services/model.js`, extend the import:

```js
import { getModelAliases, getComboByName, getComboByPublicName, getProviderNodes } from "@/lib/localDb";
```

Add:

```js
/**
 * Resolve a published Custom Model-ID (a bare name) to its combo.
 * Returns null for anything that is not a bare name, is not published, or does
 * not exist — callers then continue with the ordinary internal lookups.
 */
export async function resolvePublicCombo(modelStr) {
  if (!modelStr || modelStr.includes("/")) return null;
  const combo = await getComboByPublicName(modelStr);
  return combo?.visibility === "public" ? combo : null;
}
```

In `getComboModels`, resolve the public name first:

```js
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const published = await resolvePublicCombo(modelStr);
  const combo = published || (await getComboByName(modelStr));
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
```

In `getModelInfo`, map a public name onto its internal combo name so every caller
(chat, image, tts, policy wrapper) takes the combo path:

```js
export async function getModelInfo(modelStr) {
  const published = await resolvePublicCombo(modelStr);
  const info = published
    ? { provider: null, model: published.name }
    : await resolveModelInfo(modelStr);
  ...
```

(keep the existing `jrouter/*` guard and `assertCurrentModelAllowed` calls unchanged, operating on `info`).

- [ ] **Step 4: Make prompt injection and strategy keys follow the public name**

In `src/sse/handlers/chat.js`, import the resolver:

```js
import { getModelInfo, getComboModels, resolvePublicCombo } from "../services/model.js";
```

`applyComboBehavior` must read settings from the **internal** combo while keeping the
client's string as `requested_model`:

```js
async function applyComboBehavior(body, comboName, request, clientRawRequest) {
  const combo = (await getComboByName(comboName)) || (await resolvePublicCombo(comboName));
  if (!combo) return body;
  const requestedModel = clientRawRequest?.body?.model || body.model || comboName;
  const sourceFormat = request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null;
  const transformed = applyComboPromptInjection(body, combo, { requestedModel, sourceFormat });
  ...
```

In `handleChatRequest` and the nested-combo branch of `handleSingleModelChat`, resolve the
settings key once so a published name inherits the combo's strategy:

```js
  const publishedTarget = await resolvePublicCombo(modelStr);
  const comboKey = publishedTarget?.name || modelStr;
```

and replace `comboStrategies[modelStr]` with `comboStrategies[comboKey]` in both
places (strategy lookup and judge/tuning lookup). Keep `comboName: modelStr` in the
log/handler arguments so client-visible identity does not change.

- [ ] **Step 5: Run the resolution test**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/custom-model-id-resolution.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Repair the mocks that import `model.js` with a `@/lib/localDb` mock**

Every one of these mocks needs the new export or the call throws
`getComboByPublicName is not a function`. Add to each mock factory:

```js
  getComboByPublicName: async () => null,
```

Files (verified by `grep -l 'vi.mock("@/lib/localDb"' ` over the importers of `sse/services/model`):

- `tests/unit/jrouter-namespace-404.test.js`
- `tests/unit/embedding-usage-persistence.test.js`
- `tests/unit/nous-provider-routes.test.js`
- `tests/unit/codex-image-usage-persistence.test.js`
- `tests/unit/policy-gateway-namespace-404.test.js`
- `tests/unit/combo-prompt-routing.test.js`
- `tests/unit/jrouter-namespace-chat-404.test.js`
- `tests/unit/key-access.test.js`

For mocks that already expose real combos (`key-access.test.js`), also make
`getComboByPublicName` resolve against the fixture:

```js
  getComboByPublicName: async (publicName) =>
    fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
```

- [ ] **Step 7: Run the affected suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/custom-model-id-resolution.test.js unit/jrouter-namespace-404.test.js unit/key-access.test.js \
  unit/combo-prompt-routing.test.js unit/policy-gateway-namespace-404.test.js unit/jrouter-namespace-chat-404.test.js
```
Expected: PASS. `jrouter-namespace-404` staying green proves the `jrouter/*` guard is untouched.

- [ ] **Step 8: Commit**

```bash
git add src/sse/services/model.js src/sse/handlers/chat.js tests/unit/custom-model-id-resolution.test.js \
  tests/unit/jrouter-namespace-404.test.js tests/unit/embedding-usage-persistence.test.js \
  tests/unit/nous-provider-routes.test.js tests/unit/codex-image-usage-persistence.test.js \
  tests/unit/policy-gateway-namespace-404.test.js tests/unit/combo-prompt-routing.test.js \
  tests/unit/jrouter-namespace-chat-404.test.js tests/unit/key-access.test.js
git commit -m "feat(model): resolve published custom model-ids before internal combos"
```

---

### Task 3: API key role gate

**Files:**
- Modify: `src/sse/services/keyAccess.js`
- Modify: `src/lib/apiKeyPolicy/context.js`
- Test: `tests/unit/key-role-gate.test.js`

**Interfaces:**
- Consumes: `resolvePublicCombo` (Task 2), `key.role` (Task 1).
- Produces: `getKeyAccessContext` returns `{ keyId, keyName, role, restricted, allow, coveredByPolicy, _sets }`; new `keyRoleDeniedResponse(ctx, requested)` → 403 with `error.code === "role_not_allowed"`.

- [ ] **Step 1: Write the failing role test**

```js
// tests/unit/key-role-gate.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "fast-fallback", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a", "openai/model-b"] },
    { id: "c2", name: "internal-only", visibility: "private", publicName: null, models: ["openai/model-c"] },
  ],
  nodes: [],
  aliases: {},
  keys: {},
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.aliases,
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) => fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => fx.nodes,
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null }));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const engine = await import("../../src/sse/services/keyAccess.js");

const req = (k) => new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${k}` },
});
const ctxFor = (k) => engine.getKeyAccessContext(req(k));
const gate = async (k, model) => engine.enforceKeyAccess(await ctxFor(k), model);
const status = async (k, model) => { const r = await gate(k, model); return r ? r.status : 200; };

beforeEach(() => {
  fx.keys = {};
  fx.keys["sk-owner"] = { id: "o", name: "owner-key", isActive: true, role: "owner", access: { restricted: false, allow: [] } };
  fx.keys["sk-user"] = { id: "u", name: "user-key", isActive: true, role: "user", access: { restricted: false, allow: [] } };
  fx.keys["sk-user-restricted"] = { id: "ur", name: "user-restricted", isActive: true, role: "user", access: { restricted: true, allow: ["GPT-Fast"] } };
  fx.keys["sk-legacy"] = { id: "l", name: "legacy", isActive: true, access: { restricted: false, allow: [] } };
});

describe("api key role gate", () => {
  it("treats a key without the role column as owner", async () => {
    expect(await ctxFor("sk-legacy")).toBeNull();
    expect(await status("sk-legacy", "openai/model-a")).toBe(200);
    expect(await status("sk-legacy", "internal-only")).toBe(200);
  });

  it("owner keeps every path open", async () => {
    expect(await status("sk-owner", "gpt-fast")).toBe(200);
    expect(await status("sk-owner", "internal-only")).toBe(200);
    expect(await status("sk-owner", "openai/model-a")).toBe(200);
  });

  it("user may call a published custom model-id", async () => {
    expect(await status("sk-user", "gpt-fast")).toBe(200);
  });

  it("user is denied direct providers, private combos and unknown bare names", async () => {
    expect(await status("sk-user", "openai/model-a")).toBe(403);
    expect(await status("sk-user", "internal-only")).toBe(403);
    expect(await status("sk-user", "whatever")).toBe(403);
  });

  it("reports role denials with a stable code and no internal detail", async () => {
    const response = await gate("sk-user", "openai/model-a");
    const body = await response.json();
    expect(body.error.code).toBe("role_not_allowed");
    expect(body.error.message).toContain("openai/model-a");
    expect(body.error.message).not.toContain("user-key");
    expect(body.error.message).not.toContain("gpt-fast");
  });

  it("stacks the allow list inside the role, case-insensitively", async () => {
    expect(await status("sk-user-restricted", "gpt-fast")).toBe(200);
    expect(await status("sk-user-restricted", "internal-only")).toBe(403);
  });

  it("denies provider-as-model and resolved endpoints for a user key", async () => {
    const ctx = await ctxFor("sk-user");
    expect((await engine.enforceKeyAccessProvider(ctx, "tavily", null))?.status).toBe(403);
    expect((await engine.enforceKeyAccessResolved(ctx, "openai/model-a", "openai", "model-a"))?.status).toBe(403);
  });

  it("keeps server-injected adapter models for an authorized user target", async () => {
    const ctx = await ctxFor("sk-user");
    const augmented = ["gpt-fast", "openai/vision-model"];
    expect(await engine.filterAdapterModels(ctx, augmented, ["gpt-fast"])).toEqual(augmented);
  });

  it("lists only published custom model-ids for a user key", async () => {
    const ctx = await ctxFor("sk-user");
    const list = [
      { id: "gpt-fast", owned_by: "combo" },
      { id: "internal-only", owned_by: "combo" },
      { id: "openai/model-a", owned_by: "openai" },
    ];
    expect((await engine.filterModelsListForKey(ctx, list)).map((m) => m.id)).toEqual(["gpt-fast"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/key-role-gate.test.js`
Expected: FAIL — a user key passes provider calls (no role concept yet).

- [ ] **Step 3: Import the resolver**

In `src/sse/services/keyAccess.js`, change the model import to:

```js
import { resolveModelInfo, getComboModels, resolvePublicCombo } from "./model.js";
```

and add, below the existing `canonicalModel` helper:

```js
const ROLE_OWNER = "owner";
const ROLE_USER = "user";

/** owner unless the row explicitly says user — a missing column means legacy. */
function roleOf(record) {
  return record?.role === ROLE_USER ? ROLE_USER : ROLE_OWNER;
}
```

- [ ] **Step 4: Return role and the policy-coverage flag from the context**

Replace `getKeyAccessContext` with:

```js
export async function getKeyAccessContext(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const record = await getApiKeyByKey(apiKey);
  if (!record) return null;
  const role = roleOf(record);
  const restricted = Boolean(record.access?.restricted);
  // Fully unrestricted owner is today's passthrough: no context, no gate at all.
  if (role === ROLE_OWNER && !restricted) return null;
  return {
    keyId: record.id,
    keyName: record.name || record.id,
    role,
    restricted,
    allow: record.access?.allow || [],
    // A user key's allow list is not a model allowlist; policy model checks must
    // skip it, or an empty allowedModels would veto a valid published call.
    coveredByPolicy: role === ROLE_OWNER,
    _sets: null,
  };
}
```

- [ ] **Step 5: Add the role denial response**

In `src/shared/constants/keyAccess.js`:

```js
// Role denials name only the target the client itself sent.
export function keyRoleDeniedMessage(requested) {
  return `This API key may only call published model ids; "${requested}" is not one of them.`;
}
```

In `src/sse/services/keyAccess.js`, import it next to `keyAccessDeniedMessage` and add:

```js
export function keyRoleDeniedResponse(ctx, requested) {
  log.warn("AUTH", `key-role: key "${ctx.keyName}" (${ctx.role}) denied "${requested}"`);
  // Built locally rather than through errorResponse(): the shared helper does not
  // carry an error code, and clients need a stable `role_not_allowed` to branch on.
  const body = {
    error: {
      message: keyRoleDeniedMessage(requested),
      type: "invalid_request_error",
      code: "role_not_allowed",
    },
  };
  return new Response(JSON.stringify(body), {
    status: HTTP_STATUS.FORBIDDEN,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
```

- [ ] **Step 6: Add the user-target predicate**

```js
// A user key is allowed exactly one shape: a published bare name, optionally
// narrowed by its own allow list.
async function isUserTargetAllowed(ctx, requested) {
  if (typeof requested !== "string" || !requested || requested.includes("/")) return false;
  const published = await resolvePublicCombo(requested);
  if (!published) return false;
  if (!ctx.restricted) return true;
  const name = lower(published.publicName || published.name);
  return ctx.allow.some((entry) => lower(entry) === name);
}
```

- [ ] **Step 7: Skip policy model checks for a user key**

In `src/lib/apiKeyPolicy/context.js`:

```js
export function assertCurrentModelAllowed(requested, info = {}) {
  const context = getApiKeyPolicyContext();
  if (!context) return;
  // Role-gated user keys are authorized by their published-name gate; their
  // allow list is not a model allowlist, so the owner-oriented policy check
  // must not run. Owner keys keep the existing behaviour.
  if (context.keyRole === "user") { context.resolvedModel = info; return; }
  ...
```

and in `gateway.js`, where the policy context object is created, add the role:

```js
    context = { ...admission, policy: key, keyRole: key.role === "user" ? "user" : "owner", requestedModel, isCombo, resolvedModel: info, pending: new Set(), accounted: false };
```

- [ ] **Step 8: Teach the allow-set resolver about public names (owner path)**

In `getAllowSets`, resolve published names before the internal-combo branch:

```js
  for (const entry of ctx.allow) {
    const key = lower(entry);
    const published = await resolvePublicCombo(entry);
    if (published) {
      combos.add(key);
      combos.add(lower(published.name));
      continue;
    }
    if (comboNames.has(key)) { ... }
```

and in `isModelStringAllowed`, before `resolveModelInfo`:

```js
  if (await resolvePublicCombo(requested)) return true;
```

- [ ] **Step 9: Apply the role rules in every gate**

`enforceKeyAccess` — insert after the string check:

```js
  if (ctx.role === ROLE_USER) {
    return (await isUserTargetAllowed(ctx, requested)) ? null : keyRoleDeniedResponse(ctx, requested);
  }
```

`enforceKeyAccessResolved` — insert as the first statement after the null check:

```js
  if (ctx.role === ROLE_USER) return keyRoleDeniedResponse(ctx, requested || `${provider}/${model ?? ""}`);
```

`enforceKeyAccessProvider` — insert after the null check:

```js
  if (ctx.role === ROLE_USER) return keyRoleDeniedResponse(ctx, String(requested ?? ""));
```

`filterAdapterModels` — insert after the array check:

```js
  // Adapter models are server-injected for an already-authorized target; they are
  // not client-chosen, so the role gate must not turn a healthy published combo
  // into a failure. Nested-combo members follow the same principle.
  if (ctx.role === ROLE_USER) return augmented;
```

`filterModelsListForKey` — insert before the loop:

```js
  if (ctx.role === ROLE_USER) {
    const out = [];
    for (const entry of list) {
      if (!entry?.id || !(await resolvePublicCombo(entry.id))) continue;
      out.push(entry);
    }
    return out;
  }
```

- [ ] **Step 10: Run the role test and the existing key-access suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/key-role-gate.test.js unit/key-access.test.js unit/key-access-controls.test.js unit/key-access-handlers.test.js
```
Expected: PASS (4 files).

- [ ] **Step 11: Commit**

```bash
git add src/sse/services/keyAccess.js src/lib/apiKeyPolicy/context.js src/lib/apiKeyPolicy/gateway.js \
  src/shared/constants/keyAccess.js tests/unit/key-role-gate.test.js
git commit -m "feat(auth): restrict user-role api keys to published custom model-ids"
```

---

### Task 4: Combo publication API validation

**Files:**
- Create: `src/shared/utils/publicModelId.js`
- Modify: `src/app/api/combos/route.js`
- Modify: `src/app/api/combos/[id]/route.js`
- Test: `tests/unit/custom-model-id-validation.test.js`

**Interfaces:**
- Consumes: `getCombos`, `getProviderNodes`, `AI_PROVIDERS`.
- Produces: `validatePublication({ visibility, publicName, models }, { combos, nodes, selfId })` throwing `Error` with a client-safe message.

- [ ] **Step 1: Write the failing validation test**

```js
// tests/unit/custom-model-id-validation.test.js
import { describe, it, expect } from "vitest";
import { validatePublication } from "@/shared/utils/publicModelId.js";

const combos = [
  { id: "c1", name: "Main", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] },
  { id: "c2", name: "other", visibility: "private", publicName: null, models: ["openai/model-b"] },
];
const nodes = [{ id: "openai-compatible-chat-n1", prefix: "mock" }];

const run = (input, extra = {}) =>
  validatePublication(input, { combos, nodes, selfId: null, ...extra });

describe("custom model-id publication validation", () => {
  it("accepts a well-formed public name", () => {
    expect(run({ visibility: "public", publicName: "gpt-fast", models: ["openai/model-c"] })).toEqual({
      visibility: "public", publicName: "gpt-fast",
    });
  });

  it("accepts private combos with no public name", () => {
    expect(run({ visibility: "private", publicName: null, models: [] })).toEqual({
      visibility: "private", publicName: null,
    });
  });

  it("rejects publishing a combo with no members", () => {
    expect(() => run({ visibility: "public", publicName: "empty", models: [] }))
      .toThrow(/at least one model/i);
  });

  it("rejects a name already used by another combo's public id or name", () => {
    expect(() => run({ visibility: "public", publicName: "gpt-fast", models: ["x/y"] })).toThrow(/already in use/i);
    expect(() => run({ visibility: "public", publicName: "other", models: ["x/y"] })).toThrow(/already in use/i);
  });

  it("allows a combo to keep its own name", () => {
    expect(run({ visibility: "public", publicName: "Main", models: ["x/y"] }, { selfId: "c1" }))
      .toEqual({ visibility: "public", publicName: "Main" });
  });

  it("rejects provider ids, provider aliases and node prefixes", () => {
    expect(() => run({ visibility: "public", publicName: "openai", models: ["x/y"] })).toThrow(/reserved/i);
    expect(() => run({ visibility: "public", publicName: "cx", models: ["x/y"] })).toThrow(/reserved/i);
    expect(() => run({ visibility: "public", publicName: "mock", models: ["x/y"] })).toThrow(/reserved/i);
  });

  it("rejects bad grammar and overlong names", () => {
    expect(() => run({ visibility: "public", publicName: "has space", models: ["x/y"] })).toThrow(/letters, numbers/i);
    expect(() => run({ visibility: "public", publicName: "a".repeat(65), models: ["x/y"] })).toThrow(/64/);
  });

  it("rejects visibility values outside the enum", () => {
    expect(() => run({ visibility: "published", publicName: null, models: [] })).toThrow(/visibility/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/custom-model-id-validation.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

```js
// src/shared/utils/publicModelId.js
// Publication rules for Custom Model-IDs. Pure: no DB, no request objects, so the
// routes and the tests share exactly one implementation.
import { AI_PROVIDERS } from "@/shared/constants/providers.js";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
export const PUBLIC_NAME_MAX_LENGTH = 64;
export const VISIBILITY_VALUES = Object.freeze(["private", "public"]);

function reservedNames(nodes) {
  const reserved = new Set();
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.id) reserved.add(String(provider.id).toLowerCase());
    if (provider.alias) reserved.add(String(provider.alias).toLowerCase());
  }
  for (const node of nodes || []) {
    if (node?.prefix) reserved.add(String(node.prefix).toLowerCase());
  }
  return reserved;
}

/**
 * Validate and normalize a combo's publication fields.
 * @returns {{ visibility: 'private'|'public', publicName: string|null }}
 * @throws {Error} with a message safe to return to the dashboard client
 */
export function validatePublication(input, { combos = [], nodes = [], selfId = null } = {}) {
  const raw = input || {};
  const visibility = raw.visibility === undefined ? "private" : raw.visibility;
  if (!VISIBILITY_VALUES.includes(visibility)) {
    throw new Error("Visibility must be private or public.");
  }

  let publicName = raw.publicName === undefined ? null : raw.publicName;
  if (publicName === "") publicName = null;
  if (publicName !== null) {
    if (typeof publicName !== "string") throw new Error("Public model id must be a string or empty.");
    if (publicName.length > PUBLIC_NAME_MAX_LENGTH) {
      throw new Error(`Public model id must be at most ${PUBLIC_NAME_MAX_LENGTH} characters.`);
    }
    if (!VALID_NAME_REGEX.test(publicName)) {
      throw new Error("Public model id can only contain letters, numbers, -, _ and .");
    }
  }

  if (visibility === "public") {
    const models = Array.isArray(raw.models) ? raw.models : [];
    if (models.length === 0) {
      throw new Error("A published model id needs at least one model in its combo.");
    }
  }

  const effective = publicName || (typeof raw.name === "string" ? raw.name : null);
  if (effective) {
    const key = effective.toLowerCase();
    if (reservedNames(nodes).has(key)) {
      throw new Error(`"${effective}" is a reserved provider name or node prefix.`);
    }
    for (const combo of combos) {
      if (combo.id === selfId) continue;
      const otherPublic = (combo.publicName || combo.name || "").toLowerCase();
      if (otherPublic === key) throw new Error(`"${effective}" is already in use by another combo.`);
      if (combo.visibility === "public" && (combo.name || "").toLowerCase() === key) {
        throw new Error(`"${effective}" is already in use by another combo.`);
      }
    }
  }

  return { visibility, publicName };
}
```

- [ ] **Step 4: Apply it in `POST /api/combos`**

After the existing name checks:

```js
    const combos = await getCombos();
    const nodes = await getProviderNodes();
    let publication;
    try {
      publication = validatePublication({ ...body, name }, { combos, nodes });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
```

and pass it through:

```js
    const combo = await createCombo({ name, models: models || [], kind: kind || null, ...promptSettings, ...publication });
```

with imports:

```js
import { getCombos, createCombo, getComboByName, getProviderNodes } from "@/lib/localDb";
import { validatePublication } from "@/shared/utils/publicModelId";
```

- [ ] **Step 5: Apply it in `PUT /api/combos/[id]`**

After the rename check, before `updateCombo`:

```js
    const [combos, nodes] = await Promise.all([getCombos(), getProviderNodes()]);
    let publication = {};
    if (body.visibility !== undefined || body.publicName !== undefined) {
      const current = await getComboById(id);
      if (!current) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
      try {
        publication = validatePublication(
          { ...body, name: body.name ?? current.name, models: body.models ?? current.models },
          { combos, nodes, selfId: id }
        );
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    const combo = await updateCombo(id, { ...body, ...publication });
```

- [ ] **Step 6: Run the validation and combo suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/custom-model-id-validation.test.js unit/combo-prompt-settings.test.js unit/combo-presets.test.js
```
Expected: PASS (3 files).

- [ ] **Step 7: Commit**

```bash
git add src/shared/utils/publicModelId.js src/app/api/combos/route.js "src/app/api/combos/[id]/route.js" tests/unit/custom-model-id-validation.test.js
git commit -m "feat(api): validate custom model-id publication"
```

---

### Task 5: Key role API

**Files:**
- Modify: `src/lib/apiKeyPolicy/settings.js` (`validateKeySettings`, `DEFAULT_KEY_POLICY`)
- Modify: `src/app/api/keys/route.js` (create accepts role)
- Test: `tests/unit/key-role-api.test.js`

**Interfaces:**
- Consumes: `createApiKey(name, machineId, role)` and `updateApiKey` role pass-through (Task 1).
- Produces: `role` accepted by `validateKeySettings`; `POST /api/keys` honours an explicit role, defaults to `owner`.

- [ ] **Step 1: Write the failing API test**

```js
// tests/unit/key-role-api.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateKeySettings } from "@/lib/apiKeyPolicy/settings.js";

const created = vi.hoisted(() => ({ args: null }));
vi.mock("@/lib/localDb", () => ({
  getApiKeys: async () => [],
  createApiKey: async (name, machineId, role) => {
    created.args = { name, machineId, role };
    return { id: "k-new", name, key: "sk-abc", machineId, role };
  },
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "machine-1" }));
vi.mock("@/lib/apiKeyPolicy/dashboardAuth.js", () => ({ canManageApiKeys: async () => true }));

const { POST } = await import("../../src/app/api/keys/route.js");

const request = (body) => new Request("http://localhost/api/keys", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => { created.args = null; });

describe("api key role input", () => {
  it("accepts owner and user", () => {
    expect(validateKeySettings({ role: "owner" })).toEqual({ role: "owner" });
    expect(validateKeySettings({ role: "user" })).toEqual({ role: "user" });
  });

  it("rejects any other role", () => {
    expect(() => validateKeySettings({ role: "admin" })).toThrow(/role/i);
  });

  it("defaults a creation without role to owner", async () => {
    const res = await POST(request({ name: "friend" }));
    expect(res.status).toBe(201);
    expect(created.args).toEqual({ name: "friend", machineId: "machine-1", role: "owner" });
  });

  it("creates a user key when asked explicitly", async () => {
    const res = await POST(request({ name: "friend", role: "user" }));
    expect(res.status).toBe(201);
    expect(created.args.role).toBe("user");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/key-role-api.test.js`
Expected: FAIL — `Unknown setting: role`.

- [ ] **Step 3: Accept `role` in `validateKeySettings`**

In `src/lib/apiKeyPolicy/settings.js`:

```js
export const KEY_ROLES = Object.freeze(["owner", "user"]);
```

```js
  const allowedFields = new Set([...Object.keys(DEFAULT_KEY_POLICY), "name", "isActive", "role"]);
```

```js
    } else if (field === "isActive") {
      if (typeof value !== "boolean") throw new Error("isActive must be a boolean.");
      result[field] = value;
    } else if (field === "role") {
      if (!KEY_ROLES.includes(value)) throw new Error("Role must be owner or user.");
      result[field] = value;
    }
```

Do **not** add `role` to `DEFAULT_KEY_POLICY`: that object is spread into every
existing key's policy and would change stored JSON for keys that never chose a role.

- [ ] **Step 4: Honour it in `POST /api/keys`**

```js
    const body = await request.json();
    const { name, role } = body;
    ...
    try { validateKeySettings(role === undefined ? { name } : { name, role }); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, role || "owner");
```

and include `role: apiKey.role` in the JSON response.

- [ ] **Step 5: Run the API and settings suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/key-role-api.test.js unit/api-key-settings-route.test.js
```
Expected: PASS (2 files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/apiKeyPolicy/settings.js src/app/api/keys/route.js tests/unit/key-role-api.test.js
git commit -m "feat(keys): accept an explicit owner/user role"
```

---

### Task 6: Gate `count_tokens`

**Files:**
- Modify: `src/app/api/v1/messages/count_tokens/route.js`
- Test: `tests/unit/count-tokens-role.test.js`

**Interfaces:**
- Consumes: `getKeyAccessContext`, `enforceKeyAccess` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/count-tokens-role.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({ combos: [], keys: {} }));

// This test is about the key-access gate, so the quota/policy wrapper is a
// passthrough: its own behaviour is covered by the api-key policy suites.
vi.mock("@/lib/apiKeyPolicy/gateway.js", () => ({
  withApiKeyPolicy: (request, handler) => handler(request),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) => fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => [],
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null }));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const { POST } = await import("../../src/app/api/v1/messages/count_tokens/route.js");

beforeEach(() => {
  fx.keys = { "sk-user": { id: "u", name: "user", isActive: true, role: "user", access: { restricted: false, allow: [] } } };
  fx.combos = [{ id: "c1", name: "fast", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] }];
});

const post = (model, key) => POST(new Request("http://localhost/v1/messages/count_tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "hello world" }] }),
}));

describe("count_tokens honours key roles", () => {
  it("answers for a published custom model-id", async () => {
    const res = await post("gpt-fast", "sk-user");
    expect(res.status).toBe(200);
    expect((await res.json()).input_tokens).toBe(3);
  });

  it("denies a provider model for a user key without contacting an upstream", async () => {
    const res = await post("openai/model-a", "sk-user");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_not_allowed");
  });

  it("leaves anonymous and owner calls as they are", async () => {
    expect((await post("openai/model-a")).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/count-tokens-role.test.js`
Expected: FAIL — user key gets 200 for a provider model.

- [ ] **Step 3: Add the gate**

In `countTokens`, immediately after the body parse succeeds:

```js
  const keyAccessDenied = await enforceKeyAccess(await getKeyAccessContext(request), body?.model);
  if (keyAccessDenied) return keyAccessDenied;
```

Imports:

```js
import { getKeyAccessContext, enforceKeyAccess } from "@/sse/services/keyAccess.js";
```

`enforceKeyAccess(null, ...)` returns `null`, so anonymous/owner traffic is unchanged.

- [ ] **Step 4: Run both count_tokens suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/count-tokens-role.test.js unit/count-tokens.test.js
```
Expected: PASS (2 files).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/messages/count_tokens/route.js tests/unit/count-tokens-role.test.js
git commit -m "fix(count-tokens): apply the api key role gate"
```

---

### Task 7: Discovery — `/v1/models` for user keys

**Files:**
- Modify: `src/app/api/v1/models/route.js`
- Test: `tests/unit/v1-models-custom-model-id.test.js`

**Interfaces:**
- Consumes: `filterModelsListForKey` with role handling (Task 3), `getCombos` rows carrying `visibility`/`publicName`.
- Produces: combo entries publish their effective public id.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/v1-models-custom-model-id.test.js
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("custom model-id in the public catalog", () => {
  it("lists a published combo under its publicName", async () => {
    db.getCombos.mockResolvedValue([
      { id: "c1", name: "fast-fallback", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"], kind: null },
    ]);
    const list = await buildModelsList(["llm"]);
    const ids = list.filter((m) => m.owned_by === "combo").map((m) => m.id);
    expect(ids).toContain("gpt-fast");
    expect(ids).not.toContain("fast-fallback");
  });

  it("lists a published combo by its own name when publicName is null", async () => {
    db.getCombos.mockResolvedValue([
      { id: "c2", name: "named-combo", visibility: "public", publicName: null, models: ["openai/model-b"], kind: null },
    ]);
    const ids = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "combo").map((m) => m.id);
    expect(ids).toContain("named-combo");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/v1-models-custom-model-id.test.js`
Expected: FAIL — the list contains `fast-fallback`, not `gpt-fast`.

- [ ] **Step 3: Publish the effective id**

In the combo loop of `buildModelsList`:

```js
    const entry = {
      id: combo.publicName || combo.name,
      object: "model",
      owned_by: "combo",
    };
```

Nothing else changes: a private combo stays listed for owner/unrestricted
callers exactly as today (combo listing is not filtered by visibility — the
role gate does the filtering), so this step only changes the printed id.

- [ ] **Step 4: Run the catalog suites**

Run:
```
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/v1-models-custom-model-id.test.js unit/v1-models-combo-context.test.js unit/v1-models-available.test.js
```
Expected: PASS (3 files).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/models/route.js tests/unit/v1-models-custom-model-id.test.js
git commit -m "feat(models): publish combos under their custom model-id"
```

---

### Task 8: Combos page — table, search, actions, publication

**Files:**
- Modify: `src/app/(dashboard)/dashboard/combos/page.js`
- Modify: `src/app/(dashboard)/dashboard/combos/combos.module.css`
- Modify: `src/shared/components/Sidebar.js`
- Test: `tests/unit/combos-table-page.test.js`

**Interfaces:**
- Consumes: `GET /api/combos` returning `visibility`/`publicName` (Task 1/4), `PUT /api/combos/[id]`.
- Produces: no exports; the page renders one table with per-row actions.

**Important:** this task is UI-only. It must not change `handleCreate`,
`handleUpdate`, `handleDelete`, the bulk handlers, or the modals — they keep
working against the same endpoints.

- [ ] **Step 1: Write the failing page test**

```js
// tests/unit/combos-table-page.test.js
// Static contract test: the page must expose search/filter state and per-row
// actions instead of a bare scrolling list.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(path.join(root, "src/app/(dashboard)/dashboard/combos/page.js"), "utf8");
const css = readFileSync(path.join(root, "src/app/(dashboard)/dashboard/combos/combos.module.css"), "utf8");

describe("combos page table layout", () => {
  it("renders a searchable, filterable table instead of a plain list", () => {
    expect(page).toContain('aria-label="Search combos"');
    expect(page).toContain("<table");
    expect(page).toContain("styles.modelTable");
  });

  it("keeps the create/edit/settings/limits actions per row", () => {
    for (const label of ["Edit ", "Settings ", "Limits ", "Delete "]) {
      expect(page).toContain(label);
    }
  });

  it("exposes the publication control", () => {
    expect(page).toContain('aria-label="Visibility"');
    expect(page).toContain("visibility");
    expect(page).toContain("publicName");
  });

  it("moves the vision adapter into its own tab", () => {
    expect(page).toContain("SegmentedControl");
    expect(css).toContain(".modelTable");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/combos-table-page.test.js`
Expected: FAIL — no `Search combos`, no `<table>` in the page.

- [ ] **Step 3: Add the table styles**

Append to `combos.module.css` (tokens only — no new colors):

```css
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbarSearch {
  flex: 1 1 220px;
  min-width: 0;
}

.modelTableWrap {
  overflow-x: auto;
  min-width: 0;
  max-width: 100%;
}

.modelTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  text-align: left;
  font-size: 12px;
}

.modelTable th {
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 10px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line-2);
}

.modelTable td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.modelTable tbody tr:last-child td {
  border-bottom: 0;
}

.publicName {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}

.internalName {
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11px;
}

.actionsCell {
  text-align: right;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .modelTable thead {
    display: none;
  }
  .modelTable,
  .modelTable tbody,
  .modelTable tr,
  .modelTable td {
    display: block;
    width: 100%;
  }
  .modelTable tr {
    border-bottom: 1px solid var(--line);
    padding: 12px 0;
  }
  .modelTable td {
    border-bottom: 0;
    padding: 4px 0;
  }
  .actionsCell {
    text-align: left;
  }
}
```

- [ ] **Step 4: Convert the list section into a table**

In `page.js`, extend the existing component import line (it already imports `Card`,
`Button`, `Modal`, `Input`, `Skeleton`, `ModelSelectModal`, `ConfirmModal`,
`CapacityBadges`, `Select`, `Toggle`) with `SegmentedControl`; do not add a second
import statement.

Add state next to the existing `useState` calls:

```js
  const [activeTab, setActiveTab] = useState("models");
  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
```

Add the derived rows above the `return` (after `someSelected`/`allSelected` are defined):

```js
  const publicIdOf = (combo) => combo.publicName || combo.name;
  const visibleCombos = combos.filter((combo) => {
    if (visibilityFilter && combo.visibility !== visibilityFilter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return publicIdOf(combo).toLowerCase().includes(needle)
      || combo.name.toLowerCase().includes(needle)
      || combo.models.some((model) => model.toLowerCase().includes(needle));
  });
```

Replace the whole `aria-labelledby="combo-list-heading"` `<section>` — and delete the
separate Vision Adapter `<section>` that followed it (it moves into the tab branch):

```jsx
      <SegmentedControl
        options={[
          { value: "models", label: "Models" },
          { value: "adapter", label: "Vision Adapter" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        aria-label="Combos view"
      />

      {activeTab === "adapter" ? (
        <section className={`ui-card ${styles.panel}`} aria-labelledby="capacity-adapter-heading">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="capacity-adapter-heading" className="ui-eyebrow flex items-center gap-2">
                <Icon className="text-[16px]">visibility</Icon> Vision Adapter
              </h2>
              <p className={styles.sectionDescription}>
                Your model doesn&apos;t read image/audio? It switches to a model in the pool below.
              </p>
            </div>
          </div>
          <CapacityAdapterSection
            capacityAdapter={capacityAdapter}
            onChange={handleSetCapacityAdapter}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        </section>
      ) : (
        <section className={`ui-card ${styles.panel}`} aria-labelledby="combo-list-heading">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="combo-list-heading" className="ui-eyebrow flex items-center gap-2">
                <Icon className="text-[16px]">layers</Icon> Combos
              </h2>
            </div>
            <Button variant="contrast" size="sm" icon="add" onClick={() => setShowCreateModal(true)}>
              Create
            </Button>
          </div>

          <div className={styles.toolbar}>
            <Input
              aria-label="Search combos"
              placeholder="Search model id, combo name or member…"
              icon="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={styles.toolbarSearch}
            />
            <Select
              aria-label="Visibility"
              value={visibilityFilter}
              options={[
                { value: "", label: "All visibility" },
                { value: "public", label: "Public" },
                { value: "private", label: "Private" },
              ]}
              onChange={(event) => setVisibilityFilter(event.target.value)}
            />
            {someSelected && (
              <Button size="sm" variant="danger" icon="delete" loading={bulkBusy} onClick={handleBulkDelete}>
                Delete ({selectedIds.length})
              </Button>
            )}
          </div>

          {visibleCombos.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{combos.length ? "No matching combos" : "No combos yet"}</p>
              <p>
                {combos.length
                  ? "Try another search or filter."
                  : "Create a combo to route requests through your selected models."}
              </p>
            </div>
          ) : (
            <div className={styles.modelTableWrap}>
              <table className={styles.modelTable} aria-label="Combos">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleSelectAll}
                        aria-label="Select all combos"
                      />
                    </th>
                    <th scope="col">Model</th>
                    <th scope="col">Members</th>
                    <th scope="col">Strategy</th>
                    <th scope="col">Visibility</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCombos.map((combo) => (
                    <ComboTableRow
                      key={combo.id}
                      combo={combo}
                      getCaps={getCaps}
                      comboByName={Object.fromEntries(combos.map((c) => [c.name, c.models]))}
                      copied={copied}
                      onCopy={copy}
                      onEdit={() => setEditingCombo(combo)}
                      onSettings={() => setSettingsCombo(combo)}
                      onEditLimits={() => setLimitsCombo(combo)}
                      onDelete={() => handleDelete(combo.id)}
                      strategy={comboStrategies[combo.name] || {}}
                      onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                      selected={selectedIds.includes(combo.id)}
                      onToggleSelect={() => toggleSelect(combo.id)}
                      onToggleVisibility={handleToggleVisibility}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
```

Keep the `Empty` branch's Create button reachable: the header `Create` button above
already covers it, so the old in-empty `<Button>` is dropped.

- [ ] **Step 5: Add the publish handler**

Next to `handleUpdate`:

```js
  const handleToggleVisibility = async (combo) => {
    const nextVisibility = combo.visibility === "public" ? "private" : "public";
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const updated = await res.json();
      if (!res.ok) {
        alert(updated.error || "Failed to update visibility");
        return;
      }
      setCombos((previous) => previous.map((c) => (c.id === updated.id ? updated : c)));
    } catch (error) {
      console.log("Error updating visibility:", error);
    }
  };
```

- [ ] **Step 6: Add `ComboTableRow`**

Keep the existing `ComboRow` for members/capability aggregation logic, but render the
new row as table cells. `useCopyToClipboard().copy` takes `(text, id)`, and the row
actions reuse the existing `styles.iconAction` buttons — not `Button`, whose `icon`
prop renders an icon-only button without an accessible name.

```jsx
function ComboTableRow({
  combo, getCaps, comboByName = {}, copied, onCopy, onEdit, onSettings,
  onEditLimits, onDelete, strategy = {}, onSetStrategy, selected = false,
  onToggleSelect, onToggleVisibility,
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const comboCaps = aggregateComboCapabilities(combo.models, comboByName, getCaps);
  const publicId = combo.publicName || combo.name;
  const copyKey = `combo-${combo.id}`;

  return (
    <tr className={selected ? styles.selected : undefined}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${publicId}`}
        />
      </td>
      <td>
        <code className={styles.publicName}>{publicId}</code>
        {combo.publicName && combo.publicName !== combo.name ? (
          <div className={styles.internalName}>{combo.name}</div>
        ) : null}
        {comboCaps && <CapacityBadges caps={comboCaps} colorOverride="text-text-muted" size={14} />}
      </td>
      <td>
        <div className={styles.modelList}>
          {combo.models.slice(0, 3).map((model, index) => (
            <code key={`${model}-${index}`} className={styles.modelChip} title={model}>
              {index > 0 && <span className={styles.chainSeparator} aria-hidden="true">{isFusion ? "+" : "→"}</span>}
              <span>{model}</span>
            </code>
          ))}
          {combo.models.length > 3 && (
            <span className="text-[11px] text-text-muted">+{combo.models.length - 3} more</span>
          )}
        </div>
      </td>
      <td>
        <div className={styles.strategySelect}>
          <Select
            options={STRATEGY_OPTIONS}
            value={current}
            aria-label={`Routing strategy for ${publicId}`}
            onChange={(event) => onSetStrategy({ fallbackStrategy: event.target.value })}
            selectClassName="py-1.5 text-xs"
          />
        </div>
        {isFusion && (
          <button
            type="button"
            onClick={() => setShowJudgeSelect(true)}
            className={styles.judgeButton}
            title="Pick the model that fuses panel answers"
          >
            <Icon className="shrink-0 text-[14px]">gavel</Icon>
            <span>{judge || `Auto - ${combo.models[0] || "first model"}`}</span>
          </button>
        )}
      </td>
      <td>
        <Toggle
          checked={combo.visibility === "public"}
          onChange={() => onToggleVisibility(combo)}
          aria-label={`Visibility for ${publicId}`}
        />
        <div className={styles.internalName}>{combo.visibility === "public" ? "Public" : "Private"}</div>
      </td>
      <td className="u-tnum">{new Date(combo.updatedAt).toLocaleDateString()}</td>
      <td className={styles.actionsCell}>
        <button
          type="button"
          onClick={onSettings}
          className={styles.iconAction}
          title="Combo Settings"
          aria-label={`Settings ${publicId}`}
        >
          <Icon className="text-[16px]">settings</Icon>
        </button>
        <button
          type="button"
          onClick={() => onCopy(publicId, copyKey)}
          className={styles.iconAction}
          title="Copy model id"
          aria-label={`Copy ${publicId}`}
        >
          <Icon className={`text-[16px] ${copied === copyKey ? styles.success : ""}`}>
            {copied === copyKey ? "check" : "content_copy"}
          </Icon>
        </button>
        <button
          type="button"
          onClick={() => onEditLimits?.()}
          className={styles.iconAction}
          title="Context and output limits"
          aria-label={`Limits ${publicId}`}
        >
          <Icon className="text-[16px]">data_usage</Icon>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className={styles.iconAction}
          title="Edit"
          aria-label={`Edit ${publicId}`}
        >
          <Icon className="text-[16px]">edit</Icon>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${styles.iconAction} ${styles.dangerAction}`}
          title="Delete"
          aria-label={`Delete ${publicId}`}
        >
          <Icon className="text-[16px]">delete</Icon>
        </button>
      </td>
      {isFusion && showJudgeSelect && (
        <td hidden>
          <ModelSelectModal
            isOpen={showJudgeSelect}
            onClose={() => setShowJudgeSelect(false)}
            onSelect={(model) => { onSetStrategy({ judgeModel: model }); setShowJudgeSelect(false); }}
            activeProviders={[]}
          />
        </td>
      )}
    </tr>
  );
}
```

The `<td hidden>` wrapper is required because a `<tr>` may only contain `<td>`; the
modal stays outside the visible layout. Never place a `<Modal>`/`<div>` directly
under `<tr>` — React will warn and the table layout will break.

Icon keys verified present in `Icon.js`: `settings`, `content_copy`, `check`,
`data_usage`, `edit`, `delete`, `gavel`. There is no `tune` key (unknown names fall
back to `HelpCircle`), so limits uses `data_usage`.

- [ ] **Step 7: Rename the sidebar label**

`src/shared/components/Sidebar.js`:

```js
      { href: "/dashboard/combos", label: "Combos & Custom Model-IDs", icon: "layers" },
```

- [ ] **Step 8: Run the page test, lint the touched files, and build**

```bash
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/combos-table-page.test.js unit/combos-theme.test.js
cd .. && npx eslint src/app/\(dashboard\)/dashboard/combos/page.js src/shared/components/Sidebar.js
```

Expected: tests PASS; eslint reports nothing new against the pre-change baseline
(the file already carries pre-existing `react-hooks/set-state-in-effect` findings —
compare, do not fix).

- [ ] **Step 9: Commit**

```bash
git add "src/app/(dashboard)/dashboard/combos/page.js" "src/app/(dashboard)/dashboard/combos/combos.module.css" \
  src/shared/components/Sidebar.js tests/unit/combos-table-page.test.js
git commit -m "feat(ui): combos table with search, filters and publication toggle"
```

---

### Task 9: Key role UI (create modal + settings dialog)

**Files:**
- Modify: `src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js`
- Modify: `src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js`
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- Test: `tests/unit/key-role-dialog.test.js`

**Interfaces:**
- Consumes: `POST /api/keys` and `PATCH /api/keys/[id]` role field (Task 5).
- Produces: `KeyRoleSection({ value, onChange })` exported from `ApiKeySettingsSections.js`.

**Why both files:** `ConfigureApiKeyDialog` only edits keys that already exist
(it loads `GET /api/keys/[id]`). New keys are created by the "Create API Key"
modal inside `EndpointPageClient.js`, which posts `{ name }`. Both surfaces need the
role control, and the settings save payload needs an explicit change — see Step 5.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/key-role-dialog.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const sections = read("src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js");
const dialog = read("src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js");
const page = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

describe("api key role control", () => {
  it("offers owner and user with the consequence spelled out", () => {
    expect(sections).toContain("export function KeyRoleSection");
    expect(sections).toContain("Owner");
    expect(sections).toContain("User");
    expect(sections).toContain("Custom Model-ID");
  });

  it("is mounted in the settings dialog and survives the save payload", () => {
    expect(dialog).toContain("KeyRoleSection");
    // the save payload is built from DEFAULT_KEY_POLICY keys; role must be added
    expect(dialog).toContain("settings.role");
  });

  it("is offered when creating a key, defaulting to user", () => {
    expect(page).toContain('aria-label="Key role"');
    expect(page).toContain('"user"');
    expect(page).toMatch(/role:\s*newKeyRole/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/key-role-dialog.test.js`
Expected: FAIL — `KeyRoleSection` absent.

- [ ] **Step 3: Add the section component**

In `ApiKeySettingsSections.js`:

```jsx
const KEY_ROLE_OPTIONS = [
  { value: "owner", label: "Owner", hint: "Everything: combos, provider models and custom model-ids." },
  { value: "user", label: "User", hint: "Only published Custom Model-IDs. Provider models and private combos are refused." },
];

export function KeyRoleSection({ value, onChange }) {
  return (
    <SettingsSection title="Key Role" hint="Owner keys keep full access. User keys can call published Custom Model-IDs only.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {KEY_ROLE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 cursor-pointer rounded-[var(--r2)] border p-3 transition-colors ${value === option.value ? "border-[var(--accent-line)] bg-[var(--surface-2)]" : "border-[var(--line)] hover:bg-[var(--surface-2)]"}`}
          >
            <input
              type="radio"
              name="key-role"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 accent-[var(--text)] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text)]"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block mt-1 text-xs text-[var(--text-2)]">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 4: Mount it in the settings dialog**

In `ConfigureApiKeyDialog.js`, add `KeyRoleSection` to the existing import from
`./ApiKeySettingsSections`, give `toForm` a role default, and render the section
above model restrictions:

```js
function toForm(key) {
  const form = {
    ...DEFAULT_KEY_POLICY,
    ...key,
    name: key.name || "",
    role: key.role === "user" ? "user" : "owner",
    expiresAt: localDateTime(key.expiresAt),
    allowedEndpoints: key.allowedEndpoints ?? API_KEY_ENDPOINTS.map((item) => item.value),
  };
  for (const field of numericFields) form[field] = String(form[field] ?? "");
  return form;
}
```

```jsx
          <KeyRoleSection value={form.role} onChange={(value) => change("role", value)} />
          <ModelRestrictions form={form} onChange={change} activeProviders={activeProviders} modelAliases={modelAliases} />
```

- [ ] **Step 5: Include role in the save payload**

`save()` currently builds the payload from `Object.keys(DEFAULT_KEY_POLICY)` plus
`name`, which would silently drop the role. Add it explicitly:

```js
      const settings = Object.fromEntries([...Object.keys(DEFAULT_KEY_POLICY), "name"].map((field) => [field, form[field]]));
      settings.role = form.role;
```

- [ ] **Step 6: Add the role control to the create modal**

In `EndpointPageClient.js`, add state next to `newKeyName`:

```js
  const [newKeyRole, setNewKeyRole] = useState("user");
```

Send it in `handleCreateKey`, and reset it when the modal closes:

```js
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, role: newKeyRole }),
      });
```

In both places that close the modal (`onClose` and the Cancel button) also call
`setNewKeyRole("user")`.

Render the radio pair between the name input and the buttons:

```jsx
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Key role">
            {[
              { value: "user", label: "User", hint: "Published Custom Model-IDs only" },
              { value: "owner", label: "Owner", hint: "Full access to every model and combo" },
            ].map((option) => (
              <label key={option.value} className="flex items-start gap-3 cursor-pointer rounded-[var(--r2)] border border-[var(--line)] p-3 hover:bg-[var(--surface-2)]">
                <input
                  type="radio"
                  name="new-key-role"
                  value={option.value}
                  checked={newKeyRole === option.value}
                  onChange={() => setNewKeyRole(option.value)}
                  className="mt-0.5 size-4 accent-[var(--text)] shrink-0"
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block mt-1 text-xs text-[var(--text-2)]">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
```

- [ ] **Step 7: Run the dialog tests and lint**

```bash
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run unit/key-role-dialog.test.js unit/key-role-api.test.js
cd .. && npx eslint "src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js" \
  "src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js" \
  "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"
```

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js" \
  "src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js" \
  "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js" tests/unit/key-role-dialog.test.js
git commit -m "feat(ui): key role control when creating and configuring keys"
```

---

### Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full feature test set**

```bash
cd tests && DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) TMPDIR=$(mktemp -d) npx vitest run \
  unit/custom-model-id-migration.test.js unit/custom-model-id-resolution.test.js \
  unit/custom-model-id-validation.test.js unit/key-role-gate.test.js unit/key-role-api.test.js \
  unit/key-role-dialog.test.js unit/count-tokens-role.test.js unit/v1-models-custom-model-id.test.js \
  unit/key-access.test.js unit/key-access-controls.test.js unit/key-access-handlers.test.js \
  unit/key-access-migration.test.js unit/combo-routing.test.js unit/combo-prompt-routing.test.js \
  unit/v1-models-combo-context.test.js unit/combos-table-page.test.js
```

Expected: all PASS. Record the counts.

- [ ] **Step 2: Scoped lint**

```bash
npx eslint src/sse/services/model.js src/sse/services/keyAccess.js src/sse/handlers/chat.js \
  src/lib/db/repos/combosRepo.js src/lib/db/repos/apiKeysRepo.js src/lib/db/schema.js \
  src/lib/db/migrations/004-custom-model-id.js src/lib/apiKeyPolicy/settings.js \
  src/shared/utils/publicModelId.js src/app/api/combos/route.js "src/app/api/combos/[id]/route.js" \
  src/app/api/keys/route.js src/app/api/v1/models/route.js src/app/api/v1/messages/count_tokens/route.js \
  "src/app/(dashboard)/dashboard/combos/page.js" \
  "src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js" \
  "src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js" \
  src/shared/components/Sidebar.js
```

Expected: zero new errors. Pre-existing findings (`react-hooks/set-state-in-effect` in the
combos page and endpoint components) are compared against
`git show <base>:<path> | node node_modules/eslint/bin/eslint.js --stdin --stdin-filename <path>`
and reported, not fixed.

- [ ] **Step 3: Standalone build**

```bash
HOME=$(mktemp -d) DATA_DIR=$(mktemp -d) MODEL_CATALOG_SYNC=off MODEL_HEALTH_SCHEDULER=false \
  NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

Expected: build succeeds and the route table still lists `/dashboard/combos`.

- [ ] **Step 4: Standalone smoke on port 20129**

Launch with a preload that sets `global.__appBootstrapped = true`, isolated
`HOME`/`DATA_DIR`, `MODEL_CATALOG_SYNC=off`, `MODEL_HEALTH_SCHEDULER=false`,
`DISABLE_BACKGROUND_TOKEN_REFRESH=true`, then assert with `curl`:

1. `GET /api/health` → `{"ok":true}`
2. an owner key (fixture) `POST /v1/chat/completions` with a private combo name → not 403
3. a user key calling the same private combo → 403 `role_not_allowed`
4. a user key calling a provider model → 403 `role_not_allowed`
5. a user key calling a published CMID → passes the gate (a provider credential
   may still fail; assert the error is not a policy 403)
6. `GET /v1/models` with the user key → exactly the published id

- [ ] **Step 5: Report**

Report: files changed, test counts, lint delta against baseline, build result,
smoke results 1–6, and the rollback command placeholder for the eventual release.
Do **not** deploy, commit the release, or push without explicit instruction.

---

## Self-Review Notes

Spec coverage: §3 → Task 1. §4.1 → Task 2. §4.2 → Task 3 Steps 4–9. §4.3 → Task 3 Step 9
(`filterAdapterModels`). §4.4 → Task 3 Step 7 (`coveredByPolicy` / `keyRole`). §4.5 → Task 7.
§4.6 → Task 6. §5.1 → Task 4. §5.2 → Task 5. §6.1 → Task 8. §6.2 → Task 8 Step 7.
§6.3 → Task 9. §7 → task order. §8 → per-task tests plus Task 10. §9 → Task 10 Step 5.

Corrections made during this review (each was a real defect in an earlier draft):

1. **`assertCurrentModelAllowed` vs user keys.** The policy wrapper's per-model check runs
   inside `getModelInfo` for every resolved model, including combo members. For a user key
   the authorization is the published-name gate, so that check would have vetoed valid
   calls. Fixed by the `keyRole` context field (Task 3 Step 7). This also replaces the
   spec's vaguer "skip member assertion when `context.isCombo`" wording with a mechanism
   that exists in the code.
2. **`new` keys are created in `EndpointPageClient.js`, not in the settings dialog.** The
   task earlier only touched `ConfigureApiKeyDialog`, which cannot create keys. Task 9 now
   covers both, and the settings save payload (built from `DEFAULT_KEY_POLICY` keys) must
   add `settings.role` explicitly or the choice is silently dropped.
3. **`copy` signature.** `useCopyToClipboard().copy` is `(text, id)`; the earlier row code
   treated it as `(text)`, which would have made the copied-flash key never match.
4. **Icons.** `tune` does not exist in `Icon.js` (unknown names fall back to `HelpCircle`).
   The limits action uses `data_usage`. Verified: `settings`, `content_copy`, `check`,
   `data_usage`, `edit`, `delete`, `gavel`.
5. **`<tr>` children.** A modal cannot be a direct child of `<tr>`; the judge picker is
   wrapped in `<td hidden>`.
6. **`role` must not enter `DEFAULT_KEY_POLICY`** (Task 5 Step 3): that object is spread
   into every key's stored `policy` JSON, so it would rewrite existing rows.

Remaining deliberate choices, stated so an executor does not "improve" them:

- The combos page test is a static contract test, matching the repo's existing
  `combos-theme.test.js` style. Behavioural verification of the table happens in the
  standalone smoke and the live browser gate (Task 10), not in a DOM harness.
- Private combos stay listed in `/v1/models` for owner/unrestricted callers exactly as
  today; only the printed id changes to the public name, and the role gate does the
  filtering for user keys.
- `count_tokens` denial uses the same `role_not_allowed` body as the chat path, so the
  endpoint cannot be used as an existence oracle for model names.
