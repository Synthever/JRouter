import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { policyDefaults, validateKeySettings } from "@/lib/apiKeyPolicy/settings.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

export function rowToKey(row) {
  if (!row) return null;
  return {
    ...policyDefaults(parseJson(row.policy, {})),
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
    quotaPeriodStartedAt: row.quotaPeriodStartedAt || null,
    quotaTokens: row.quotaTokens || 0,
    quotaCost: row.quotaCost || 0,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) validateKeySettings(data);
  const { access, ...settings } = data;
  const validated = validateKeySettings(settings);
  let validatedAccess;
  if (access !== undefined) {
    const checked = validateKeyAccessInput(access);
    if (!checked.ok) throw new Error(checked.error);
    validatedAccess = checked.value;
  }
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const { name, isActive, ...policyChanges } = validated;
    const policy = { ...parseJson(row.policy, {}), ...policyChanges };
    const updatedAt = new Date().toISOString();
    const cols = keyAccessToColumns(validatedAccess ?? rowToKey(row).access);
    db.run(
      `UPDATE apiKeys SET name = ?, isActive = ?, policy = ?, updatedAt = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [name ?? row.name, isActive === undefined ? row.isActive : (isActive ? 1 : 0), stringifyJson(policy), updatedAt, cols.accessRestricted, cols.accessAllow, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function getApiKeyBySecret(secret) {
  const db = await getAdapter();
  return rowToKey(db.get("SELECT * FROM apiKeys WHERE key = ?", [secret]));
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
