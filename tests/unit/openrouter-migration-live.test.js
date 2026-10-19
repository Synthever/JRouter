import { describe, it, expect } from "vitest";

const LIVE = process.env.JROUTER_LIVE === "1";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";

describe.skipIf(!LIVE)("openrouter migration final", () => {
  it("surfaces moved models via dashboard /api/models", async () => {
    const cliToken = await getConsistentMachineId("jr-cli-auth");
    const res = await fetch("http://127.0.0.1:20128/api/models", { headers: { "x-jr-cli-token": cliToken } });
    const j = await res.json();
    const groups = Array.isArray(j.models) ? j.models : Object.values(j.models || {});
    const orModels = groups.filter((g) => g.provider === "openrouter").map((g) => g.model);
    const want = ["nvidia/nemotron-3-ultra-550b-a55b:free"];
    for (const w of want) {
      expect(orModels).toContain(w);
    }
  });

  it("serves inference through the native provider", async () => {
    const key = process.env.JROUTER_LIVE_API_KEY;
    if (!key) {
      console.log("[live-gate] JROUTER_LIVE_API_KEY not set — skipping inference probe");
      return;
    }
    const chat = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openrouter/deepseek/deepseek-v4.1-flash-1017", stream: false, max_tokens: 6, messages: [{ role: "user", content: "Reply: PONG" }] }),
    });
    expect(chat.status).toBe(200);
  });
});
