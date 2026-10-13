import REGISTRY from "open-sse/providers/registry/index.js";
import { modelKind } from "open-sse/providers/models/schema.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers.js";
import { parseJson } from "../db/helpers/jsonCol.js";
import { validateModelsAliasMemberId } from "./config.js";

const providers = new Map();
for (const entry of REGISTRY) {
  for (const prefix of [entry.id, entry.alias, ...(entry.aliases || [])].filter(Boolean)) providers.set(prefix, entry);
}

export function getAliasMembersContext(db) {
  return {
    providerNodes: db.all("SELECT * FROM providerNodes").map((row) => ({ ...parseJson(row.data, {}), id: row.id, type: row.type })),
    providerConnections: db.all("SELECT provider FROM providerConnections"),
    customModels: db.all("SELECT value FROM kv WHERE scope = 'customModels'").map((row) => parseJson(row.value, {})),
  };
}

export function resolveAliasMembersFromContext(modelIds, context) {
  if (!Array.isArray(modelIds) || !modelIds.length) throw new Error("Models Alias requires members");
  return modelIds.map((requested) => {
    validateModelsAliasMemberId(requested);
    const slash = requested.indexOf("/");
    const prefix = requested.slice(0, slash);
    const model = requested.slice(slash + 1);
    const entry = providers.get(prefix);
    const matches = entry ? [] : context.providerNodes.filter((node) => node.id === prefix || node.prefix === prefix);
    if (matches.length > 1) throw new Error(`Ambiguous provider prefix: ${prefix}`);
    const node = matches[0];
    const provider = entry?.id || node?.id;
    if (!provider) throw new Error(`Unknown configured provider: ${prefix}`);
    if (node && !["openai-compatible", "anthropic-compatible"].includes(node.type)) throw new Error(`Member is not an LLM provider: ${requested}`);
    if (node) {
      const compatibleIdentity = node.type === "openai-compatible"
        ? isOpenAICompatibleProvider(node.id) && node.id.length > OPENAI_COMPATIBLE_PREFIX.length
        : isAnthropicCompatibleProvider(node.id) && node.id.length > ANTHROPIC_COMPATIBLE_PREFIX.length;
      if (typeof node.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(node.id) || node.id.includes("__placeholder__") || providers.has(node.id) || node.id === "jrouter" || !compatibleIdentity) throw new Error(`Invalid compatible provider identity: ${prefix}`);
    }
    if (entry && (!(entry.serviceKinds || entry.media?.serviceKinds || ["llm"]).includes("llm") || !(entry.transport || entry.transports))) throw new Error(`Member is not an LLM provider: ${requested}`);
    if (entry && !(entry.noAuth || entry.transport?.noAuth) && !context.providerConnections.some((connection) => providers.get(connection.provider)?.id === provider)) throw new Error(`Provider is not configured: ${provider}`);
    const custom = context.customModels.filter((record) => record.id === model && (entry ? providers.get(record.providerAlias)?.id === provider : [node.id, node.prefix].includes(record.providerAlias)));
    const registered = (entry?.models || []).map((record) => typeof record === "string" ? { id: record } : record).filter((record) => record.id === model);
    const metadata = [...registered, ...custom];
    if (metadata.some((record) => modelKind(record) !== "llm")) throw new Error(`Member is not an LLM model: ${requested}`);
    if (entry && !metadata.length && !entry.passthroughModels) throw new Error(`Unknown LLM model: ${requested}`);
    return { requested, provider, model, canonicalId: `${provider}/${model}` };
  });
}

export async function resolveAliasMembers(modelIds) {
  // Read through the driver, not the routing resolver's DB barrel cycle.
  const { getAdapter } = await import("../db/driver.js");
  return resolveAliasMembersFromContext(modelIds, getAliasMembersContext(await getAdapter()));
}
