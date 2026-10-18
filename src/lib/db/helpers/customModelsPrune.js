// customModels rows are keyed `providerAlias|modelId|type`. Rows whose alias is a
// provider-node UUID that no longer exists in providerNodes are ghosts: no
// connection can ever serve them, but every catalog/picker consumer reads the kv
// scope directly and renders them as raw-UUID provider groups. Pruning runs on
// backup import (the re-introduction path) and nearby node lifecycle events.
// Aliases that are not node UUIDs (registry provider ids like `cx` or
// `openrouter`, or short node prefixes) are never touched here.
import { parseJson } from "./jsonCol.js";

// long uuid-shaped node aliases: openai-compatible-chat-<uuid>, anthropic-compatible-<uuid>, custom-embedding-<uuid>
export const NODE_ALIAS_RE = /^(?:openai-compatible-chat|anthropic-compatible|custom-embedding)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete customModels rows whose provider alias is a node UUID that no longer
 * resolves to a providerNodes row. Returns the number of rows removed.
 */
export function pruneOrphanCustomModels(db) {
  const live = new Set(db.all(`SELECT id FROM providerNodes`).map((r) => r.id));
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`);
  const deadAliases = [...new Set(
    rows
      .map((r) => {
        try { return (parseJson(r.value, {}) || {}).providerAlias || r.key.split("|")[0]; }
        catch { return r.key.split("|")[0]; }
      })
      .filter((alias) => NODE_ALIAS_RE.test(alias) && !live.has(alias))
  )];
  let removed = 0;
  for (const alias of deadAliases) {
    removed += rows.filter((r) => r.key.startsWith(`${alias}|`)).length;
    db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key LIKE ?`, [`${alias}|%`]);
  }
  return removed;
}

/**
 * Remove customModels rows for one specific (now deleted) node identity.
 * Called from deleteProviderNode with the node's id and its last prefix, so
 * rows added under either alias die with the node. Unlike pruneOrphanCustomModels
 * this is an explicit target: it does not consult providerNodes liveness.
 */
export function pruneForNode(db, id, prefix) {
  let removed = 0;
  for (const alias of [id, prefix].filter(Boolean)) {
    removed += db.all(`SELECT COUNT(*) AS n FROM kv WHERE scope = 'customModels' AND key LIKE ?`, [`${alias}|%`])[0]?.n ?? 0;
    db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key LIKE ?`, [`${alias}|%`]);
  }
  return removed;
}
