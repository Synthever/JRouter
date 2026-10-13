import { getAdapter } from "@/lib/db/driver.js";
import { getSettings } from "@/lib/localDb";
import { getPricingForModel } from "@/lib/db/repos/pricingRepo.js";
import { getModelInfo, getComboModels } from "@/sse/services/model.js";
import { estimateInputTokens } from "open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "open-sse/providers/pricing.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { endpointFamily, POLICY_ESTIMATED_OUTPUT_TOKENS } from "@/shared/constants/apiKeyPolicy.js";
import { ApiKeyPolicyError, assertModelAllowed, enforceOutputLimit } from "./rules.js";
import { apiKeyPolicyContext, getApiKeyPolicyContext, modelIdentifiers } from "./context.js";
import { reserveKeyUsage, accountKeyUsage, finishKeyUsage } from "./accounting.js";
import { responseUsageObserver } from "./responseUsage.js";
import { authenticatePolicyKey, extractPolicyApiKey } from "./authentication.js";
import { resolvePublicLlmTarget, authorizeVirtualTarget } from "@/sse/services/publicLlmTarget.js";
import { getKeyAccessContext } from "@/sse/services/keyAccess.js";
import { getPublicLlmAdmissionContext, runWithPublicLlmAdmission } from "./context.js";

export { extractPolicyApiKey } from "./authentication.js";

async function requestBody(request) {
  if (["GET", "HEAD"].includes(request.method)) return {};
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.clone().formData();
    return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
  }
  return request.clone().json();
}

