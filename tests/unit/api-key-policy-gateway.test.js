import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const ref = vi.hoisted(() => ({ db: null, settings: { requireApiKey: false } }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ref.db }));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings: async () => ref.settings }));
vi.mock("@/lib/db/repos/pricingRepo.js", () => ({ getPricingForModel: async () => ({ input: 1, output: 2 }) }));
import { withApiKeyPolicy } from "@/lib/apiKeyPolicy/gateway.js";
import { updateApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getApiKeyPolicyContext, assertCurrentModelAllowed } from "@/lib/apiKeyPolicy/context.js";
import { saveRequestUsage } from "@/lib/db/repos/usageRepo.js";
import { POST as geminiPost } from "@/app/api/v1beta/models/[...path]/route.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { GET as geminiModels } from "@/app/api/v1beta/models/route.js";

let db;
function request(body = { model: "openai/gpt-4", messages: [{ role: "user", content: "Hi" }], max_tokens: 10 }, headers = { Authorization: "Bearer secret" }, path = "/api/v1/chat/completions") {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const success = async () => Response.json({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } });
beforeEach(async () => {
  db = await createNodeSqliteAdapter(":memory:"); ref.db = db; ref.settings = { requireApiKey: false };
  for (const [name, table] of Object.entries(TABLES)) db.exec(buildCreateTableSql(name, table));
  db.run("INSERT INTO apiKeys(id,key,name,createdAt) VALUES('id','secret','legacy','2026-01-01')");
});
afterEach(() => db.close());
async function configure(policy) { await updateApiKey("id", policy); }

