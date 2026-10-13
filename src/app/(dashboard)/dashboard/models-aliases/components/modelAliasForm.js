import { getConfiguredAliasOrder, normalizeModelsAliasConfig, validateModelsAliasName, validateModelsAliasMemberId } from "@/lib/modelsAliases/config.js";
import { normalizeComboPromptSettings } from "@/lib/comboPromptInjection.js";

export function createAliasDraft(alias = {}) {
  alias = alias ?? {};
  return {
    name: alias.name ?? "", models: [...(alias.models ?? [])], primaryModel: alias.primaryModel ?? "",
    strategy: alias.strategy ?? "fallback", judgeModel: alias.judgeModel ?? null,
    initialResponseTimeoutSeconds: String(alias.initialResponseTimeoutSeconds ?? 15),
    ...normalizeComboPromptSettings(alias),
  };
}

export function orderedDraftMembers(draft) {
  return getConfiguredAliasOrder(draft).filter(id => draft.models.includes(id));
}

export function removeDraftMember(draft, id) {
  return { ...draft, models: draft.models.filter(value => value !== id) };
}

export function moveDraftMember(draft, id, direction) {
  const models = orderedDraftMembers(draft);
  const index = models.indexOf(id);
  const next = index + direction;
  if (id === draft.primaryModel || index < 0 || next < 0 || next >= models.length || models[next] === draft.primaryModel) return draft;
  [models[index], models[next]] = [models[next], models[index]];
  return { ...draft, models };
}

export function memberObservability(id, metadata) {
  const value = metadata?.[id.split("/")[0]]?.outputObservability;
  return ["buffered", "incremental"].includes(value) ? value : "unknown";
}

export function validateAliasDraft(draft) {
  const errors = {};
  try { validateModelsAliasName(draft.name); } catch { errors.name = "Use nonempty slash-separated letters, numbers, dots, hyphens or underscores, without jrouter/."; }
  try {
    if (!draft.models.length) throw new Error();
    draft.models.forEach(validateModelsAliasMemberId);
  } catch { errors.models = "Choose at least one configured provider model."; }
  if (!draft.models.includes(draft.primaryModel)) errors.primaryModel = "Choose a primary from the remaining members.";
  if (draft.judgeModel !== null && !draft.models.includes(draft.judgeModel)) errors.judgeModel = "Choose a judge from the remaining members or use the primary.";
  const text = String(draft.initialResponseTimeoutSeconds);
  const seconds = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()) ? Number(text) : NaN;
  if (!Number.isFinite(seconds) || seconds * 1000 < 1 || seconds * 1000 > 2147483647) errors.initialResponseTimeoutSeconds = "Enter 0.001 to 2147483.647 seconds, including decimals.";
  if (Object.keys(errors).length) return { valid: false, errors };
  try { return { valid: true, errors, config: normalizeModelsAliasConfig({ ...draft, initialResponseTimeoutSeconds: seconds }) }; }
  catch { return { valid: false, errors: { configuration: "Check strategy and prompt settings." } }; }
}
