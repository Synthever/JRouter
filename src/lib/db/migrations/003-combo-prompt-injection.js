import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 3,
  name: "combo-prompt-injection",
  up(db) {
    db.exec(buildCreateTableSql("combos", TABLES.combos));
    const existing = new Set(db.all("PRAGMA table_info(combos)").map((column) => column.name));
    for (const name of ["promptInjectionEnabled", "promptInjectionMode", "systemPrompt", "displayIdentity"]) {
      if (!existing.has(name)) db.exec(`ALTER TABLE combos ADD COLUMN ${name} ${TABLES.combos.columns[name]}`);
    }
  },
};

export default migration;
