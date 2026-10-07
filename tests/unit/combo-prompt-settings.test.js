import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const adapterRef = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => adapterRef.db }));
import { createCombo, updateCombo, getComboById } from "@/lib/db/repos/combosRepo.js";
import { exportDb, importDb } from "@/lib/db/index.js";
import { POST } from "@/app/api/combos/route.js";
import { PUT } from "@/app/api/combos/[id]/route.js";
import migration from "@/lib/db/migrations/003-combo-prompt-injection.js";

beforeEach(async () => {
  adapterRef.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) adapterRef.db.exec(buildCreateTableSql(name, table));
});
afterEach(() => adapterRef.db.close());
const settings = { promptInjectionEnabled: true, promptInjectionMode: "append", systemPrompt: "Line one\n{{display_name}}", displayIdentity: "Support agent" };
const request = (data) => new Request("http://localhost/api/combos", { method: "POST", body: JSON.stringify(data) });

describe("persistent combo behavior settings", () => {
  it("upgrades an existing combos table without changing models and can run twice", async () => {
    const legacy = await createNodeSqliteAdapter(":memory:");
    try {
      legacy.exec("CREATE TABLE combos(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT, models TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)");
      legacy.run("INSERT INTO combos VALUES(?, ?, ?, ?, ?, ?)", ["old", "old-combo", null, '["provider/actual"]', "2025-01-01", "2025-01-01"]);
      migration.up(legacy);
      migration.up(legacy);
      expect(legacy.get("SELECT * FROM combos WHERE id = 'old'")).toMatchObject({ models: '["provider/actual"]', promptInjectionEnabled: 0, promptInjectionMode: "prepend", systemPrompt: null, displayIdentity: null });
    } finally {
      legacy.close();
    }
  });
  it("defaults legacy and new combos to disabled", async () => {
    const combo = await createCombo({ name: "legacy", models: ["real/model"] });
    expect(await getComboById(combo.id)).toMatchObject({ promptInjectionEnabled: false, promptInjectionMode: "prepend", systemPrompt: null, displayIdentity: null });
  });
  it("persists multiline prompts and keeps behavior through unrelated model edits", async () => {
    const combo = await createCombo({ name: "support", models: ["real/model"], ...settings });
    await updateCombo(combo.id, { models: ["other/model"] });
    expect(await getComboById(combo.id)).toMatchObject({ ...settings, models: ["other/model"] });
    await updateCombo(combo.id, { systemPrompt: null, displayIdentity: null });
    expect(await getComboById(combo.id)).toMatchObject({ systemPrompt: null, displayIdentity: null });
  });
  it("round-trips behavior through backup export and restore", async () => {
    const combo = await createCombo({ name: "backup", models: ["real/model"], ...settings });
    const exported = await exportDb();
    await importDb(exported);
    expect(await getComboById(combo.id)).toMatchObject(settings);
  });
  it("accepts behavior fields on create and partial update APIs", async () => {
    const response = await POST(request({ name: "api", models: ["real/model"], ...settings }));
    expect(response.status).toBe(201);
    const combo = await response.json();
    expect(combo).toMatchObject(settings);
    const updated = await PUT(request({ promptInjectionMode: "replace" }), { params: Promise.resolve({ id: combo.id }) });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ ...settings, promptInjectionMode: "replace" });
  });
  it.each([{ promptInjectionMode: "bad" }, { promptInjectionEnabled: "yes" }, { systemPrompt: 5 }, { displayIdentity: [] }])("rejects invalid behavior on both APIs (%j)", async (invalid) => {
    expect((await POST(request({ name: "invalid", ...invalid }))).status).toBe(400);
    const combo = await createCombo({ name: "existing" });
    expect((await PUT(request(invalid), { params: Promise.resolve({ id: combo.id }) })).status).toBe(400);
    expect(await getComboById(combo.id)).toMatchObject({ promptInjectionEnabled: false });
  });
  it("returns 404 when saving a deleted combo", async () => {
    expect((await PUT(request(settings), { params: Promise.resolve({ id: "deleted" }) })).status).toBe(404);
  });
});
