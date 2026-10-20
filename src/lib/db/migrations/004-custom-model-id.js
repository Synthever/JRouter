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
