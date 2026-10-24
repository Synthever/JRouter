import { NextResponse } from "next/server";
import {
  getDashboardKpiLayout, saveDashboardKpiLayout, clearDashboardKpiLayout,
} from "@/lib/db/repos/dashboardLayoutRepo.js";
import { sanitizeKpiLayout } from "@/shared/constants/dashboardKpi.js";

// Layout changes must be read per request; never prerender or cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// The dashboard proxy denies unauthenticated /api/* by default, so the handler
// only owns validation, canonicalization and error shape.
export async function GET() {
  try {
    const stored = await getDashboardKpiLayout();
    return NextResponse.json(
      { layout: stored ? stored.layout : null, updatedAt: stored ? stored.updatedAt : null },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.log("Error reading dashboard layout:", error);
    return NextResponse.json({ error: "Failed to load layout" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function PUT(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    // A malformed body is the same client error as a non-array layout.
  }
  if (!Array.isArray(body?.layout)) {
    return NextResponse.json({ error: "Invalid layout" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const saved = await saveDashboardKpiLayout(sanitizeKpiLayout(body.layout));
    return NextResponse.json(
      { layout: saved.layout, updatedAt: saved.updatedAt },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.log("Error saving dashboard layout:", error);
    return NextResponse.json({ error: "Failed to save layout" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function DELETE() {
  try {
    await clearDashboardKpiLayout();
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error resetting dashboard layout:", error);
    return NextResponse.json({ error: "Failed to reset layout" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
