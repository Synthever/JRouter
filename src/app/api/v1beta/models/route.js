import { PROVIDER_MODELS, getModelKind } from "@/shared/constants/models";
import { withApiKeyCatalogPolicy, filterCatalogModels } from "@/lib/apiKeyPolicy/catalog.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import { buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
const MEDIA_KINDS = new Set(["image", "tts", "stt", "embedding", "webSearch", "webFetch", "video"]);

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    return await withApiKeyCatalogPolicy(request, (key) => getModels(request, key));
  } catch {
    return Response.json({ error: { message: "Unable to load models." } }, { status: 500, headers: CORS_HEADERS });
  }
}

async function getModels(request, key) {
  const nativeMedia = [];
  const seen = new Set();
  for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
    for (const model of providerModels) {
      const kind = getModelKind(model, "llm");
      if (!MEDIA_KINDS.has(kind)) continue;
      const names = [`models/${provider}/${model.id}`];
      if (provider === "gemini") names.push(`models/${model.id}`);
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        const metadata = {
          name, kind, displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
        };
        if (Number.isFinite(model.contextWindow) && model.contextWindow > 0) metadata.inputTokenLimit = model.contextWindow;
        if (Number.isFinite(model.maxOutput) && model.maxOutput > 0) metadata.outputTokenLimit = model.maxOutput;
        nativeMedia.push(metadata);
      }
    }
  }
  const keyAccess = await getKeyAccessContext(request);
  const policyMedia = await filterCatalogModels(key, nativeMedia, (model) => model.name);
  const mediaEntries = policyMedia.map((model) => ({ ...model, id: model.name.replace(/^models\//, "") }));
  const allowedMedia = await filterModelsListForKey(keyAccess, mediaEntries);
  const llm = await buildPublicLlmModelsList({ policy: key, keyAccess });
  const virtualEntries = llm.map((model) => {
    const caps = model.capabilities || {};
    const entry = {
      name: `models/${model.id}`, displayName: model.id.slice("jrouter/".length),
      description: "JRouter virtual LLM model", supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    };
    if (Number.isFinite(caps.contextWindow) && caps.contextWindow > 0) entry.inputTokenLimit = caps.contextWindow;
    if (Number.isFinite(caps.maxOutput) && caps.maxOutput > 0) entry.outputTokenLimit = caps.maxOutput;
    return entry;
  });
  return Response.json({ models: [...allowedMedia.map(({ id: _id, ...model }) => model), ...virtualEntries] }, { headers: CORS_HEADERS });
}
