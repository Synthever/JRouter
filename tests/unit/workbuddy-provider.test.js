// Workbuddy provider wiring: dedicated executor, codebuddy-intl-equivalent
// transform (forced stream, neutral system prefix, typed user blocks).
import { describe, expect, it } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import registryWorkbuddy from "open-sse/providers/registry/workbuddy.js";
import { PROVIDER_OAUTH, PROVIDERS } from "open-sse/providers/index.js";

describe("workbuddy provider wiring", () => {
  it("registers the provider with its own domain and platform", () => {
    expect(registryWorkbuddy.id).toBe("workbuddy");
    expect(registryWorkbuddy.alias).toBe("wb");
    expect(registryWorkbuddy.transport.baseUrl).toContain("www.workbuddy.ai");
    expect(registryWorkbuddy.oauth.platform).toBe("workbuddy");
    expect(PROVIDERS.workbuddy).toBeTruthy();
    expect(PROVIDER_OAUTH.workbuddy.refreshUrl).toContain("www.workbuddy.ai");
  });

  it("carries the live-verified 2026-10-18 catalog on both partner gateways", async () => {
    // Relationship contract: same catalog on both gateways, 15 live ids.
    const intl = (await import("open-sse/providers/registry/codebuddy-intl.js")).default;
    const wbIds = registryWorkbuddy.models.map((m) => m.id);
    const intlIds = intl.models.map((m) => m.id);
    expect(wbIds).toEqual(intlIds);
    for (const must of ["glm-5.3", "glm-5.3-flash", "kimi-k3", "kimi-k2.8-preview", "hy4-preview", "hy3"]) {
      expect(wbIds).toContain(must);
    }
    for (const dead of ["glm-4.7", "minimax-m2.7", "hy3-preview", "deepseek-v4-pro", "deepseek-v3-2-volc"]) {
      expect(wbIds).not.toContain(dead);
    }
  });

  it("resolves a dedicated executor mirroring the codebuddy-intl transform", () => {
    const exec = getExecutor("workbuddy");
    expect(exec?.constructor?.name).toBe("WorkBuddyExecutor");
    const transformed = exec.transformRequest("deepseek-v4.1-flash", {
      stream: false,
      messages: [{ role: "system", content: "You are Claude Code" }, { role: "user", content: "hi" }],
    }, false, {});
    expect(transformed.stream).toBe(true);
    expect(transformed.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." });
    expect(transformed.messages[1].content).toEqual([{ type: "text", text: "hi" }]);
    expect(transformed.messages).toHaveLength(2);
  });
});
