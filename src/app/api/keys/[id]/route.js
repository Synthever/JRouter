import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { sanitizeApiKey, validateKeySettings } from "@/lib/apiKeyPolicy/settings.js";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: sanitizeApiKey(key) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PATCH(request, { params }) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    let updateData;
    try { updateData = validateKeySettings(await request.json()); }
    catch (error) { return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid JSON body" : error.message }, { status: 400 }); }

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updated = await updateApiKey(id, updateData);
    if (!updated) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key: sanitizeApiKey(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

export const PUT = PATCH;

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
