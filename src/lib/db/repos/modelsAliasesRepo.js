import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { assertAliasComboNameAvailable } from "../helpers/modelsAliasesNamespace.js";
import { normalizeModelsAliasConfig } from "../../modelsAliases/config.js";
import { getAliasMembersContext, resolveAliasMembers, resolveAliasMembersFromContext } from "../../modelsAliases/members.js";

export function rowToModelsAlias(row) {
  if (!row) return null;
  return { ...row, models: parseJson(row.models, []), promptInjectionEnabled: row.promptInjectionEnabled === 1 };
}

export function insertModelsAlias(db, alias) {
  assertAliasComboNameAvailable(db, alias.name);
  db.run(
    "INSERT INTO modelsAliases(id,name,models,primaryModel,strategy,judgeModel,initialResponseTimeoutSeconds,promptInjectionEnabled,promptInjectionMode,systemPrompt,displayIdentity,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [alias.id, alias.name, stringifyJson(alias.models), alias.primaryModel, alias.strategy, alias.judgeModel, alias.initialResponseTimeoutSeconds, alias.promptInjectionEnabled ? 1 : 0, alias.promptInjectionMode, alias.systemPrompt, alias.displayIdentity, alias.createdAt, alias.updatedAt]
  );
}

export async function getModelsAliases() {
  return (await getAdapter()).all("SELECT * FROM modelsAliases ORDER BY createdAt ASC, id ASC").map(rowToModelsAlias);
}

export async function getModelsAliasById(id) {
  return rowToModelsAlias((await getAdapter()).get("SELECT * FROM modelsAliases WHERE id = ?", [id]));
}

export async function getModelsAliasByName(name) {
  return rowToModelsAlias((await getAdapter()).get("SELECT * FROM modelsAliases WHERE name = ?", [name]));
}

function assertMembersUnchanged(db, models, resolved) {
  const current = resolveAliasMembersFromContext(models, getAliasMembersContext(db));
  if (JSON.stringify(current) !== JSON.stringify(resolved)) throw new Error("Models Alias members changed during validation; retry the save");
}

export async function createModelsAlias(input) {
  const checked = normalizeModelsAliasConfig(input);
  const resolved = await resolveAliasMembers(checked.models);
  const db = await getAdapter();
  const now = new Date().toISOString();
  const alias = { id: uuidv4(), ...checked, createdAt: now, updatedAt: now };
  db.transaction(() => {
    assertMembersUnchanged(db, checked.models, resolved);
    insertModelsAlias(db, alias);
  });
  return alias;
}

export async function updateModelsAlias(id, input, { returnPreImage = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Models Alias configuration");
  input = structuredClone(input);
  const existing = await getModelsAliasById(id);
  if (!existing) return null;
  const checked = normalizeModelsAliasConfig({ ...existing, ...input });
  const resolved = await resolveAliasMembers(checked.models);
  const db = await getAdapter();
  let result = null;
  let preImage = null;
  db.transaction(() => {
    const row = rowToModelsAlias(db.get("SELECT * FROM modelsAliases WHERE id = ?", [id]));
    if (!row) return;
    preImage = row;
    const merged = normalizeModelsAliasConfig({ ...row, ...input });
    assertMembersUnchanged(db, merged.models, resolved);
    assertAliasComboNameAvailable(db, merged.name, { aliasId: id });
    db.run(
      "UPDATE modelsAliases SET name=?,models=?,primaryModel=?,strategy=?,judgeModel=?,initialResponseTimeoutSeconds=?,promptInjectionEnabled=?,promptInjectionMode=?,systemPrompt=?,displayIdentity=?,updatedAt=? WHERE id=?",
      [merged.name, stringifyJson(merged.models), merged.primaryModel, merged.strategy, merged.judgeModel, merged.initialResponseTimeoutSeconds, merged.promptInjectionEnabled ? 1 : 0, merged.promptInjectionMode, merged.systemPrompt, merged.displayIdentity, new Date().toISOString(), id]
    );
    result = rowToModelsAlias(db.get("SELECT * FROM modelsAliases WHERE id = ?", [id]));
  });
  return returnPreImage ? (result ? { preImage, alias: result } : null) : result;
}

export async function deleteModelsAlias(id) {
  return ((await getAdapter()).run("DELETE FROM modelsAliases WHERE id = ?", [id]).changes ?? 0) > 0;
}
