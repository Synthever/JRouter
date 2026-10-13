import { normalizeComboPromptSettings, validateComboPromptSettings } from "../comboPromptInjection.js";

export function validateModelsAliasMemberId(id) {
  if (typeof id !== "string" || id.startsWith("jrouter/") || id.includes("__placeholder__") || /[\s\\?#<>]|:\/\//.test(id) || [...id].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("Invalid Models Alias member");
  const parts = id.split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..") || parts.slice(1).includes("model-id")) throw new Error("Invalid Models Alias member");
  return id;
}

export function normalizeModelsAliasConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Models Alias configuration");
  const name = validateModelsAliasName(input.name);
  if (!Array.isArray(input.models) || !input.models.length) throw new Error("Models Alias requires members");
  const models = [...new Set(input.models.map(validateModelsAliasMemberId))];
  if (!models.includes(input.primaryModel)) throw new Error("Primary model must be a member");
  const judgeModel = input.judgeModel === undefined ? null : input.judgeModel;
  if (judgeModel !== null && !models.includes(judgeModel)) throw new Error("Judge model must be a member");
  const strategy = input.strategy === undefined ? "fallback" : input.strategy;
  if (!["fallback", "round-robin", "fusion"].includes(strategy)) throw new Error("Invalid Models Alias strategy");
  const timeout = input.initialResponseTimeoutSeconds === undefined ? 15 : input.initialResponseTimeoutSeconds;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout * 1000 < 1 || timeout * 1000 > 2147483647) throw new Error("Initial response timeout must be representable as a JS timer (1–2147483647 ms)");
  return { name, models: getConfiguredAliasOrder({ models, primaryModel: input.primaryModel }), primaryModel: input.primaryModel, strategy, judgeModel, initialResponseTimeoutSeconds: timeout, ...normalizeComboPromptSettings(validateComboPromptSettings(input)) };
}

export function getModelsAliasConfigKey(alias) {
  return JSON.stringify([alias.id ?? null, alias.name, getConfiguredAliasOrder(alias), alias.primaryModel, alias.strategy, alias.judgeModel, alias.initialResponseTimeoutSeconds, ...Object.values(normalizeComboPromptSettings(alias))]);
}

export function validateModelsAliasName(name) {
  if (typeof name !== "string" || name.startsWith("jrouter/") || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(name)) {
    throw new Error("Invalid Models Alias name");
  }
  return name;
}

export function getConfiguredAliasOrder(alias) {
  return [...new Set([alias.primaryModel, ...alias.models])];
}
