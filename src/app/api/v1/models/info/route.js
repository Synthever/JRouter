import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { withApiKeyCatalogPolicy, filterCatalogModels } from "@/lib/apiKeyPolicy/catalog.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import { buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";
import { resolvePublicLlmTarget } from "@/sse/services/publicLlmTarget.js";
import { ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";

const KIND_ENDPOINT = {
  llm: "/v1/chat/completions",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions",
  webSearch: "/v1/search",
  webFetch: "/v1/fetch",
  video: "/v1/videos/generations",
};

const TTS_VOICES_API = new Set(["elevenlabs", "edge-tts", "deepgram", "inworld", "local-device"]);

function buildInfo({ alias, providerId, model, kind, providerInfo }) {
  const out = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
  };
  if (model.params) out.params = model.params;
  if (model.capabilities) out.capabilities = model.capabilities;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (model.contextWindow) out.contextWindow = model.contextWindow;
  if (kind === "tts" && TTS_VOICES_API.has(providerId)) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig;
    if (cfg.searchTypes) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions) out.required = cfg.requiredOptions;
  }
  return out;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
function lookup(fullId, requestedKind) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId];

  // PROVIDER_MODELS lookup (by alias key, fallback to providerId)
  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = requestedKind
    ? list.find((x) => x.id === modelId && getModelKind(x, "llm") === requestedKind)
    : list.find((x) => x.id === modelId);
  if (m) {
    const kind = getModelKind(m, "llm");
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }

  // Web search/fetch — virtual model id "search" / "fetch"
  if (modelId === "search" && providerInfo?.searchConfig) {
    return buildInfo({
      alias, providerId, kind: "webSearch", providerInfo,
      model: { id: "search", name: `${providerInfo.name} Search`, params: ["query", "max_results", "country", "language", "time_range", "domain_filter", "search_type"] },
    });
  }
  if (modelId === "fetch" && providerInfo?.fetchConfig) {
    return buildInfo({
      alias, providerId, kind: "webFetch", providerInfo,
      model: { id: "fetch", name: `${providerInfo.name} Fetch`, params: ["url", "format", "max_characters"] },
    });
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/models/info?id={alias}/{modelId} — metadata for a single model
export async function GET(request) {
  try {
    return await withApiKeyCatalogPolicy(request, (key) => getModelInfo(request, key));
  } catch {
    return Response.json({ error: { message: "Unable to load model information.", type: "server_error" } }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
}

async function getModelInfo(request, key) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/dall-e-3)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  let info = null;
  let target = null;
  const rawInfo = lookup(id, kind);
  const nativeMedia = rawInfo && !["llm", "imageToText"].includes(rawInfo.kind);
  try {
    target = await resolvePublicLlmTarget(id);
  } catch (error) {
    if (!(error instanceof ApiKeyPolicyError && ((error.status === 403 && error.code === "direct_model_not_allowed") || (error.status === 400 && nativeMedia)))) {
      if (error instanceof ApiKeyPolicyError && [400, 403, 404].includes(error.status)) {
        return Response.json({ error: { message: error.status === 400 ? "Invalid public model identifier." : "Public model not found.", type: error.code } }, { status: error.status, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      throw error;
    }
  }
  const keyAccess = await getKeyAccessContext(request);
  if (target) {
    if (kind && kind !== "llm" && kind !== "imageToText") return Response.json({ error: { message: "Virtual model is not available for this kind.", type: "invalid_request" } }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
    info = (await buildPublicLlmModelsList({ policy: key, keyAccess })).find((model) => model.id === target.publicId && (kind !== "imageToText" || model.capabilities?.vision)) || null;
    if (info) info = { ...info, name: target.name, kind: "llm", endpoint: KIND_ENDPOINT.llm };
  } else if (nativeMedia) {
    info = (await filterModelsListForKey(keyAccess, await filterCatalogModels(key, [rawInfo])))[0] || null;
  }
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