export async function withApiKeyPolicy(request, handler, { family = null, model = null, billable = true, targetAdmission = null, publicTarget = null } = {}) {
  if (targetAdmission !== "public-llm" && getApiKeyPolicyContext()) return handler(request);
  let context;
  let db;
  try {
    const settings = await getSettings();
    const key = await authenticatePolicyKey(request);
    if (!key && settings.requireApiKey) throw new ApiKeyPolicyError(401, "invalid_api_key", "Missing API key.");
    if (!key && targetAdmission !== "public-llm") return handler(request);
    let body;
    try { body = await requestBody(request); } catch { throw new ApiKeyPolicyError(400, "invalid_request", "Invalid request body."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiKeyPolicyError(400, "invalid_request", "Request body must be an object.");
    const pathname = new URL(request.url).pathname;
    const endpoint = family || (body.generationConfig?.responseModalities?.includes("AUDIO") ? "audio" : endpointFamily(pathname));
    if (key && key.allowedEndpoints !== null && !key.allowedEndpoints.includes(endpoint)) throw new ApiKeyPolicyError(403, "endpoint_not_allowed", "This endpoint is not allowed for this API key.");

    let authorized = null;
    let publicAdmission = null;
    if (targetAdmission === "public-llm") {
      const requested = model ?? body.model;
      const target = await resolvePublicLlmTarget(requested);
      const inherited = getPublicLlmAdmissionContext();
      const sameIdentity = inherited && inherited.authorized.target.requestedId === requested
        && inherited.endpoint === endpoint && inherited.billable === billable
        && inherited.keySecret === extractPolicyApiKey(request);
      if (publicTarget && (!sameIdentity || publicTarget !== inherited.authorized)) throw new ApiKeyPolicyError(403, "model_not_allowed", "Public target admission does not match this request.");
      if (sameIdentity) {
        const cappedBody = endpoint === "chat" && key ? enforceOutputLimit(body, key.maxOutputTokens) : body;
        if (cappedBody !== body) {
          const headers = new Headers(request.headers); headers.delete("content-length");
          request = new Request(request.url, { method: request.method, headers, body: JSON.stringify(cappedBody), signal: request.signal });
        }
        return handler(request);
      }
      authorized = await authorizeVirtualTarget(target, { policy: key, keyAccess: await getKeyAccessContext(request) });
      publicAdmission = { authorized, endpoint, billable, keySecret: extractPolicyApiKey(request) };
      if (!key || !billable) return apiKeyPolicyContext.run(undefined, () => runWithPublicLlmAdmission(publicAdmission, () => handler(request)));
    }
    const requestedModel = stripModelContextMarker(model || (endpoint === "web" ? body.provider || body.model : body.model || body.provider) || "").model;
    const resolvePolicyModel = endpoint === "web"
      ? async (provider) => ({ provider: resolveProviderId(provider), model: pathname.endsWith("/fetch") ? "fetch" : "search" })
      : getModelInfo;
    let info = {};
    let pricing = null;
    let isCombo = false;
    if (authorized) {
      isCombo = authorized.target.kind === "combo";
      info = { provider: null, model: authorized.target.publicId };
      if (key.maxCostUsd !== null && billable) {
        const prices = await Promise.all(authorized.members.map(member => getPricingForModel(member.provider, member.model)));
        if (prices.every(price => price && Number.isFinite(price.input) && Number.isFinite(price.output))) pricing = { input: Math.max(...prices.map(p => p.input)), output: Math.max(...prices.map(p => p.output)) };
      }
    } else if (requestedModel) {
      const combos = await getComboModels(requestedModel);
      isCombo = Boolean(combos);
      info = combos ? { provider: null, model: requestedModel } : await resolvePolicyModel(requestedModel);
      // A combo must be allowed by name before it can grant access to members.
      assertModelAllowed(key, combos ? [requestedModel] : modelIdentifiers(requestedModel, info));
      if (info.provider) pricing = await getPricingForModel(info.provider, info.model);
      if (key.maxCostUsd !== null && billable) {
        if (combos) {
          const prices = await Promise.all(combos.map(async (seat) => {
            const resolved = await resolvePolicyModel(seat);
            return getPricingForModel(resolved.provider, resolved.model);
          }));
          if (prices.every((price) => price && Number.isFinite(price.input) && Number.isFinite(price.output))) pricing = { input: Math.max(...prices.map((p) => p.input)), output: Math.max(...prices.map((p) => p.output)) };
        }
        if (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output)) throw new ApiKeyPolicyError(403, "pricing_unavailable", "Cost quota requires model pricing. Configure pricing or use a key without a cost quota.");
      }
    } else if (key.allowedModels.length && billable) {
      throw new ApiKeyPolicyError(403, "model_not_allowed", "A model is required for this API key's model restrictions.");
    }
    if (key.maxCostUsd !== null && billable && (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output))) throw new ApiKeyPolicyError(403, "pricing_unavailable", "Cost quota requires model pricing. Configure pricing or use a key without a cost quota.");
    const cappedBody = endpoint === "chat" || endpoint === "audio" ? enforceOutputLimit(body, key.maxOutputTokens) : body;
    if (cappedBody !== body && !request.headers.get("content-type")?.includes("multipart/form-data") && !["GET", "HEAD"].includes(request.method)) {
      const headers = new Headers(request.headers); headers.delete("content-length");
      request = new Request(request.url, { method: request.method, headers, body: JSON.stringify(cappedBody), signal: request.signal });
    }
    const inputTokens = billable ? estimateInputTokens(cappedBody) : 0;
    const outputTokens = billable && endpoint === "chat" ? (cappedBody.max_tokens ?? cappedBody.max_completion_tokens ?? cappedBody.max_output_tokens ?? cappedBody.generationConfig?.maxOutputTokens ?? cappedBody.options?.num_predict ?? POLICY_ESTIMATED_OUTPUT_TOKENS) : 0;
    const estimatedCost = pricing ? calculateCostFromTokens({ prompt_tokens: inputTokens, completion_tokens: outputTokens }, pricing) : 0;
    db = await getAdapter();
    const admission = reserveKeyUsage(db, key.id, { tokens: inputTokens + Math.max(0, outputTokens), cost: estimatedCost }, Date.now());
    context = { ...admission, policy: key, requestedModel, isCombo, resolvedModel: info, pending: new Set(), accounted: false, ...(authorized ? { authorizedVirtualTarget: authorized } : {}) };
    let response = await apiKeyPolicyContext.run(context, () => publicAdmission ? runWithPublicLlmAdmission(publicAdmission, () => handler(request)) : handler(request));
    // Combo fallback catches model errors. Restore the policy envelope when no
    // permitted member succeeds instead of returning its generic upstream error.
    if (!response.ok && context.modelPolicyError) response = context.modelPolicyError.response();
    const observer = responseUsageObserver(response.headers.get("content-type") || "");
    let finished = false;
    async function finish() {
      if (finished) return;
      finished = true;
      await Promise.allSettled([...context.pending]);
      const resolvedPricing = context.resolvedModel?.provider ? await getPricingForModel(context.resolvedModel.provider, context.resolvedModel.model) : pricing;
      db.transaction(() => {
        if (response.ok && billable && !context.accounted) {
          const observed = observer.result();
          const rawInput = observed.hasUsage ? observed.input : inputTokens;
          const rawOutput = observed.output;
          accountKeyUsage(db, admission, rawInput + rawOutput, resolvedPricing ? calculateCostFromTokens({ ...observed.tokens, prompt_tokens: rawInput, completion_tokens: rawOutput }, resolvedPricing) : 0);
        }
        finishKeyUsage(db, admission);
      });
    }
    if (!response.ok || !response.body) { await finish(); return response; }
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await apiKeyPolicyContext.run(context, () => reader.read());
          if (done) { await finish(); controller.close(); }
          else { observer.push(value); controller.enqueue(value); }
        } catch (error) { await finish(); controller.error(error); }
      },
      async cancel(reason) { try { await apiKeyPolicyContext.run(context, () => reader.cancel(reason)); } finally { await finish(); } },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (context && db) { await Promise.allSettled([...context.pending]); finishKeyUsage(db, context); }
    if (error instanceof ApiKeyPolicyError) return error.response();
    throw error;
  }
}
