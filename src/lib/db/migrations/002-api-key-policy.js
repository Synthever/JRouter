import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "api-key-policy",
  up(db) {
    const existing = new Set(db.all("PRAGMA table_info(apiKeys)").map((column) => column.name));
    for (const field of ["policy", "quotaPeriodStartedAt", "quotaTokens", "quotaCost", "lastUsedAt", "updatedAt"]) {
      if (!existing.has(field)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${field} ${TABLES.apiKeys.columns[field]}`);
    }
    db.exec(buildCreateTableSql("apiKeyRequests", TABLES.apiKeyRequests));
    if (!db.all("PRAGMA table_info(apiKeyRequests)").some((column) => column.name === "usageRecordedAt")) db.exec("ALTER TABLE apiKeyRequests ADD COLUMN usageRecordedAt INTEGER NOT NULL DEFAULT 0");
    for (const index of TABLES.apiKeyRequests.indexes) db.exec(index);
  },
};

export default migration;
