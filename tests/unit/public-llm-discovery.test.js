import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const fixture = vi.hoisted(() => ({ db: null, session: false }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => fixture.db }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => fixture.session }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "fixture-cli-token" }));
import { createModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { createCombo } from "@/lib/db/repos/combosRepo.js";
import { setModelAlias } from "@/lib/db/repos/aliasRepo.js";
import { updateApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { setCatalogSource } from "open-sse/providers/capabilities.js";
import { GET as openai, OPTIONS as openaiOptions, buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as gemini, OPTIONS as geminiOptions } from "@/app/api/v1beta/models/route.js";
import { GET as tags } from "@/app/api/tags/route.js";
import { GET as modelLookup, OPTIONS as lookupOptions } from "@/app/api/v1/models/[...model]/route.js";
import { GET as modelInfo, OPTIONS as infoOptions } from "@/app/api/v1/models/info/route.js";
import { GET as publicCatalog } from "@/app/api/models/public/route.js";

const request = (path, headers = {}) => new Request(`http://router.test${path}`, { headers });
const keyed = (path) => request(path, { authorization: "Bearer discovery-key" });
const lookup = (id) => modelLookup(keyed(`/v1/models/${id}`), { params: Promise.resolve({ model: id.split("/") }) });
let alias;
let transport;
beforeEach(async () => {
  fixture.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) fixture.db.exec(buildCreateTableSql(name, table));
  fixture.db.run("INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", ["connection", "openai", "apikey", JSON.stringify({ accessToken: "private-account-token", baseUrl: "https://private-provider.test" }), "2026-01-01", "2026-01-01"]);
  fixture.db.run("INSERT INTO settings(id,data) VALUES(1,?)", [JSON.stringify({ requireLogin: true })]);
  fixture.db.run("INSERT INTO apiKeys(id,key,name,createdAt) VALUES(?,?,?,?)", ["key", "discovery-key", "catalog", "2026-01-01"]);
  alias = await createModelsAlias({ name: "deepseek/Flash", models: ["openai/gpt-4o"], primaryModel: "openai/gpt-4o", promptInjectionEnabled: true, systemPrompt: "private prompt" });
  await createCombo({ name: "Main", models: ["openai/gpt-4o"] });
  transport = vi.fn(() => { throw new Error("Unexpected discovery transport"); });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  fixture.db.close();
  fixture.session = false;
  setCatalogSource(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function expectNoUsage() {
  for (const table of ["apiKeyRequests", "usageHistory"]) expect(fixture.db.get(`SELECT COUNT(*) AS count FROM ${table}`).count).toBe(0);
  expect(fixture.db.get("SELECT quotaTokens FROM apiKeys WHERE id='key'").quotaTokens).toBe(0);
}

describe("connected canonical public LLM discovery", () => {
  it("publishes saved aliases and Combos across OpenAI Gemini Ollama and dashboard without changing raw discovery", async () => {
    const expected = ["jrouter/deepseek/Flash", "jrouter/Main"];
    await setModelAlias("LegacySingle", "openai/gpt-4o");
    const response = await openai(keyed("/v1/models"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.map((model) => model.id)).toEqual(expected);
    expect((await (await gemini(keyed("/v1beta/models"))).json()).models.filter((model) => model.name.startsWith("models/jrouter/")).map((model) => model.name)).toEqual(expected.map((id) => `models/${id}`));
    expect(await (await lookup(expected[0])).json()).toMatchObject({ id: expected[0], owned_by: "jrouter" });
    const info = await modelInfo(keyed("/v1/models/info?id=jrouter%2Fdeepseek%2FFlash"));
    expect(await info.json()).toMatchObject({ id: expected[0], kind: "llm" });
    fixture.session = true;
    const tagBody = await (await tags(request("/api/tags", { cookie: "auth_token=fixture" }))).json();
    expect(tagBody.models.map((model) => model.name)).toEqual(expected);
    expect(JSON.stringify(tagBody)).not.toMatch(/modified_at|digest|quantization|parameter_size|private-account-token/);
    const body = await (await publicCatalog(request("/api/models/public", { cookie: "auth_token=fixture", authorization: "Bearer discovery-key" }))).json();
    expect((await publicCatalog(request("/api/models/public", { authorization: "Bearer discovery-key" }))).status).toBe(401);
    expect(body.models.map((model) => model.id)).toEqual(expected);
    expect(JSON.stringify(body)).not.toMatch(/private prompt|private-account-token|private-provider|thinkingFormat/);
    expect((await buildModelsList(["llm"], { skipLiveResolvers: true })).some((model) => model.id === "openai/gpt-4o")).toBe(true);
    expect(alias.name).toBe("deepseek/Flash");
    await expectNoUsage();
  });

  it("applies both parent grants, never grants a parent from a member, and lets member blocking win", async () => {
    await updateApiKey("key", { allowedModels: ["jrouter/deepseek/Flash"], access: { restricted: true, allow: ["openai/gpt-4o"] } });
    expect((await (await openai(keyed("/v1/models"))).json()).data).toEqual([]);
    await updateApiKey("key", { allowedModels: ["openai/gpt-4o"], access: { restricted: true, allow: ["jrouter/deepseek/Flash"] } });
    expect((await (await openai(keyed("/v1/models"))).json()).data).toEqual([]);
    await updateApiKey("key", { allowedModels: ["jrouter/deepseek/Flash"], blockedModels: [], access: { restricted: true, allow: ["jrouter/deepseek/Flash"] } });
    expect((await (await openai(keyed("/v1/models"))).json()).data.map((model) => model.id)).toEqual(["jrouter/deepseek/Flash"]);
    await updateApiKey("key", { blockedModels: ["openai/gpt-4o"] });
    expect((await (await openai(keyed("/v1/models"))).json()).data).toEqual([]);
    expect((await lookup("jrouter/deepseek/Flash")).status).toBe(404);
    fixture.session = true;
    expect((await (await publicCatalog(request("/api/models/public", { cookie: "auth_token=fixture", authorization: "Bearer discovery-key" }))).json()).models).toHaveLength(2);
    for (const grant of ["Main", "jrouter/Main"]) {
      await updateApiKey("key", { allowedModels: [grant], blockedModels: [], access: { restricted: true, allow: [grant] } });
      expect((await (await openai(keyed("/v1/models"))).json()).data.map((model) => model.id)).toEqual(["jrouter/Main"]);
    }
    await expectNoUsage();
  });

  it("preserves joined case-sensitive lookup, legacy bare Combo identity, vision filtering and direct LLM denial", async () => {
    for (const id of ["Main", "jrouter/Main"]) expect(await (await lookup(id)).json()).toMatchObject({ id: "jrouter/Main" });
    expect(await (await modelInfo(keyed("/v1/models/info?id=Main"))).json()).toMatchObject({ id: "jrouter/Main" });
    expect((await lookup("jrouter/deepseek/flash")).status).toBe(404);
    expect((await lookup("openai/gpt-4o")).status).toBe(404);
    expect((await modelInfo(keyed("/v1/models/info?id=openai/gpt-4o"))).status).toBe(404);
    const vision = await lookup("image-to-text");
    expect((await vision.json()).data.map((model) => model.id)).toEqual(["jrouter/deepseek/Flash", "jrouter/Main"]);
    expect((await modelInfo(keyed("/v1/models/info"))).status).toBe(400);
    expect((await modelInfo(keyed("/v1/models/info?id=jrouter%2F%2Fbad"))).status).toBe(400);
    expect((await modelInfo(keyed("/v1/models/info?id=jrouter%2FMissing"))).status).toBe(404);
    await expectNoUsage();
  });

  it("retains standard and provider-prefixed Gemini media under both policies without bare provider LLM entries", async () => {
    const media = "gemini-3.1-flash-tts-preview";
    const unfiltered = await (await gemini(keyed("/v1beta/models"))).json();
    for (const id of [media, "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]) expect(unfiltered.models.map((model) => model.name)).toContain(`models/${id}`);
    expect(unfiltered.models.some((model) => model.name === "models/gemini/gemini-2.5-flash" && model.kind !== "stt")).toBe(false);
    expect(new Set(unfiltered.models.map((model) => model.name)).size).toBe(unfiltered.models.length);
    await updateApiKey("key", { allowedModels: [`gemini/${media}`], access: { restricted: true, allow: [`gemini/${media}`] } });
    const allowed = (await (await gemini(keyed("/v1beta/models"))).json()).models;
    expect(allowed.map((model) => model.name)).toEqual([`models/gemini/${media}`, `models/${media}`]);
    await updateApiKey("key", { blockedModels: [media] });
    expect((await (await gemini(keyed("/v1beta/models"))).json()).models).toEqual([]);
    await expectNoUsage();
  });

  it("keeps explicit native media lookup and info under both policy filters", async () => {
    await updateApiKey("key", { allowedModels: ["openai/dall-e-3"], access: { restricted: true, allow: ["openai/dall-e-3"] } });
    expect(await (await lookup("openai/dall-e-3")).json()).toMatchObject({ id: "openai/dall-e-3", kind: "image" });
    expect(await (await modelInfo(keyed("/v1/models/info?id=openai/dall-e-3&kind=image"))).json()).toMatchObject({ id: "openai/dall-e-3", kind: "image" });
    await updateApiKey("key", { access: { restricted: true, allow: ["openai/gpt-4o"] } });
    expect((await lookup("openai/dall-e-3")).status).toBe(404);
    expect((await modelInfo(keyed("/v1/models/info?id=openai/dall-e-3&kind=image"))).status).toBe(404);
    await updateApiKey("key", { blockedModels: ["openai/dall-e-3"], access: { restricted: true, allow: ["openai/dall-e-3"] } });
    expect((await lookup("openai/dall-e-3")).status).toBe(404);
  });

  it("denies dashboard and tags before catalog storage, preserving login-disabled access", async () => {
    const read = vi.spyOn(fixture.db, "all").mockImplementation(() => { throw new Error("catalog storage must not be read"); });
    for (const handler of [publicCatalog, tags]) expect((await handler(keyed("/api/models/public"))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    for (const handler of [publicCatalog, tags]) {
      expect((await handler(request("/api/models/public", { "x-9r-cli-token": "fixture-cli-token" }))).status).toBe(200);
      expect((await handler(request("/api/models/public", { "x-9r-cli-token": "invalid-cli-token" }))).status).toBe(401);
    }
    fixture.db.run("UPDATE settings SET data=? WHERE id=1", [JSON.stringify({ requireLogin: false })]);
    expect((await publicCatalog(request("/api/models/public"))).status).toBe(200);
    expect((await tags(request("/api/tags"))).status).toBe(200);
  });

  it("returns secret-safe storage failures instead of success-empty and preserves CORS", async () => {
    fixture.session = true;
    const failure = vi.spyOn(fixture.db, "all").mockImplementation(() => { throw new Error("storage secret private-account-token stack"); });
    const operations = [
      () => openai(keyed("/v1/models")), () => gemini(keyed("/v1beta/models")),
      () => lookup("jrouter/deepseek/Flash"), () => modelInfo(keyed("/v1/models/info?id=jrouter/deepseek/Flash")),
      () => tags(request("/api/tags", { cookie: "auth_token=fixture" })),
      () => publicCatalog(request("/api/models/public", { cookie: "auth_token=fixture" })),
    ];
    for (const operation of operations) {
      const response = await operation();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toMatch(/private-account-token|stack|storage secret/);
    }
    failure.mockRestore();
    for (const options of [openaiOptions, geminiOptions, lookupOptions, infoOptions]) expect((await options()).headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await gemini(keyed("/v1beta/models"))).headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("does not hide storage failures wrapped by accepted configured-member resolution", async () => {
    const original = fixture.db.all.bind(fixture.db);
    let reads = 0;
    vi.spyOn(fixture.db, "all").mockImplementation((sql, ...args) => {
      if (sql.includes("providerConnections") && ++reads === 2) throw new Error("private-account-token failed storage");
      return original(sql, ...args);
    });
    const response = await openai(keyed("/v1/models"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-account-token");
  });

  it("keeps wrapped member-storage and authentication-storage failures secret-safe on every public LLM route", async () => {
    const originalAll = fixture.db.all.bind(fixture.db);
    const read = vi.spyOn(fixture.db, "all");
    for (const operation of [() => openai(keyed("/v1/models")), () => modelInfo(keyed("/v1/models/info?id=jrouter/deepseek/Flash")), () => gemini(keyed("/v1beta/models"))]) {
      let reads = 0;
      read.mockImplementation((sql, ...args) => {
        if (sql.includes("providerConnections") && ++reads === 2) throw new Error("private-account-token nested storage");
        return originalAll(sql, ...args);
      });
      const response = await operation();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private-account-token");
    }
    read.mockRestore();
    vi.spyOn(fixture.db, "get").mockImplementation(() => { throw new Error("private-account-token auth storage"); });
    for (const operation of [() => openai(keyed("/v1/models")), () => gemini(keyed("/v1beta/models")), () => lookup("jrouter/Main"), () => modelInfo(keyed("/v1/models/info?id=jrouter/Main"))]) {
      const response = await operation();
      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.text()).not.toContain("private-account-token");
    }
  });

  it("omits expected invalid and non-LLM saved targets without exposing raw or legacy entries", async () => {
    await createCombo({ name: "Empty", models: [] });
    await createCombo({ name: "Media", kind: "image", models: ["openai/dall-e-3"] });
    await createCombo({ name: "InvalidMediaLeaf", models: ["openai/dall-e-3"] });
    await createCombo({ name: "MissingProvider", models: ["openai-compatible-deleted/model"] });
    await createCombo({ name: "Cycle", models: ["Cycle"] });
    expect((await (await openai(keyed("/v1/models"))).json()).data.map((model) => model.id)).toEqual(["jrouter/deepseek/Flash", "jrouter/Main"]);
  });
  it.each(["info", "lookup"])("keeps colon-bearing registered embedding metadata on %s with both policy filters", async route => {
    const id = "openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free";
    fixture.db.run("INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", ["media-openrouter", "openrouter", "apikey", "{}", "fixture", "fixture"]);
    const read = () => route === "info"
      ? modelInfo(keyed(`/v1/models/info?id=${encodeURIComponent(id)}&kind=embedding`)) : lookup(id);
    await updateApiKey("key", { allowedModels: [id], access: { restricted: true, allow: [id] } });
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, kind: "embedding" });
    await updateApiKey("key", { access: { restricted: true, allow: ["openai/dall-e-3"] } });
    expect((await read()).status).toBe(404);
    await updateApiKey("key", { blockedModels: [id], access: { restricted: true, allow: [id] } });
    expect((await read()).status).toBe(404);
    await expectNoUsage();
  });
});
