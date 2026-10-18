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
