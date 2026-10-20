// Publication rules for Custom Model-IDs. Pure: no DB, no request objects, so the
// routes and the tests share exactly one implementation.
//
// A published name is a global routing key: a request for it resolves to one
// combo before any provider is considered. A collision would therefore route a
// client's request somewhere the owner never published, which is why every
// neighbouring namespace (combo names, other public ids, provider ids, provider
// aliases, provider-node prefixes) is refused rather than resolved by precedence.
import { AI_PROVIDERS } from "@/shared/constants/providers.js";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
export const PUBLIC_NAME_MAX_LENGTH = 64;
export const VISIBILITY_VALUES = Object.freeze(["private", "public"]);

function reservedNames(nodes) {
  const reserved = new Set();
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.id) reserved.add(String(provider.id).toLowerCase());
    if (provider.alias) reserved.add(String(provider.alias).toLowerCase());
  }
  for (const node of nodes || []) {
    if (node?.prefix) reserved.add(String(node.prefix).toLowerCase());
  }
  return reserved;
}

/**
 * Validate and normalize a combo's publication fields.
 * @param {Object} input - { visibility, publicName, name, models }
 * @param {Object} ctx - { combos, nodes, selfId }
 * @returns {{ visibility: 'private'|'public', publicName: string|null }}
 * @throws {Error} with a message safe to return to the dashboard client
 */
export function validatePublication(input, { combos = [], nodes = [], selfId = null } = {}) {
  const raw = input || {};
  const visibility = raw.visibility === undefined ? "private" : raw.visibility;
  if (!VISIBILITY_VALUES.includes(visibility)) {
    throw new Error("Visibility must be private or public.");
  }

  let publicName = raw.publicName === undefined ? null : raw.publicName;
  if (publicName === "") publicName = null;
  if (publicName !== null) {
    if (typeof publicName !== "string") throw new Error("Public model id must be a string or empty.");
    if (publicName.length > PUBLIC_NAME_MAX_LENGTH) {
      throw new Error(`Public model id must be at most ${PUBLIC_NAME_MAX_LENGTH} characters.`);
    }
    if (!VALID_NAME_REGEX.test(publicName)) {
      throw new Error("Public model id can only contain letters, numbers, -, _ and .");
    }
  }

  if (visibility === "public") {
    const models = Array.isArray(raw.models) ? raw.models : [];
    if (models.length === 0) {
      throw new Error("A published model id needs at least one model in its combo.");
    }
  }

  // The name a client will actually send: the public id, or the combo's own name
  // when none is set (COALESCE(publicName, name) in the resolver).
  const effective = publicName || (typeof raw.name === "string" ? raw.name : null);
  if (effective) {
    const key = effective.toLowerCase();
    if (reservedNames(nodes).has(key)) {
      throw new Error(`"${effective}" is a reserved provider name or node prefix.`);
    }
    for (const combo of combos) {
      if (combo.id === selfId) continue;
      const otherPublic = (combo.publicName || combo.name || "").toLowerCase();
      if (otherPublic === key) throw new Error(`"${effective}" is already in use by another combo.`);
      if (combo.visibility === "public" && (combo.name || "").toLowerCase() === key) {
        throw new Error(`"${effective}" is already in use by another combo.`);
      }
    }
  }

  return { visibility, publicName };
}
