import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { getApiKeyPolicyContext } from "@/lib/apiKeyPolicy/context.js";
import { buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";

export async function GET(request) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const policy = getApiKeyPolicyContext()?.policy || null;
    return Response.json({ models: await buildPublicLlmModelsList({ policy, dashboard: true }) });
  } catch {
    return Response.json({ error: "Unable to load public models." }, { status: 500 });
  }
}
