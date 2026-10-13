import { AsyncLocalStorage } from "node:async_hooks";
import { ApiKeyPolicyError, assertModelAllowed } from "./rules.js";
import { getProviderAlias } from "@/shared/constants/providers.js";
import { assertAuthorizedVirtualMember, isAuthorizedVirtualTarget } from "./virtualTargets.js";

const contextKey = Symbol.for("jrouter.apiKeyPolicyContext");
if (!globalThis[contextKey]) globalThis[contextKey] = new AsyncLocalStorage();
export const apiKeyPolicyContext = globalThis[contextKey];
export const getApiKeyPolicyContext = () => apiKeyPolicyContext.getStore();
const virtualMemberContext = new AsyncLocalStorage();
const publicLlmContext = new AsyncLocalStorage();
export const getPublicLlmTargetContext = () => publicLlmContext.getStore()?.authorized;
export const getPublicLlmAdmissionContext = () => publicLlmContext.getStore();
export function runWithPublicLlmAdmission(admission, callback) {
  if (!isAuthorizedVirtualTarget(admission?.authorized)) throw new ApiKeyPolicyError(403, "model_not_allowed", "Invalid public LLM admission.");
  return publicLlmContext.run(admission, callback);
}

// Extra Combo grants are scoped to one server-resolved identity, never payload flags.
export function runWithAuthorizedVirtualMember(authorized, requested, info, callback, options = {}) {
  const current = getApiKeyPolicyContext();
  try { assertAuthorizedVirtualMember(authorized, requested, info, options); }
  catch (error) { if (current) current.modelPolicyError = error; throw error; }
  const runMember = () => virtualMemberContext.run({ authorized, canonicalId: `${info.provider}/${info.model}`, extraComboMember: options.extraComboMember === true }, callback);
  // No-key authorization must not manufacture an API-key usage reservation.
  if (!current) return runMember();
  const context = current.authorizedVirtualTarget === authorized ? current : {
    ...current, policy: authorized.policy || {}, authorizedVirtualTarget: authorized,
  };
  if (current && context !== current) {
    for (const field of ["resolvedModel", "modelPolicyError", "accounted"]) {
      Object.defineProperty(context, field, { get: () => current[field], set: (value) => { current[field] = value; }, enumerable: true });
    }
  }
  return apiKeyPolicyContext.run(context, runMember);
}

export function modelIdentifiers(requested, info = {}) {
  const values = [requested, info.model];
  if (info.provider) values.push(`${info.provider}/${info.model}`, `${getProviderAlias(info.provider)}/${info.model}`);
  return values;
}

export function assertCurrentModelAllowed(requested, info = {}) {
  const context = getApiKeyPolicyContext();
  const memberContext = virtualMemberContext.getStore();
  if (!context && !memberContext) return;
  const authorized = context ? context.authorizedVirtualTarget : memberContext.authorized;
  try {
    if (authorized != null && !isAuthorizedVirtualTarget(authorized)) {
      throw new ApiKeyPolicyError(403, "model_not_allowed", "Invalid virtual target admission.");
    }
    if (isAuthorizedVirtualTarget(authorized)) {
      const extraComboMember = memberContext?.authorized === authorized && memberContext.canonicalId === `${info.provider}/${info.model}` && memberContext.extraComboMember;
      assertAuthorizedVirtualMember(authorized, requested, info, { extraComboMember });
    } else {
      assertModelAllowed(context.policy, [...modelIdentifiers(requested, info), ...(context.isCombo ? [context.requestedModel] : [])]);
    }
    if (context) context.modelPolicyError = null;
  } catch (error) {
    if (context) context.modelPolicyError = error;
    throw error;
  }
  if (context) context.resolvedModel = info;
}
