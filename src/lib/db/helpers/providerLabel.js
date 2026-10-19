// Human-readable provider labels for usage/dashboard surfaces.
//
// Usage rows persist `provider` as the provider id. For registry providers that
// is a stable key ("river"), but for custom compatible nodes it is a generated
// id ("openai-compatible-chat-<uuid>"). Older rows can reference nodes that have
// since been deleted, so a raw id must never reach the UI: resolve live node
// names from providerNodes, and degrade to a readable label otherwise.

import REGISTRY from "open-sse/providers/registry/index.js";

const CUSTOM_PREFIXES = ["openai-compatible-", "anthropic-compatible-", "custom-embedding-"];

const REGISTRY_NAMES = Object.fromEntries(
  REGISTRY.map((entry) => [entry.id, entry.display?.name || entry.id])
);

// Extra aliases that appear in usage history but are not provider ids.
const ALIAS_NAMES = { rvr: "River", ds: "DeepSeek", cx: "Codex", cc: "Claude" };

export const DELETED_NODE_LABEL = "Custom provider";

export function isCustomNodeId(providerId) {
  return typeof providerId === "string" && CUSTOM_PREFIXES.some((p) => providerId.startsWith(p));
}

/**
 * Resolve a provider id to a display label.
 * @param {string|null} providerId - value stored in usage rows / connections
 * @param {Record<string,string>} [nodeNames] - id → node name (live providerNodes)
 * @returns {string}
 */
export function providerDisplayLabel(providerId, nodeNames = {}) {
  if (!providerId) return "Unknown";
  if (nodeNames[providerId]) return nodeNames[providerId];
  if (REGISTRY_NAMES[providerId]) return REGISTRY_NAMES[providerId];
  if (ALIAS_NAMES[providerId]) return ALIAS_NAMES[providerId];
  if (isCustomNodeId(providerId)) return DELETED_NODE_LABEL;
  return providerId;
}
