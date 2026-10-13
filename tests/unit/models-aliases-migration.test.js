import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "@/lib/db/schema.js";
import { latestVersion } from "@/lib/db/migrations/index.js";
import migration from "@/lib/db/migrations/004-models-aliases.js";

async function fixture() {
  const db = await createNodeSqliteAdapter(":memory:");
  db.exec(buildCreateTableSql("combos", TABLES.combos));
  db.exec(buildCreateTableSql("kv", TABLES.kv));
  db.run("INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES(?,?,?,?,?)", ["combo", "Existing", '["provider/model"]', "old", "old"]);
  db.run("INSERT INTO kv VALUES('modelAliases','legacy','\"provider/model\"')");
  return db;
}
const insertAlias = (db, id, name) => db.run("INSERT INTO modelsAliases(id,name,models,primaryModel,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", [id, name, '["provider/model"]', "provider/model", "old", "old"]);

describe("additive Models Aliases migration", () => {
  it("keeps aliases across adapter restart in an isolated file DB", async () => {
    const original = process.env.DATA_DIR;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-1-alias-restart-"));
    const events = ["beforeExit", "SIGINT", "SIGTERM"];
    const listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
    try {
      process.env.DATA_DIR = directory;
      delete global._dbAdapter;
      vi.resetModules();
      const repository = await import("@/lib/db/repos/modelsAliasesRepo.js");
      const { createProviderNode } = await import("@/lib/db/repos/nodesRepo.js");
      await createProviderNode({ id: "openai-compatible-restart", type: "openai-compatible", prefix: "restart" });
      const alias = await repository.createModelsAlias({ name: "Restart/Flash", models: ["restart/Nested/Flash"], primaryModel: "restart/Nested/Flash", initialResponseTimeoutSeconds: 0.5 });
      global._dbAdapter.instance.close();
      delete global._dbAdapter;
      vi.resetModules();
      const restarted = await import("@/lib/db/repos/modelsAliasesRepo.js");
      expect(await restarted.getModelsAliasById(alias.id)).toEqual(alias);
      const db = global._dbAdapter.instance;
      expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("4");
      expect(db.get("SELECT value FROM _meta WHERE key = 'backupSchemaVersion'").value).toBe("6");
      expect(db.all("SELECT name FROM sqlite_master WHERE type = 'trigger'")).toHaveLength(4);
    } finally {
      global._dbAdapter?.instance?.close();
      delete global._dbAdapter;
      if (original === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = original;
      vi.resetModules();
      for (const event of events) for (const listener of process.listeners(event)) if (!listeners.get(event).has(listener)) process.removeListener(event, listener);
    }
  });
  it("registers version 4 and backup schema 6", () => {
    expect(migration.version).toBe(4);
    expect(latestVersion()).toBe(4);
    expect(SCHEMA_VERSION).toBe(6);
  });
  it("runs twice without editing Combos or legacy mappings and stores a REAL deadline", async () => {
    const db = await fixture();
    try {
      migration.up(db);
      insertAlias(db, "alias", "DeepSeek/Flash");
      db.run("UPDATE modelsAliases SET initialResponseTimeoutSeconds = ?", [0.5]);
      migration.up(db);
      expect(db.get("SELECT models FROM combos").models).toBe('["provider/model"]');
      expect(db.get("SELECT value FROM kv").value).toBe('"provider/model"');
      expect(db.get("SELECT * FROM modelsAliases")).toMatchObject({ primaryModel: "provider/model", strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 0.5, promptInjectionEnabled: 0, promptInjectionMode: "prepend" });
      expect(db.all("PRAGMA table_info(modelsAliases)").find((column) => column.name === "initialResponseTimeoutSeconds").type).toBe("REAL");
    } finally { db.close(); }
  });
  it("guards direct writes and renames in both entity directions", async () => {
    const db = await fixture();
    try {
      migration.up(db);
      expect(() => insertAlias(db, "bad", "Existing")).toThrow(/namespace/i);
      insertAlias(db, "alias", "Alias");
      expect(() => db.run("INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES('bad','Alias','[]','old','old')")).toThrow(/namespace/i);
      expect(() => db.run("UPDATE combos SET name = 'Alias' WHERE id = 'combo'")).toThrow(/namespace/i);
      expect(() => db.run("UPDATE modelsAliases SET name = 'Existing' WHERE id = 'alias'")).toThrow(/namespace/i);
      expect(() => insertAlias(db, "duplicate", "Alias")).toThrow();
      insertAlias(db, "case", "alias");
      expect(db.all("SELECT * FROM modelsAliases")).toHaveLength(2);
    } finally { db.close(); }
  });
});
