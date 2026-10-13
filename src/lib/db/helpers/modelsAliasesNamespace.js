export class AliasComboNameConflict extends Error {
  constructor(name) {
    super(`Models Alias or Combo name already exists: ${name}`);
    this.name = "AliasComboNameConflict";
    this.status = 409;
    this.code = "alias_combo_name_conflict";
  }
}

export function assertAliasComboNameAvailable(db, name, { aliasId = null, comboId = null } = {}) {
  const alias = db.get("SELECT id FROM modelsAliases WHERE name = ? AND (? IS NULL OR id <> ?)", [name, aliasId, aliasId]);
  const combo = db.get("SELECT id FROM combos WHERE name = ? AND (? IS NULL OR id <> ?)", [name, comboId, comboId]);
  if (alias || combo) throw new AliasComboNameConflict(name);
}
