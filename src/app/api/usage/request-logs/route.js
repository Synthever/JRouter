import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "text";
    const logs = await getRecentLogs(format === "json" ? 30 : 200, { format });
    return NextResponse.json(logs, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
