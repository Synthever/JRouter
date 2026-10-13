import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { getModelsAliasById } from "@/lib/db/repos/modelsAliasesRepo.js";
import { getModelsAliasConfigKey, normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { resolveAliasMembers } from "@/lib/modelsAliases/members.js";
import { getModelsAliasRuntimeStatus, resetModelsAliasRuntimeOrder } from "@/sse/services/modelsAliasRuntime.js";

export async function POST(request, { params }) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.configVersion !== "string" || !body.configVersion) {
      return Response.json({ error: "configVersion string required" }, { status: 400 });
    }
    const { id } = await params;
    const alias = await getModelsAliasById(id);
    if (!alias) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    try {
      normalizeModelsAliasConfig(alias);
    } catch {
      return Response.json({ error: "Invalid Models Alias configuration" }, { status: 400 });
    }
    await resolveAliasMembers(alias.models);
    const latest = await getModelsAliasById(id);
    if (!latest) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    if (getModelsAliasConfigKey(latest) !== getModelsAliasConfigKey(alias)) return Response.json({ error: "Models Alias configuration changed; reload runtime status" }, { status: 409 });
    const current = getModelsAliasRuntimeStatus(latest);
    if (body.configVersion !== current.configVersion) return Response.json({ error: "Models Alias configuration changed; reload runtime status" }, { status: 409 });
    resetModelsAliasRuntimeOrder(latest);
    return Response.json(getModelsAliasRuntimeStatus(latest));
  } catch (error) {
    if (/^(Ambiguous provider prefix: |Unknown configured provider: |Member is not an LLM (provider|model): |Invalid compatible provider identity: |Provider is not configured: |Unknown LLM model: )/.test(error?.message || "")) {
      return Response.json({ error: "Models Alias members are invalid or unavailable" }, { status: 400 });
    }
    return Response.json({ error: "Failed to reset Models Alias runtime" }, { status: 500 });
  }
}
