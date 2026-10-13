import { getModelsAliases } from "@/lib/db/repos/modelsAliasesRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { getAliasMembersContext, resolveAliasMembersFromContext } from "@/lib/modelsAliases/members.js";
import { normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { getProviderAlias } from "@/shared/constants/providers.js";
import { resolvePublicLlmTarget, authorizeVirtualTarget, resolveConfiguredLlmLeaves } from "./publicLlmTarget.js";
import { getCapabilitiesForModel, aggregateComboCapabilities, applyLimitOverrides } from "open-sse/providers/capabilities.js";
import { getModelStrip, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";

function isLlmCombo(combo) { return combo && (!combo.kind || combo.kind === "llm"); }

function memberCapabilities(member, context, alias) {
  const prefixes = [member.provider, getProviderAlias(member.provider), ...context.providerNodes.filter((node) => node.id === member.provider).map((node) => node.prefix)];
  const custom = context.customModels.find((entry) => entry.id === member.model && prefixes.includes(entry.providerAlias));
  const effective = getCapabilitiesForModel(member.provider, member.model);
  const caps = { ...effective, ...(custom?.caps || {}) };
  if (alias) {
    const strips = getModelStrip(PROVIDER_ID_TO_ALIAS[member.provider] || member.provider, member.model);
    for (const [capability, contentType] of Object.entries({ vision: "image", pdf: "pdf", audioInput: "audio", videoInput: "video" })) {
      caps[capability] = effective[capability] === true && caps[capability] === true && !strips.includes(contentType);
    }
  }
  return applyLimitOverrides(caps, member.provider, member.model);
}

export async function getVirtualTargetCapabilities(target, context = null, configuredLeaves = null) {
  const memberContext = context || getAliasMembersContext(await getAdapter());
  const comboConfigs = new Map((target.comboConfigs || []).map((combo) => [combo.name, combo]));
  const leaves = configuredLeaves || (target.kind === "alias"
    ? resolveAliasMembersFromContext(normalizeModelsAliasConfig(target.config).models, memberContext)
    : await resolveConfiguredLlmLeaves(target, { comboConfigs }));
  if (!leaves.length) return null;
  const resolved = leaves.map((member) => ({ ...member, capabilities: memberCapabilities(member, memberContext, target.kind === "alias") }));
  const configured = resolved.map((entry) => entry.capabilities);
  const minimum = (key) => configured.every((caps) => Number.isFinite(caps[key]) && caps[key] > 0)
    ? Math.min(...configured.map((caps) => caps[key])) : null;
  let caps;
  if (target.kind === "combo") {
    const byId = new Map(resolved.map((member) => [member.canonicalId, member.capabilities]));
    caps = aggregateComboCapabilities([...byId.keys()], null, (id) => byId.get(id));
  } else {
    const intersection = (key) => configured.every((value) => value[key] === true);
    caps = {
      ...resolved[0].capabilities,
      vision: intersection("vision"), pdf: intersection("pdf"), audioInput: intersection("audioInput"),
      videoInput: intersection("videoInput"), imageOutput: intersection("imageOutput"),
      audioOutput: intersection("audioOutput"), search: intersection("search"), tools: intersection("tools"),
    };
  }
  return { ...caps, contextWindow: minimum("contextWindow"), maxOutput: minimum("maxOutput") };
}

function publicEntry(target, caps, dashboard = false) {
  const entry = { id: target.publicId, object: "model", owned_by: "jrouter", kind: "llm" };
  if (dashboard) { entry.name = target.name; entry.targetType = target.kind; }
  if (caps) {
    const safeCaps = {};
    for (const key of ["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "search", "tools", "reasoning"]) {
      if (typeof caps[key] === "boolean") safeCaps[key] = caps[key];
    }
    if (Number.isFinite(caps.contextWindow) && caps.contextWindow > 0) {
      entry.context_length = caps.contextWindow;
      safeCaps.contextWindow = caps.contextWindow;
    }
    if (Number.isFinite(caps.maxOutput) && caps.maxOutput > 0) {
      entry.max_completion_tokens = caps.maxOutput;
      safeCaps.maxOutput = caps.maxOutput;
    }
    entry.capabilities = safeCaps;
  }
  return entry;
}

async function buildTargets(policy, keyAccess, dashboard) {
  const [aliases, combos] = await Promise.all([getModelsAliases(), getCombos()]);
  // Read storage outside expected-invalid handling; storage failures are never an empty catalog.
  const memberContext = getAliasMembersContext(await getAdapter());
  const candidates = [
    ...aliases.map((config) => ({ kind: "alias", config })),
    ...combos.filter(isLlmCombo).map((config) => ({ kind: "combo", config })),
  ];
  const entries = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const target = await resolvePublicLlmTarget(`jrouter/${candidate.config.name}`);
      if (target.kind !== candidate.kind || seen.has(target.publicId)) continue;
      if (target.kind === "alias") {
        try {
          resolveAliasMembersFromContext(normalizeModelsAliasConfig(target.config).models, memberContext);
        } catch {
          continue;
        }
      }
      const admitted = await authorizeVirtualTarget(target, { policy, keyAccess });
      if (!admitted.members.length) continue;
      const comboConfigs = new Map((admitted.target.comboConfigs || []).map((combo) => [combo.name, combo]));
      const leaves = await resolveConfiguredLlmLeaves(admitted.target, { comboConfigs });
      try {
        resolveAliasMembersFromContext(leaves.map((member) => member.canonicalId), memberContext);
      } catch {
        continue;
      }
      const caps = await getVirtualTargetCapabilities(admitted.target, memberContext, leaves);
      if (!caps) continue;
      const entry = publicEntry(admitted.target, caps, dashboard);
      seen.add(entry.id);
      entries.push(entry);
    } catch (error) {
      if (error instanceof ApiKeyPolicyError && [403, 404].includes(error.status)) continue;
      if (error instanceof ApiKeyPolicyError && error.status === 400 && [
        "Invalid public LLM target.", "This Combo is not an LLM target.",
        "Cyclic Combo configuration.", "Invalid configured LLM Combo.", "Invalid configured LLM member.",
      ].includes(error.message)) continue;
      if (error instanceof ApiKeyPolicyError) throw new Error("Unable to resolve public catalog storage.");
      throw error;
    }
  }
  return entries;
}

export async function buildPublicLlmModelsList({ policy = null, keyAccess = null, dashboard = false } = {}) {
  return buildTargets(dashboard ? null : policy, dashboard ? null : keyAccess, dashboard);
}

export function filterPublicLlmModelsByCapability(models, kind = "llm") {
  if (kind === "llm") return models;
  if (kind === "imageToText") return models.filter((model) => model.capabilities?.vision === true);
  return [];
}
