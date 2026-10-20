import { AsyncLocalStorage } from "node:async_hooks";
import { assertModelAllowed } from "./rules.js";
import { getProviderAlias } from "@/shared/constants/providers.js";

const contextKey = Symbol.for("jrouter.apiKeyPolicyContext");
if (!globalThis[contextKey]) globalThis[contextKey] = new AsyncLocalStorage();
export const apiKeyPolicyContext = globalThis[contextKey];
export const getApiKeyPolicyContext = () => apiKeyPolicyContext.getStore();

export function modelIdentifiers(requested, info = {}) {
  const values = [requested, info.model];
  if (info.provider) values.push(`${info.provider}/${info.model}`, `${getProviderAlias(info.provider)}/${info.model}`);
  return values;
}

export function assertCurrentModelAllowed(requested, info = {}) {
  const context = getApiKeyPolicyContext();
  if (!context) return;
  // Role-gated user keys are authorized by their published-name gate; their
  // allow list is not a model allowlist, so the owner-oriented policy check
  // must not run. Owner keys keep the existing behaviour.
  if (context.keyRole === "user") { context.resolvedModel = info; return; }
  try {
    assertModelAllowed(context.policy, [...modelIdentifiers(requested, info), ...(context.isCombo ? [context.requestedModel] : [])]);
    context.modelPolicyError = null;
  } catch (error) {
    context.modelPolicyError = error;
    throw error;
  }
  context.resolvedModel = info;
}
