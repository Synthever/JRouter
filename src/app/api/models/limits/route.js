import { NextResponse } from "next/server";
import { getAutoCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { MAX_OVERRIDE_TOKENS, getLimitOverride, listLimitOverrides, setLimitOverride } from "open-sse/providers/limitOverride.js";
import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";

export const dynamic = "force-dynamic";

// Model keys travel as "provider/model" in the local provider id space — the
// same pair the runtime resolves, not the dashboard alias a combo displays. The
// split is on the first slash so model ids that keep their own namespace
// ("openrouter/zai-org/glm-4.6v:free") stay intact.
function parseModelKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return null;
  return { id: key, provider: key.slice(0, slash), model: key.slice(slash + 1) };
}

// GET /api/models/limits?models=codex/gpt-6-luna,antigravity/gemini-3.8-flash-high
// Answers with the pin stored for each requested model plus the value the
// automatic resolution would produce — the fallback the dashboard shows next to
// the input. Without a "models" list it lists every pin on file.
export async function GET(request) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const raw = new URL(request.url).searchParams.get("models") || "";
    const keys = raw.split(",").map((value) => parseModelKey(value)).filter(Boolean);

    if (!keys.length) {
      return NextResponse.json({ pins: listLimitOverrides(), overrides: {}, auto: {} });
    }

    const overrides = {};
    const auto = {};
    for (const { id, provider, model } of keys) {
      overrides[id] = getLimitOverride(provider, model);
      const caps = getAutoCapabilitiesForModel(provider, model);
      auto[id] = { contextWindow: caps.contextWindow || null, maxOutput: caps.maxOutput || null };
    }
    return NextResponse.json({ overrides, auto });
  } catch (error) {
    console.log("Error reading model limits:", error);
    return NextResponse.json({ error: "Failed to read model limits" }, { status: 500 });
  }
}

// PUT /api/models/limits
// body: { updates: [{ model: "codex/gpt-6-luna", contextWindow: 1050000, maxOutput: null }] }
// A number pins the field, null clears it back to auto, and a field left out
// keeps its stored value. Clearing every field drops the pin.
export async function PUT(request) {
  if (!(await canManageApiKeys(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (!updates.length) return NextResponse.json({ error: "updates[] required" }, { status: 400 });
    if (updates.length > 100) return NextResponse.json({ error: "too many updates (max 100)" }, { status: 400 });

    for (const update of updates) {
      if (!parseModelKey(update?.model)) {
        return NextResponse.json({ error: `Invalid model key: ${update?.model}` }, { status: 400 });
      }
      for (const field of ["contextWindow", "maxOutput"]) {
        if (!(field in update) || update[field] == null) continue;
        const tokens = Number(update[field]);
        if (!Number.isInteger(tokens) || tokens <= 0 || tokens > MAX_OVERRIDE_TOKENS) {
          return NextResponse.json(
            { error: `${field} must be a whole number of tokens between 1 and ${MAX_OVERRIDE_TOKENS}` },
            { status: 400 },
          );
        }
      }
    }

    const overrides = {};
    for (const update of updates) {
      const patch = {};
      if ("contextWindow" in update) patch.contextWindow = update.contextWindow;
      if ("maxOutput" in update) patch.maxOutput = update.maxOutput;
      const { id, provider, model } = parseModelKey(update.model);
      setLimitOverride(provider, model, patch);
      overrides[id] = getLimitOverride(provider, model);
    }
    return NextResponse.json({ success: true, overrides });
  } catch (error) {
    console.log("Error updating model limits:", error);
    return NextResponse.json({ error: "Failed to update model limits" }, { status: 500 });
  }
}
