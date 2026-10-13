import { NextResponse } from "next/server";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  if (!await canManageApiKeys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm", undefined, { request });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
