import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { sanitizeApiKey, validateKeySettings } from "@/lib/apiKeyPolicy/settings.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(request) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const keys = await getApiKeys();
    // Existing CLI setup screens explicitly need credentials. The key-settings
    // screen requests the sanitized view and never stores existing secrets.
    const sanitized = new URL(request.url).searchParams.get("view") === "settings";
    return NextResponse.json({ keys: sanitized ? keys.map(sanitizeApiKey) : keys }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    try { validateKeySettings({ name }); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
