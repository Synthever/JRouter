// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 5;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  modelHealthConfigs: {
    columns: {
      modelId: "TEXT PRIMARY KEY", enabled: "INTEGER NOT NULL DEFAULT 0",
      intervalSeconds: "INTEGER NOT NULL DEFAULT 300", timeoutSeconds: "INTEGER NOT NULL DEFAULT 15",
      failureThreshold: "INTEGER NOT NULL DEFAULT 3", recoveryThreshold: "INTEGER NOT NULL DEFAULT 2",
      includeInRouting: "INTEGER NOT NULL DEFAULT 1", status: "TEXT NOT NULL DEFAULT 'UNKNOWN'",
      failures: "INTEGER NOT NULL DEFAULT 0", successes: "INTEGER NOT NULL DEFAULT 0",
      lastCheckAt: "INTEGER", lastSuccessAt: "INTEGER", latestLatencyMs: "INTEGER",
      nextCheckAt: "INTEGER NOT NULL DEFAULT 0", createdAt: "INTEGER NOT NULL", updatedAt: "INTEGER NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_mhc_due ON modelHealthConfigs(enabled, nextCheckAt)"],
  },
  modelHealthChecks: {
    columns: {
      id: "TEXT PRIMARY KEY", modelId: "TEXT NOT NULL", providerId: "TEXT NOT NULL", apiKeyId: "TEXT",
      source: "TEXT NOT NULL DEFAULT 'active'", status: "TEXT NOT NULL", success: "INTEGER NOT NULL",
      latencyMs: "INTEGER", httpStatus: "INTEGER", errorType: "TEXT", errorMessage: "TEXT", checkedAt: "INTEGER NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_mh_model_time ON modelHealthChecks(modelId, source, checkedAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_mh_provider_time ON modelHealthChecks(providerId, checkedAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_mh_time ON modelHealthChecks(checkedAt)",
    ],
  },
  modelHealthLeases: {
    columns: { id: "TEXT PRIMARY KEY", owner: "TEXT NOT NULL", expiresAt: "INTEGER NOT NULL" },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_mhl_expiry ON modelHealthLeases(expiresAt)"],
  },
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      policy: "TEXT NOT NULL DEFAULT '{}'",
      quotaPeriodStartedAt: "TEXT",
      quotaTokens: "REAL NOT NULL DEFAULT 0",
      quotaCost: "REAL NOT NULL DEFAULT 0",
      lastUsedAt: "TEXT",
      updatedAt: "TEXT",
      // Existing rows stay unrestricted when additive schema sync adds these columns.
      accessRestricted: "INTEGER DEFAULT 0",
      accessAllow: "TEXT",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  apiKeyRequests: {
    columns: {
      id: "TEXT PRIMARY KEY",
      apiKeyId: "TEXT NOT NULL REFERENCES apiKeys(id) ON DELETE CASCADE",
      startedAt: "INTEGER NOT NULL",
      usageRecordedAt: "INTEGER NOT NULL DEFAULT 0",
      expiresAt: "INTEGER NOT NULL",
      quotaPeriodStartedAt: "TEXT",
      estimatedTokens: "REAL NOT NULL DEFAULT 0",
      estimatedCost: "REAL NOT NULL DEFAULT 0",
      actualTokens: "REAL NOT NULL DEFAULT 0",
      actualCost: "REAL NOT NULL DEFAULT 0",
      multiplier: "REAL NOT NULL DEFAULT 1",
      isPending: "INTEGER NOT NULL DEFAULT 1",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_akr_key_time ON apiKeyRequests(apiKeyId, startedAt)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      promptInjectionEnabled: "INTEGER NOT NULL DEFAULT 0",
      promptInjectionMode: "TEXT NOT NULL DEFAULT 'prepend'",
      systemPrompt: "TEXT",
      displayIdentity: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
