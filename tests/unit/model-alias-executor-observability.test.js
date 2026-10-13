import { describe, expect, it } from "vitest";
import * as executors from "open-sse/executors/index.js";

function observability(provider) {
  expect(executors.getExecutorOutputObservability).toBeTypeOf("function");
  return executors.getExecutorOutputObservability(provider);
}

describe("alias JSON executor output observability", () => {
  it("describes canonical and registry aliases of accepted semantic-output paths", () => {
    for (const [id, alias] of [["kiro", "kr"], ["commandcode", "cmc"], ["codex", "cx"], ["github", "gh"], ["codebuddy-intl", "cbai"], ["codebuddy-cn", "cbcn"], ["gemini-cli", "gc"], ["grok-cli", "grok-build"], ["vertex", "vx"], ["vertex-partner", "vxp"], ["xiaomi-mimo", "mimo-desktop"], ["mimo-free", "mmf"]]) {
      expect(observability(id), id).toBe("incremental");
      expect(observability(alias), alias).toBe("incremental");
    }
  });
  it("inherits raw Base and Default visibility for generic and compatible transports", () => {
    for (const provider of ["openai", "claude", "gemini", "ollama", "ollama-local", "antigravity", "azure", "iflow", "kimchi", "opencode", "opencode-go", "opencode-zen", "xiaomi-tokenplan", "minimax-code", "minimax-code-global", "openai-compatible-fixture", "anthropic-compatible-fixture", "unknown-default-fixture"]) {
      expect(observability(provider), provider).toBe("incremental");
    }
  });
  it("keeps Cursor conservative despite the incremental AgentService branch", () => {
    expect(observability("cursor")).toBe("buffered");
    expect(observability("cu")).toBe("buffered");
  });
  it("does not advertise unforced specialized JSON branches as incremental", () => {
    for (const provider of ["grok-web", "gw", "perplexity-web", "pw", "bedrock", "br", "aws-bedrock", "bedrock-xai", "brx", "bedrock-grok", "zed", "zd"]) {
      expect(observability(provider), provider).toBe("buffered");
    }
  });
  it("describes Qoder's always-SSE output without certifying its reader safety", () => {
    for (const provider of ["qoder", "qd", "qoder-cn", "qdcn"]) expect(observability(provider)).toBe("incremental");
  });
  it("does not certify dormant executor paths or replace the active tr alias", () => {
    for (const provider of ["trae", "windsurf", "devin-cli"]) expect(observability(provider)).toBe("buffered");
    expect(observability("tr")).toBe("incremental");
  });
  it("leaves executor dispatch identity and caching unchanged", () => {
    const cursor = executors.getExecutor("cursor");
    const cu = executors.getExecutor("cu");
    const custom = executors.getExecutor("openai-compatible-fixture");
    observability("cu");
    observability("openai-compatible-fixture");
    expect(executors.getExecutor("cursor")).toBe(cursor);
    expect(executors.getExecutor("cu")).toBe(cu);
    expect(cu).not.toBe(cursor);
    expect(executors.getExecutor("openai-compatible-fixture")).toBe(custom);
    expect(executors.hasSpecializedExecutor("openai-compatible-fixture")).toBe(false);
  });
});
