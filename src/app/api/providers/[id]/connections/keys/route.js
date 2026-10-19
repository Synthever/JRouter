import { NextResponse } from "next/server";
import { getProviderConnections, getProviderNodeById } from "@/models";

// GET /api/providers/[id]/connections/keys — export every API-key connection's
// credential for this provider as JSON (dashboard-authenticated via the guard;
// the list endpoint strips secrets, this one exists precisely to return them).
// `id` here is the PROVIDER id (e.g. "commandcode" or a compatible node id).
export async function GET(request, { params }) {
  try {
    const { id: providerId } = await params;
    const connections = await getProviderConnections({ provider: providerId });

    let providerName = providerId;
    const node = await getProviderNodeById(providerId).catch(() => null);
    if (node?.name) providerName = node.name;

    const keys = connections
      .filter((c) => (c.authType || "apikey") === "apikey" && c.apiKey)
      .map((c) => ({
        name: c.name || c.email || c.displayName || `Key ${c.id.slice(0, 6)}`,
        apiKey: c.apiKey,
        isActive: c.isActive !== false,
        ...(c.priority ? { priority: c.priority } : {}),
      }));

    return NextResponse.json(
      {
        provider: providerId,
        providerName,
        exportedAt: new Date().toISOString(),
        count: keys.length,
        keys,
      },
      // Plaintext credentials must never land in a proxy/browser cache.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[keys-export] failed:", error);
    return NextResponse.json({ error: "Failed to export connection keys" }, { status: 500 });
  }
}
