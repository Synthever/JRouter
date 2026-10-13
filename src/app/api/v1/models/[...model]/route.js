import { buildModelsList } from "../route.js";
import { withApiKeyCatalogPolicy, filterCatalogModels } from "@/lib/apiKeyPolicy/catalog.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import { buildPublicLlmModelsList, filterPublicLlmModelsByCapability } from "@/sse/services/publicLlmCatalog.js";
import { resolvePublicLlmTarget } from "@/sse/services/publicLlmTarget.js";
import { ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";
import { PROVIDER_MODELS, getModelKind } from "@/shared/constants/models";
import { ALIAS_TO_ID } from "@/shared/constants/providers";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  image: ["image"], tts: ["tts"], stt: ["stt"], embedding: ["embedding"],
  "image-to-text": ["imageToText"], web: ["webSearch", "webFetch"], video: ["video"],
};
const MEDIA_KINDS = ["image", "tts", "stt", "embedding", "webSearch", "webFetch", "video"];

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function json(data, options = {}) {
  return Response.json(data, { ...options, headers: { "Access-Control-Allow-Origin": "*", ...options.headers } });
}

export async function GET(request, { params }) {
  try {
    return await withApiKeyCatalogPolicy(request, (key) => getModel(request, params, key));
  } catch {
    return json({ error: { message: "Unable to load model.", type: "server_error" } }, { status: 500 });
  }
}

async function getModel(request, params, key) {
  const { model } = await params;
  const path = Array.isArray(model) ? model : [model];
  const identifier = path.filter(Boolean).join("/");
  const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;
  const keyAccess = await getKeyAccessContext(request);
  if (kindFilter) {
    if (identifier === "image-to-text") {
      const models = await buildPublicLlmModelsList({ policy: key, keyAccess });
      return json({ object: "list", data: filterPublicLlmModelsByCapability(models, "imageToText") });
    }
    const data = await filterModelsListForKey(keyAccess, await filterCatalogModels(key, await buildModelsList(kindFilter)));
    return json({ object: "list", data });
  }

  const slash = identifier.indexOf("/");
  const provider = identifier.slice(0, slash);
  const modelId = identifier.slice(slash + 1);
  const nativeMedia = (PROVIDER_MODELS[provider] || PROVIDER_MODELS[ALIAS_TO_ID[provider]] || []).some((model) => model.id === modelId && MEDIA_KINDS.includes(getModelKind(model, "llm")));
  let publicId = null;
  try {
    publicId = (await resolvePublicLlmTarget(identifier)).publicId;
  } catch (error) {
    if (!(error instanceof ApiKeyPolicyError && [400, 403, 404].includes(error.status))) throw error;
    if (error.status === 400 && !nativeMedia) return json({ error: { message: "Invalid public model identifier.", type: "invalid_request_error", code: "invalid_request" } }, { status: 400 });
  }
  if (publicId) {
    const models = await buildPublicLlmModelsList({ policy: key, keyAccess });
    const matched = models.find((candidate) => candidate.id === publicId);
    if (matched) return json(matched);
  } else if (!identifier.startsWith("jrouter/")) {
    const media = (await buildModelsList(MEDIA_KINDS)).filter((candidate) => candidate.id === identifier).map((candidate) => {
      const slash = candidate.id.indexOf("/");
      const provider = candidate.id.slice(0, slash);
      const id = candidate.id.slice(slash + 1);
      const metadata = (PROVIDER_MODELS[provider] || PROVIDER_MODELS[ALIAS_TO_ID[provider]] || []).find((model) => model.id === id && MEDIA_KINDS.includes(getModelKind(model, "llm")));
      return { ...candidate, ...(metadata ? { kind: getModelKind(metadata) } : {}) };
    });
    const permitted = await filterModelsListForKey(keyAccess, await filterCatalogModels(key, media));
    if (permitted.length) return json(permitted[0]);
  }
  return json({ error: { message: `The model '${identifier}' does not exist or you do not have access to it.`, type: "invalid_request_error", code: "model_not_found" } }, { status: 404 });
}
