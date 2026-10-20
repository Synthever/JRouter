import { describe, expect, it, vi } from "vitest";

const NAMESPACE_404_MESSAGE =
  "Unknown virtual model namespace 'jrouter/' (Models Aliases is not active on this instance). Use a provider model, provider node or combo.";

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/apiKeyPolicy/gateway.js", () => ({ withApiKeyPolicy: (request, handler) => handler(request) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getComboByName: async () => null, getComboByPublicName: async () => null }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async () => {
    const err = new Error(NAMESPACE_404_MESSAGE);
    err.statusCode = 404;
    throw err;
  },
  getComboModels: async () => null,
  resolvePublicCombo: async () => null,
}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({ connectionId: "test" }),
  markAccountUnavailable: async () => false,
  clearAccountError: async () => {},
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: async () => {},
  checkAndRefreshToken: async (provider, credentials) => credentials,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: async () => ({ success: true, response: Response.json({ choices: [] }) }),
}));

import { handleChat } from "@/sse/handlers/chat.js";

describe("jrouter virtual namespace chat handling", () => {
  it("maps the namespace error to an honest 404 instead of a credential error", async () => {
    const res = await handleChat(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jrouter/zai/glm-5.3-flash", stream: false, messages: [{ role: "user", content: "hi" }] }),
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error?.message).toMatch(/namespace/i);
    expect(body.error?.message).not.toMatch(/credentials/i);
  });
});
