import { buildCreateTableSql, TABLES } from "../schema.js";

const migration = {
  version: 4,
  name: "models-aliases",
  up(db) {
    db.exec(buildCreateTableSql("modelsAliases", TABLES.modelsAliases));
    for (const guard of TABLES.modelsAliases.indexes) db.exec(guard);
  },
};

export default migration;
