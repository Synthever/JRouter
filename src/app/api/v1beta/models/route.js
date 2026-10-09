import { PROVIDER_MODELS } from "@/shared/constants/models";
import { withApiKeyCatalogPolicy, filterCatalogModels } from "@/lib/apiKeyPolicy/catalog.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  return withApiKeyCatalogPolicy(request, (key) => getModels(request, key));
}

async function getModels(request, key) {
  try {
    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"] }) {
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
          });
        }
      }
    }

    const permitted = await filterCatalogModels(key, models, (model) => model.name);
    const entries = permitted.map((model) => ({ ...model, id: model.name.replace(/^models\//, "") }));
    const filtered = await filterModelsListForKey(await getKeyAccessContext(request), entries);
    return Response.json({ models: filtered.map(({ id: _id, ...model }) => model) });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
