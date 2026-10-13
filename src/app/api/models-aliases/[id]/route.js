import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { getModelsAliasById, updateModelsAlias, deleteModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { AliasComboNameConflict } from "@/lib/db/helpers/modelsAliasesNamespace.js";
import { getModelsAliasConfigKey, normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { invalidateModelsAliasRuntime } from "@/sse/services/modelsAliasRuntime.js";

export async function GET(request, { params }) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const alias = await getModelsAliasById(id);
    if (!alias) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    return Response.json(alias);
  } catch {
    return Response.json({ error: "Failed to fetch Models Alias" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid Models Alias configuration" }, { status: 400 });
    const { id } = await params;
    const previous = await getModelsAliasById(id);
    if (!previous) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    try {
      normalizeModelsAliasConfig({ ...previous, ...body });
    } catch {
      return Response.json({ error: "Invalid Models Alias configuration" }, { status: 400 });
    }
    const saved = await updateModelsAlias(id, body, { returnPreImage: true });
    if (!saved) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    const { preImage, alias } = saved;
    if (getModelsAliasConfigKey(preImage) !== getModelsAliasConfigKey(alias)) invalidateModelsAliasRuntime(id);
    return Response.json(alias);
  } catch (error) {
    if (error instanceof AliasComboNameConflict) return Response.json({ error: "Models Alias or Combo name already exists", code: error.code }, { status: 409 });
    if (/^(Ambiguous provider prefix: |Unknown configured provider: |Member is not an LLM (provider|model): |Invalid compatible provider identity: |Provider is not configured: |Unknown LLM model: |Models Alias members changed during validation;)/.test(error?.message || "")) {
      return Response.json({ error: "Models Alias members are invalid or unavailable" }, { status: 400 });
    }
    return Response.json({ error: "Failed to update Models Alias" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!(await deleteModelsAlias(id))) return Response.json({ error: "Models Alias not found" }, { status: 404 });
    invalidateModelsAliasRuntime(id);
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to delete Models Alias" }, { status: 500 });
  }
}
