import "open-sse/index.js";
import { withApiKeyPolicy, extractPolicyApiKey } from "@/lib/apiKeyPolicy/gateway.js";
import { getPublicLlmTargetContext, runWithAuthorizedVirtualMember } from "@/lib/apiKeyPolicy/context.js";
import { assertAuthorizedVirtualMember } from "@/lib/apiKeyPolicy/virtualTargets.js";
import { ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";
import { getSettings } from "@/lib/localDb";
import { applyComboPromptInjection } from "@/lib/comboPromptInjection.js";
import { resolveModelInfo } from "../services/model.js";
import { executeProviderChat } from "./providerChat.js";
import { handleModelsAliasChat } from "../services/modelsAliasChat.js";
import { adaptPublicLlmResponse } from "../services/publicLlmResponse.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { detectFormat } from "open-sse/services/provider.js";
import * as log from "../utils/logger.js";

export async function handleChat(request, clientRawRequest = null, { publicTarget = null } = {}) {
  return withApiKeyPolicy(request, req => handleChatRequest(req, clientRawRequest), { family: "chat", targetAdmission: "public-llm", publicTarget });
}

async function handleChatRequest(request, clientRawRequest) {
  const authorized = getPublicLlmTargetContext();
  if (!authorized) throw new ApiKeyPolicyError(403, "model_not_allowed", "Public LLM admission required.");
  const body = await request.json();
  const target = authorized.target;
  const format = detectFormatByEndpoint(new URL(request.url).pathname, body) || detectFormat(body);
  if (!clientRawRequest) clientRawRequest = { endpoint: new URL(request.url).pathname, body: structuredClone(body), headers: Object.fromEntries(request.headers) };
  const settings = await getSettings();
  const apiKey = extractPolicyApiKey(request);
  const external = response => adaptPublicLlmResponse(response, { publicId: target.publicId, format });
  const bypass = handleBypassRequest(body, target.publicId, request.headers.get("user-agent") || "", !!settings.ccFilterNaming);
  if (bypass) return external(bypass.response || bypass);
  if (target.kind === "alias") return external(await handleModelsAliasChat({ authorized, body, request, clientRawRequest, apiKey, log }));

  const configs = new Map((target.comboConfigs || [target.config]).map(combo => [combo.name, combo]));
  const members = new Map(authorized.members.map(member => [member.requested, member]));
  const resolve = async id => members.get(id) || resolveModelInfo(id);
  async function single(candidateBody, id, raw = clientRawRequest) {
    if (configs.has(id)) return runCombo(candidateBody, configs.get(id), raw);
    const member = await resolve(id);
    return runWithAuthorizedVirtualMember(authorized, id, member, async () => {
      const result = await executeProviderChat({ body: candidateBody, member, clientRawRequest: raw, request, apiKey, log });
      return result.response;
    }, { extraComboMember: true });
  }
  async function runCombo(candidateBody, combo, raw) {
    const composed = applyComboPromptInjection(candidateBody, combo, { requestedModel: target.requestedId, sourceFormat: format });
    const comboSettings = settings.comboStrategies?.[combo.name] || {};
    const comboStrategy = comboSettings.fallbackStrategy || settings.comboStrategy || "fallback";
    const required = detectRequiredCapabilities(composed);
    const original = combo.models;
    const augmented = augmentModelsWithCapacityAdapter(original, required, settings);
    const permitted = [];
    for (const id of augmented) {
      if (configs.has(id)) { permitted.push(id); continue; }
      try { assertAuthorizedVirtualMember(authorized, id, await resolve(id), { extraComboMember: !original.includes(id) }); permitted.push(id); }
      catch (error) { if (!(error instanceof ApiKeyPolicyError)) throw error; }
    }
    if (!permitted.length) throw new ApiKeyPolicyError(403, "model_not_allowed", "No configured model is allowed.");
    if (comboStrategy === "fusion") {
      return handleFusionChat({ body: composed, models: permitted.filter(id => original.includes(id)),
        handleSingleModel: (b, id, isPanel) => {
          let panelRaw = raw;
          if (isPanel && raw) {
            const { tools, tool_choice, ...cleanBody } = raw.body || {};
            panelRaw = { ...raw, body: cleanBody };
          }
          return single(b, id, panelRaw);
        }, log, comboName: combo.name, judgeModel: comboSettings.judgeModel, tuning: comboSettings.fusionTuning });
    }
    return handleComboChat({ body: composed, models: permitted,
      handleSingleModel: withCapacityAdapterStripping((b, id) => single(b, id, raw), permitted.filter(id => !original.includes(id))),
      log, comboName: combo.name, comboStrategy, comboStickyLimit: settings.comboStickyRoundRobinLimit });
  }
  return external(await runCombo(body, target.config, clientRawRequest));
}
