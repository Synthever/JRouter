// Backup round-trip for the Custom Model-ID columns: `apiKeys.role`,
// `combos.visibility` and `combos.publicName` must survive exportDb → importDb.
// The regression this guards: the DDL declares `role TEXT NOT NULL DEFAULT
// 'owner'`, so an import that simply omits the column silently promotes every
// user key in a backup to owner — a privilege escalation on restore.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const adapterRef = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => adapterRef.db }));
import { createApiKey, getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";
import { createCombo, getCombos } from "@/lib/db/repos/combosRepo.js";
import { exportDb, importDb } from "@/lib/db/index.js";

beforeEach(async () => {
  adapterRef.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) adapterRef.db.exec(buildCreateTableSql(name, table));
});
afterEach(() => adapterRef.db.close());

describe("backup round-trip keeps key role and combo publication", () => {
  it("restores a user key as user and a public combo with its publicName", async () => {
    await createApiKey("published-user", "machine-1", "user");
    await createCombo({ name: "team/secret-combo", models: ["real/model"], visibility: "public", publicName: "team-public" });

    const payload = await exportDb();
    // exportDb dumps raw rows, so the new columns must already be in the payload.
    expect(payload.apiKeys.map((k) => k.role)).toEqual(["user"]);
    expect(payload.combos[0]).toMatchObject({ visibility: "public", publicName: "team-public" });

    await importDb(payload);

    expect((await getApiKeys()).map((k) => k.role)).toEqual(["user"]);
    expect(await getCombos()).toEqual([
      expect.objectContaining({ name: "team/secret-combo", visibility: "public", publicName: "team-public" }),
    ]);
  });

  it("restores a pre-feature backup with the safe defaults (owner / private / null)", async () => {
    // Hand-built payload shaped like a backup taken before the columns existed:
    // no role, visibility or publicName anywhere.
    const legacy = {
      settings: {},
      providerConnections: [],
      providerNodes: [],
      proxyPools: [],
      apiKeys: [{ id: "k1", key: "legacy-key", name: "Legacy", machineId: "m", isActive: true, createdAt: "2025-01-01T00:00:00.000Z", policy: {} }],
      combos: [{ id: "c1", name: "legacy-combo", kind: null, models: ["real/model"], createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }],
      modelAliases: {},
      customModels: [],
      mitmAlias: {},
      pricing: {},
      disabledModels: {},
    };

    await expect(importDb(legacy)).resolves.toBeTruthy();

    expect((await getApiKeys()).map((k) => k.role)).toEqual(["owner"]);
    expect(await getCombos()).toEqual([
      expect.objectContaining({ name: "legacy-combo", visibility: "private", publicName: null }),
    ]);
  });
});
