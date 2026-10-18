import { describe, it, expect } from "vitest";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";

describe("openrouter migration final", () => {
  it("surfaces moved models via dashboard /api/models", async () => {
    const cliToken = await getConsistentMachineId("9r-cli-auth");
    const res = await fetch("http://127.0.0.1:20128/api/models", { headers: { "x-9r-cli-token": cliToken } });
    const j = await res.json();
    const groups = Array.isArray(j.models) ? j.models : Object.values(j.models || {});
    const orModels = groups.filter((g) => g.provider === "openrouter").map((g) => g.model);
    for (const w of ["deepseek/deepseek-v4.1-flash-1017", "qwen/qwen3-coder:free", "nvidia/nemotron-3-ultra-550b-a55b:free"]) {
      expect(orModels).toContain(w);
    }
  });

  it("serves inference through the native provider", async () => {
    const key = process.env.HERMES_CUSTOM_127_0_0_1_20128_API_KEY;
    const chat = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "openrouter/deepseek/deepseek-v4.1-flash-1017", stream: false, max_tokens: 6, messages: [{ role: "user", content: "Reply: PONG" }] }),
    });
    expect(chat.status).toBe(200);
  });
});
