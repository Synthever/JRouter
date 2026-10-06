import { getApiKeyById } from "@/lib/localDb";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";

// Explicit Copy action, separate from sanitized settings and list responses.
export async function GET(request, { params }) {
  if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const key = await getApiKeyById(id);
  if (!key) return Response.json({ error: "Key not found" }, { status: 404 });
  return Response.json({ key: key.key }, { headers: { "Cache-Control": "no-store" } });
}