describe("gateway API-key enforcement", () => {
  it("applies the access allow-list to Gemini discovery without inference", async () => {
    await configure({ access: { restricted: true, allow: ["openai/gpt-4o"] } });
    const response = await geminiModels(new Request("http://localhost/v1beta/models", { headers: { Authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.models.map((model) => model.name)).toEqual(["models/openai/gpt-4o"]);
    expect(db.get("SELECT COUNT(*) AS count FROM apiKeyRequests").count).toBe(0);
  });
  it("allows legacy and optional local requests", async () => {
    expect((await withApiKeyPolicy(request(), success)).status).toBe(200);
    expect((await withApiKeyPolicy(request(undefined, {}), success)).status).toBe(200);
  });
  it("rejects expired keys even when requireApiKey is off", async () => {
    await configure({ expiresAt: "2020-01-01T00:00:00Z" });
    const response = await withApiKeyPolicy(request(), success);
    expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("api_key_expired");
  });
  it("rejects invalid credentials even in optional mode", async () => {
    expect((await withApiKeyPolicy(request(undefined, { Authorization: "Bearer invalid" }), success)).status).toBe(401);
  });
  it("requires credentials when configured", async () => {
    ref.settings = { requireApiKey: true }; expect((await withApiKeyPolicy(request(undefined, {}), success)).status).toBe(401);
  });
  it("enforces endpoint permissions and deny-all", async () => {
    await configure({ allowedEndpoints: ["chat"] });
    expect((await withApiKeyPolicy(request(undefined, undefined, "/api/v1/embeddings"), success)).status).toBe(403);
    expect((await withApiKeyPolicy(request(), success)).status).toBe(200);
    await configure({ allowedEndpoints: [] }); expect((await withApiKeyPolicy(request(), success)).status).toBe(403);
  });
  it("allows a whitelisted model and blocks blacklist priority", async () => {
    await configure({ allowedModels: ["openai/gpt-4"] }); expect((await withApiKeyPolicy(request(), success)).status).toBe(200);
    await configure({ blockedModels: ["gpt-4"] });
    const response = await withApiKeyPolicy(request(), success); expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("model_not_allowed");
  });
  it.each([
    { path: "/api/v1/search", operation: "search", payload: { provider: "exa", query: "Hi" } },
    { path: "/api/v1/web/fetch", operation: "fetch", payload: { provider: "exa", url: "https://example.com" } },
  ])("matches provider-only web requests to their catalog model $operation", async ({ path, operation, payload }) => {
    await configure({ allowedModels: [`exa/${operation}`] });
    const response = await withApiKeyPolicy(request(payload, undefined, path), async () => {
      assertCurrentModelAllowed("exa", { provider: "exa", model: operation });
      return success();
    });
    expect(response.status).toBe(200);
    await response.text();
    await configure({ blockedModels: [`exa/${operation}`] });
    expect((await withApiKeyPolicy(request(payload, undefined, path), success)).status).toBe(403);
  });
  it("uses the web handler's provider precedence when model is also present", async () => {
    await configure({ allowedModels: ["exa"] });
    const response = await withApiKeyPolicy(request({ provider: "exa", model: "unselected", query: "Hi" }, undefined, "/api/v1/search"), success);
    expect(response.status).toBe(200);
    await response.text();
  });
  it("prevents alias and combo resolution from bypassing blocked models", async () => {
    await configure({ allowedModels: ["production"], blockedModels: ["gpt-blocked"] });
    const response = await withApiKeyPolicy(request({ model: "production", max_tokens: 10 }), async () => {
      assertCurrentModelAllowed("production", { provider: "openai", model: "gpt-blocked" });
      return success();
    });
    expect(response.status).toBe(403);
  });
  it("does not grant a whitelisted solo model's capacity adapter access to other models", async () => {
    await configure({ allowedModels: ["openai/gpt-4"] });
    const response = await withApiKeyPolicy(request(), async () => {
      assertCurrentModelAllowed("anthropic/claude-sonnet", { provider: "anthropic", model: "claude-sonnet" });
      return success();
    });
    expect(response.status).toBe(403);
  });
  it("caps omitted output tokens before forwarding and rejects explicit excessive limits", async () => {
    await configure({ maxOutputTokens: 20 });
    const response = await withApiKeyPolicy(request({ model: "openai/gpt-4", messages: [] }), async (req) => { expect((await req.json()).max_tokens).toBe(20); return success(); });
    expect(response.status).toBe(200);
    expect((await withApiKeyPolicy(request({ model: "openai/gpt-4", max_completion_tokens: 21 }), success)).status).toBe(400);
  });
  it("counts actual multiplied usage while retaining raw analytics", async () => {
    await configure({ tokenMultiplier: 2, maxTokensQuota: 100 });
    const response = await withApiKeyPolicy(request(), async () => {
      expect(getApiKeyPolicyContext().apiKeyId).toBe("id");
      await saveRequestUsage({ provider: "openai", model: "gpt-4", apiKey: "secret", tokens: { prompt_tokens: 5, completion_tokens: 3 } });
      return success();
    });
    await response.text();
    expect(db.get("SELECT quotaTokens FROM apiKeys WHERE id='id'").quotaTokens).toBe(16);
    expect(db.get("SELECT promptTokens,completionTokens,apiKey FROM usageHistory")).toMatchObject({ promptTokens: 5, completionTokens: 3, apiKey: "id" });
  });
  it("settles streaming usage when the body completes", async () => {
    const response = await withApiKeyPolicy(request(), async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n')); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } }));
    expect(await response.text()).toContain("[DONE]");
    expect(db.get("SELECT quotaTokens FROM apiKeys WHERE id='id'").quotaTokens).toBe(8);
    expect(db.get("SELECT isPending FROM apiKeyRequests").isPending).toBe(0);
  });
  it("accounts usage on large media responses without buffering their payload", async () => {
    const response = await withApiKeyPolicy(request(), async () => Response.json({ data: [{ b64_json: "a".repeat(2 * 1024 * 1024) }], usage: { input_tokens: 7, output_tokens: 4 } }));
    await response.text();
    expect(db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(11);
  });
  it("retains the key context for asynchronous stream usage callbacks", async () => {
    await configure({ tokenMultiplier: 2 });
    const response = await withApiKeyPolicy(request(), async () => new Response(new ReadableStream({
      async pull(controller) {
        expect(getApiKeyPolicyContext().apiKeyId).toBe("id");
        await saveRequestUsage({ provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 7, completion_tokens: 4 } });
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    await response.text();
    expect(db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(22);
    expect(db.get("SELECT apiKey FROM usageHistory").apiKey).toBe("id");
  });
  it("counts separate requests even when analytics deduplicates their equal usage entries", async () => {
    for (let index = 0; index < 2; index++) {
      const response = await withApiKeyPolicy(request(), async () => {
        await saveRequestUsage({ timestamp: "2026-10-07T12:00:00Z", provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 5, completion_tokens: 3 } });
        // Existing client formatting adds a context buffer after raw usage is saved.
        return Response.json({ usage: { prompt_tokens: 2005, completion_tokens: 3 } });
      });
      await response.text();
    }
    expect(db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(16);
  });
  it("returns the policy error when every combo member is denied", async () => {
    await configure({ blockedModels: ["gpt-blocked"] });
    const response = await withApiKeyPolicy(request({ model: "production", max_tokens: 10 }), () => handleComboChat({
      body: {}, models: ["openai/gpt-blocked"], log: { info() {}, warn() {}, error() {}, debug() {} },
      handleSingleModel: async () => { assertCurrentModelAllowed("openai/gpt-blocked", { provider: "openai", model: "gpt-blocked" }); return success(); },
    }));
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("model_not_allowed");
  });
  it.each([
    { path: "gemini-3.1-flash-tts-preview:generateContent", body: { contents: [] } },
    { path: "gemini-2.5-flash:generateContent", body: { contents: [], generationConfig: { responseModalities: ["audio"] } } },
  ])("enforces Audio permissions on native Gemini requests %j", async ({ path, body }) => {
    await configure({ allowedEndpoints: ["chat"] });
    const response = await geminiPost(request(body, undefined, `/api/v1beta/models/${path}`), { params: Promise.resolve({ path: [path] }) });
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("endpoint_not_allowed");
  });
  it("releases quota reservation after an upstream failure", async () => {
    await configure({ maxTokensQuota: 50 });
    const response = await withApiKeyPolicy(request(), async () => new Response("failed", { status: 502 }));
    await response.text(); expect(db.get("SELECT isPending FROM apiKeyRequests").isPending).toBe(0);
    expect(db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(0);
  });
  it("supports Google key headers without exposing them in errors", async () => {
    expect((await withApiKeyPolicy(request(undefined, { "x-goog-api-key": "secret" }), success)).status).toBe(200);
  });
  it("rejects expired credentials on model discovery", async () => {
    await configure({ expiresAt: "2020-01-01T00:00:00Z" });
    const response = await geminiModels(new Request("http://localhost/api/v1beta/models", { headers: { "x-goog-api-key": "secret" } }));
    expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("api_key_expired");
  });
  it("filters model discovery by canonical whitelist and blacklist", async () => {
    await configure({ allowedModels: ["gemini/*"], blockedModels: ["gemini-2.5-flash"] });
    const response = await geminiModels(new Request("http://localhost/api/v1beta/models?key=secret"));
    const { models } = await response.json();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((model) => model.name === "models/gemini/gemini-2.5-flash" || model.name === "models/gemini-2.5-flash")).toBe(false);
    expect(models.every((model) => model.name.startsWith("models/gemini/") || model.name.startsWith("models/gemini-"))).toBe(true);
  });
});
