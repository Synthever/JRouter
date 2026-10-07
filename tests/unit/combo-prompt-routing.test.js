import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ combo: null, nested: null, settings: {}, calls: [], failFirst: false }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/apiKeyPolicy/gateway.js", () => ({ withApiKeyPolicy: (request, handler) => handler(request) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => state.settings, getComboByName: async (name) => name === state.combo?.name ? state.combo : name === state.nested?.name ? state.nested : null }));
vi.mock("@/sse/services/model.js", () => ({
  getComboModels: async (name) => name === state.combo?.name ? state.combo.models : name === state.nested?.name ? state.nested.models : null,
  getModelInfo: async (name) => name.includes("/") ? { provider: name.split("/")[0], model: name.split("/")[1] } : { provider: null, model: name },
}));
vi.mock("@/sse/services/auth.js", () => ({ getProviderCredentials: async () => ({ connectionId: "test" }), markAccountUnavailable: async () => false, clearAccountError: async () => {}, extractApiKey: () => null, isValidApiKey: async () => true }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: async () => {}, checkAndRefreshToken: async (provider, credentials) => credentials }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: async (options) => {
  state.calls.push(options);
  if (state.failFirst && state.calls.length === 1) return { success: false, status: 400, error: "failure" };
  return { success: true, response: Response.json({ choices: [{ message: { content: "answer" } }] }) };
} }));
import { handleChat } from "@/sse/handlers/chat.js";

beforeEach(() => {
  state.combo = { name: "smart", models: ["openai/actual", "openai/backup"], promptInjectionEnabled: true, promptInjectionMode: "prepend", systemPrompt: "Persona {{display_name}} for {{requested_model}}", displayIdentity: "Support" };
  state.settings = {};
  state.nested = null;
  state.calls = [];
  state.failFirst = false;
});
const send = (body, endpoint = "chat/completions") => handleChat(new Request(`http://localhost/v1/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "smart", stream: false, ...body }) }));

describe("combo prompt gateway integration", () => {
  it("composes nested behavior with the original requested model", async () => {
    state.combo.models = ["inner"];
    state.nested = { name: "inner", models: ["openai/actual"], promptInjectionEnabled: true, promptInjectionMode: "append", systemPrompt: "Inner {{combo_name}} for {{requested_model}}" };
    await send({ messages: [{ role: "user", content: "Hello" }] });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].body.messages).toEqual([{ role: "system", content: "Persona Support for smart" }, { role: "system", content: "Inner inner for smart" }, { role: "user", content: "Hello" }]);
  });
  it.each(["fallback", "round-robin", "fusion"])("applies behavior through %s routing while recording actual upstream models", async (strategy) => {
    state.settings.comboStrategies = { smart: { fallbackStrategy: strategy } };
    expect((await send({ messages: [{ role: "user", content: "Hello" }] })).status).toBe(200);
    expect(state.calls.length).toBeGreaterThan(0);
    for (const options of state.calls) {
      expect(options.body.messages[0]).toEqual({ role: "system", content: "Persona Support for smart" });
      expect(options.modelInfo.provider).toBe("openai");
      expect(["actual", "backup"]).toContain(options.modelInfo.model);
      expect(options.body.model).toBe(`openai/${options.modelInfo.model}`);
      expect(options.clientRawRequest.body.model).toBe("smart");
      expect(options.clientRawRequest.body.messages[0].role).toBe("user");
    }
  });
  it("keeps retry and fallback injections from accumulating", async () => {
    state.failFirst = true;
    await send({ messages: [{ role: "user", content: "Hello" }] });
    expect(state.calls).toHaveLength(2);
    for (const options of state.calls) expect(options.body.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });
  it("uses the same pipeline for Responses and Claude requests", async () => {
    await send({ input: "Hello", instructions: "Client" }, "responses");
    expect(state.calls[0].body.input[0].content).toBe("Persona Support for smart");
    state.calls = [];
    await send({ messages: [{ role: "user", content: "Hello" }] }, "messages");
    expect(state.calls[0].body.system[0].text).toBe("Persona Support for smart");
  });
  it("leaves disabled combos and direct models unchanged", async () => {
    state.combo.promptInjectionEnabled = false;
    await send({ messages: [{ role: "user", content: "Hello" }] });
    await send({ model: "openai/actual", messages: [{ role: "user", content: "Hello" }] });
    for (const options of state.calls) expect(options.body.messages).toHaveLength(1);
  });
});
