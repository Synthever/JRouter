import { buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    const models = await buildPublicLlmModelsList({ dashboard: true });
    return Response.json({ models: models.map((model) => ({
      name: model.id, model: model.id, id: model.id, capabilities: model.capabilities,
      ...(model.context_length ? { context_length: model.context_length } : {}),
      ...(model.max_completion_tokens ? { max_completion_tokens: model.max_completion_tokens } : {}),
    })) }, { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  } catch {
    return Response.json({ error: { message: "Unable to load models." } }, { status: 500, headers: CORS_HEADERS });
  }
}
