import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { HealthError } from "./service.js";

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function authorizeHealth(request) {
  if (!await canManageApiKeys(request)) throw new HealthError("Dashboard authentication required", 401);
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin) {
    // Next.js can normalize request.url to localhost behind its internal server.
    const host = request.headers.get("host") || new URL(request.url).host;
    let valid = false;
    try { const parsed = new URL(origin); valid = ["http:", "https:"].includes(parsed.protocol) && parsed.host.toLowerCase() === host.toLowerCase(); } catch {}
    if (!valid) throw new HealthError("Cross-origin health changes are not allowed", 403);
  }
}

export function healthRoute(handler) {
  return async (request) => {
    try { await authorizeHealth(request); return await handler(request); }
    catch (error) { return json({ error: error instanceof HealthError ? error.message : "Health monitoring is temporarily unavailable" }, error instanceof HealthError ? error.status : 500); }
  };
}

export function modelIdFrom(request) {
  const id = new URL(request.url).searchParams.get("modelId");
  if (!id || id.length > 512) throw new HealthError("A valid modelId is required");
  return id;
}

export function rangeFrom(request) { return new URL(request.url).searchParams.get("range") || "3d"; }

export async function bodyFrom(request) {
  const text = await request.text();
  if (text.length > 16384) throw new HealthError("Health request is too large", 413);
  try { return JSON.parse(text); } catch { throw new HealthError("Invalid JSON request"); }
}
