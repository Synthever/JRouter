import { authenticatePolicyKey } from "./authentication.js";
import { ApiKeyPolicyError, assertModelAllowed } from "./rules.js";
import { modelIdentifiers } from "./context.js";
import { getModelInfo, getComboModels } from "@/sse/services/model.js";

// Model discovery remains public where it already was. Supplied credentials
// still carry expiry and model restrictions, without consuming inference quota.
export async function withApiKeyCatalogPolicy(request, handler) {
  try { return await handler(await authenticatePolicyKey(request)); }
  catch (error) { if (error instanceof ApiKeyPolicyError) return error.response(); throw error; }
}

export async function filterCatalogModels(key, models, getId = (model) => model.id) {
  if (!key || (!key.allowedModels.length && !key.blockedModels.length)) return models;
  const permitted = await Promise.all(models.map(async (model) => {
    const identifier = getId(model).replace(/^models\//, "");
    const info = await getModelInfo(identifier);
    try {
      const members = info.provider ? null : await getComboModels(identifier);
      if (!members) assertModelAllowed(key, modelIdentifiers(identifier, info));
      else {
        assertModelAllowed({ ...key, allowedModels: [] }, [identifier]);
        const allowed = await Promise.all(members.map(async (member) => {
          try { assertModelAllowed(key, [...modelIdentifiers(member, await getModelInfo(member)), identifier]); return true; }
          catch (error) { if (error instanceof ApiKeyPolicyError) return false; throw error; }
        }));
        if (!allowed.some(Boolean)) return false;
      }
      return true;
    } catch (error) { if (error instanceof ApiKeyPolicyError) return false; throw error; }
  }));
  return models.filter((_model, index) => permitted[index]);
}
