import { getModelsAliasByName, getComboByName, getProviderNodes } from "@/lib/db/index.js";
import { normalizeModelsAliasConfig, validateModelsAliasName } from "@/lib/modelsAliases/config.js";
import { resolveAliasMembers } from "@/lib/modelsAliases/members.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { resolveModelInfo } from "./model.js";
import { isVirtualTargetAllowed, resolveKeyAccessModelPermissions } from "./keyAccess.js";
import { ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";
import { assertVirtualParentAllowed, assertVirtualMemberNotBlocked, createAuthorizedVirtualTarget, modelIdentifiers } from "@/lib/apiKeyPolicy/virtualTargets.js";

function invalid(message = "Invalid public LLM target.") {
  return new ApiKeyPolicyError(400, "invalid_request", message);
}

function isLlmCombo(combo) {
  return combo && (!combo.kind || combo.kind === "llm");
}

/** @typedef {{kind:'alias'|'combo', entityId:string, name:string, requestedId:string, publicId:string, config:Object, members:string[], legacyBareRequested:boolean, contextMarker:string|null}} PublicLlmTarget */

/** @returns {Promise<PublicLlmTarget>} */
export async function resolvePublicLlmTarget(requested, { findAliasByName = getModelsAliasByName, findComboByName = getComboByName } = {}) {
  if (typeof requested !== "string" || !requested || /[\x00-\x1f\x7f]/.test(requested)) throw invalid();
  const { model, contextMarker } = stripModelContextMarker(requested);
  const prefixed = model.startsWith("jrouter/");
  const name = prefixed ? model.slice("jrouter/".length) : model;
  if (!name.trim() || name.startsWith("jrouter/") || name.split("/").some((part) => !part) || /[\\?#<>\[\]]|:\/\//.test(name)) throw invalid();
  const alias = prefixed ? await findAliasByName(name) : null;
  const combo = alias ? null : await findComboByName(name);
  // Existing exact Combo names predate the alias-only naming grammar.
  if (!combo || combo.name !== name) {
    try { validateModelsAliasName(name); } catch { throw invalid(); }
  }
  if (combo && !isLlmCombo(combo)) throw invalid("This Combo is not an LLM target.");
  const config = alias || combo;
  if (!config) {
    if (prefixed) throw new ApiKeyPolicyError(404, "model_not_found", "Public LLM model not found.");
    throw new ApiKeyPolicyError(403, "direct_model_not_allowed", "Direct provider LLM models are not allowed. Use a Models Alias or Combo.");
  }
  if (config.name !== name) throw new ApiKeyPolicyError(404, "model_not_found", "Public LLM model not found.");
  return {
    kind: alias ? "alias" : "combo", entityId: config.id, name,
    requestedId: requested, publicId: `jrouter/${name}`, config: structuredClone(config),
    members: structuredClone(config.models), legacyBareRequested: !prefixed, contextMarker,
  };
}

export async function resolveConfiguredLlmLeaves(target, { comboConfigs = new Map() } = {}) {
  try {
    if (target.kind === "alias") {
      const config = normalizeModelsAliasConfig(target.config);
      return await resolveAliasMembers(config.models);
    }
    if (target.kind !== "combo" || !isLlmCombo(target.config)) throw invalid();
    const leaves = [];
    const seenRequests = new Set();
    async function expand(combo, path) {
      if (path.has(combo.name)) throw invalid("Cyclic Combo configuration.");
      if (!isLlmCombo(combo) || !Array.isArray(combo.models) || !combo.models.length) throw invalid("Invalid configured LLM Combo.");
      comboConfigs.set(combo.name, structuredClone(combo));
      const nextPath = new Set([...path, combo.name]);
      for (const requested of combo.models) {
        if (typeof requested !== "string" || !requested || requested.startsWith("jrouter/")) throw invalid("Invalid configured LLM member.");
        // Nested Combos use the old bare-name routing seam, not the public namespace.
        const nested = requested.includes("/") ? null : comboConfigs.get(requested) || await getComboByName(requested);
        if (nested) { await expand(nested, nextPath); continue; }
        const info = await resolveModelInfo(requested);
        if (!info?.provider || !info.model || info.provider === "jrouter") throw invalid("Invalid configured LLM member.");
        if (!seenRequests.has(requested)) {
          seenRequests.add(requested);
          leaves.push({ requested, provider: info.provider, model: info.model, canonicalId: `${info.provider}/${info.model}` });
        }
      }
    }
    await expand(target.config, new Set());
    return leaves;
  } catch (error) {
    if (error instanceof ApiKeyPolicyError) throw error;
    throw invalid(error.message);
  }
}

export async function authorizeVirtualTarget(target, { policy = null, keyAccess = null } = {}) {
  const snapshot = structuredClone(target);
  const policySnapshot = policy ? structuredClone(policy) : null;
  const accessSnapshot = keyAccess ? { keyId: keyAccess.keyId, keyName: keyAccess.keyName, allow: structuredClone(keyAccess.allow || []) } : null;
  assertVirtualParentAllowed(snapshot, policySnapshot);
  if (!await isVirtualTargetAllowed(accessSnapshot, snapshot)) throw new ApiKeyPolicyError(403, "model_not_allowed", "This model is not allowed for this API key.");
  const comboConfigs = new Map();
  const leaves = await resolveConfiguredLlmLeaves(snapshot, { comboConfigs });
  if (snapshot.kind === "combo") snapshot.comboConfigs = [...comboConfigs.values()];
  const providerNodes = await getProviderNodes();
  const members = leaves.filter((member) => {
    const identifiers = leaves.filter((leaf) => leaf.canonicalId === member.canonicalId).flatMap((leaf) => modelIdentifiers(leaf.requested, leaf, providerNodes));
    try { assertVirtualMemberNotBlocked(policySnapshot, identifiers); return true; }
    catch (error) { if (error instanceof ApiKeyPolicyError) return false; throw error; }
  });
  if (!members.length) throw new ApiKeyPolicyError(403, "model_not_allowed", "No configured model is allowed for this API key.");
  const modelPermissions = snapshot.kind === "combo" ? await resolveKeyAccessModelPermissions(accessSnapshot) : null;
  return createAuthorizedVirtualTarget(snapshot, members, { policy: policySnapshot, keyAccess: accessSnapshot, modelPermissions, providerNodes, configuredMembers: leaves });
}
