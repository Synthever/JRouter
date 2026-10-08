import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Both modules read their file path from DATA_DIR at import time, so the temp
// data dir has to be in place before the first import.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-catalog-"));
process.env.DATA_DIR = dataDir;
const catalogFile = path.join(dataDir, "model-catalog.json");

// One upstream record per gateway: the same short id means different things to
// different vendors, which is what used to leak capabilities across providers.
const upstream = {
  zai: { models: { "glm-4.6v": { modalities: { input: ["text", "image"] } } } },
  // two local ids alias this one upstream provider
  zhipuai: { models: { "glm-5-canary": { modalities: { input: ["text", "image", "pdf"] } } } },
  moonshotai: { models: { "kimi-k3": { modalities: { input: ["text"] } } } },
  kilo: { models: { "kilo-auto/efficient": { modalities: { input: ["text", "image"] } } } },
};
// The registry snapshot the sync feeds build(): local ids, with the capabilities
// the tables resolve on their own.
const entries = [
  { provider: "glm", model: "glm-4.6v", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "glm-cn", model: "glm-5-canary", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "zhipu", model: "glm-5-canary", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "kimi", model: "kimi-k3", current: { contextWindow: 128000, maxOutput: 32000 } },
];

let build, getCatalogModalities, invalidateCatalog, syncModelCatalog, startModelCatalogSync, capabilities;

beforeAll(async () => {
  ({ build, syncModelCatalog, startModelCatalogSync } = await import("../../src/lib/modelCatalog/sync.js"));
  // the builder is exercised directly; a missing export must fail loudly here
  // rather than skip every case below
  expect(typeof build).toBe("function");
  const { models, providers } = build(upstream, entries);
  fs.writeFileSync(catalogFile, JSON.stringify({ v: 2, models, providers }));
  ({ getCatalogModalities, invalidateCatalog } = await import("../../open-sse/providers/catalogOverride.js"));
  capabilities = await import("../../open-sse/providers/capabilities.js");
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("model catalog", () => {
  it("keys modalities by gateway and writes no model-only key", () => {
    const { models } = build(upstream, entries);
    // upstream "zai" is filed under the local id requests arrive with...
    expect(models["glm:glm-4.6v"]).toEqual({ vision: true });
    // ...and under its upstream name, because a custom provider node can carry
    // that name without being in the registry snapshot
    expect(models["zai:glm-4.6v"]).toEqual({ vision: true });
    expect(models["kilo:efficient"]).toEqual({ vision: true });
    // the vendor-stripped key is what used to be shared with every other gateway
    expect(models["glm-4.6v"]).toBeUndefined();
    expect(models["efficient"]).toBeUndefined();
    // a gateway that only declares text has nothing to contribute
    expect(models["kimi:kimi-k3"]).toBeUndefined();
  });

  it("files an upstream provider under every local id that aliases it", () => {
    const { models } = build(upstream, entries);
    // glm-cn and zhipu are both zhipuai upstream; neither may be dropped
    expect(models["glm-cn:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(models["zhipu:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(models["zhipuai:glm-5-canary"]).toEqual({ vision: true, pdf: true });
    expect(getCatalogModalities("glm-cn", "glm-5-canary")).toEqual({ vision: true, pdf: true });
    expect(getCatalogModalities("zhipu", "glm-5-canary")).toEqual({ vision: true, pdf: true });
  });

  it("does not hand a router mode another vendor's modalities", () => {
    // kilo's "efficient" is a real model; another gateway's "efficient" is a mode
    expect(getCatalogModalities("kilo", "kilo-auto/efficient")).toEqual({ vision: true });
    expect(getCatalogModalities("kilo-gateway", "kilo-auto/efficient")).toBeNull();
    expect(getCatalogModalities("qoder", "efficient")).toBeNull();
  });

  it("resolves a gateway the file was written for, and nobody else", () => {
    expect(getCatalogModalities("glm", "glm-4.6v")).toEqual({ vision: true });
    expect(getCatalogModalities("zai", "glm-4.6v")).toEqual({ vision: true });
    expect(getCatalogModalities("unrelated", "glm-4.6v")).toBeNull();
    expect(getCatalogModalities(undefined, "glm-4.6v")).toBeNull();
  });

  it("syncs custom provider ids and prefixes only when their API matches upstream", () => {
    const catalog = {
      deepseek: {
        api: "https://api.deepseek.com",
        models: { "deepseek-flash": { limit: { context: 1000000, output: 393216 } } },
      },
    };
    const nodes = [
      { id: "openai-compatible-chat-deepseek", prefix: "dps", baseUrl: "https://api.deepseek.com/v1/" },
      { id: "reseller", prefix: "rs", baseUrl: "https://reseller.example/v1" },
      { id: "lookalike", prefix: "fake", baseUrl: "https://api.deepseek.com.evil.example/v1" },
      { id: "other-path", prefix: "tenant", baseUrl: "https://api.deepseek.com/tenant/v1" },
      { id: "invalid-url", prefix: "invalid", baseUrl: "not-a-url" },
      { id: "insecure", prefix: "http", baseUrl: "http://api.deepseek.com/v1" },
      { id: "query", prefix: "q", baseUrl: "https://api.deepseek.com/v1?tenant=other" },
    ];
    const customEntries = nodes.flatMap((node) => [node.id, node.prefix].map((provider) => ({
      provider, model: "deepseek-flash", current: { contextWindow: 128000, maxOutput: 64000 },
    })));
    const { providers } = build(catalog, customEntries, nodes);
    expect(providers["openai-compatible-chat-deepseek"]).toEqual({
      "deepseek-flash": { contextWindow: 1000000, maxOutput: 393216 },
    });
    expect(providers.dps).toEqual(providers["openai-compatible-chat-deepseek"]);
    for (const provider of ["reseller", "rs", "lookalike", "fake", "other-path", "tenant", "invalid-url", "invalid", "insecure", "http", "query", "q"]) {
      expect(providers[provider]).toBeUndefined();
    }
  });

  it("does not guess a custom provider from its name or an ambiguous API", () => {
    const model = { limit: { context: 1000000, output: 393216 } };
    const catalog = {
      deepseek: { api: "https://shared.example/v1", models: { "deepseek-flash": model } },
      another: { api: "https://shared.example/v1", models: { "deepseek-flash": model } },
    };
    const nodes = [
      { id: "node", prefix: "dps", name: "DeepSeek", baseUrl: "https://shared.example/v1" },
    ];
    expect(build(catalog, [{
      provider: "node", model: "deepseek-flash", current: { contextWindow: 128000, maxOutput: 64000 },
    }], nodes).providers).toEqual({});
  });

  it("passes the gateway to the catalog reader when refining", () => {
    const seen = [];
    capabilities.setCatalogSource({
      getModalities: (provider) => {
        seen.push(provider);
        return provider === "gateway-a" ? { vision: true } : null;
      },
      getLimits: () => null,
    });
    try {
      // "*laguna*" resolves from the pattern table, so refine() runs
      expect(capabilities.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
      expect(capabilities.getCapabilitiesForModel("gateway-b", "laguna-9-preview").vision).toBe(false);
      expect(seen).toContain("gateway-a");
    } finally {
      capabilities.setCatalogSource(null);
    }
  });

  it("shares the installed source with every copy of the module", async () => {
    const source = {
      getModalities: (provider) => (provider === "gateway-a" ? { vision: true } : null),
      getLimits: () => null,
    };
    capabilities.setCatalogSource(source);
    try {
      // The server bundles this module into more than one chunk and the startup
      // hook only runs in one of them, so the slot has to be process-wide.
      expect(globalThis.__9rCatalogSource).toBe(source);
      const other = await import("../../open-sse/providers/capabilities.js?copy=2");
      expect(other.getCapabilitiesForModel).not.toBe(capabilities.getCapabilitiesForModel);
      // ...and that second copy resolves through the source it never installed
      expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
    } finally {
      capabilities.setCatalogSource(null);
    }
    expect(globalThis.__9rCatalogSource).toBeNull();
  });

  it("detaches the source from a copy that already resolved through it", async () => {
    capabilities.setCatalogSource({
      getModalities: (provider) => (provider === "gateway-a" ? { vision: true } : null),
      getLimits: () => null,
    });
    const other = await import("../../open-sse/providers/capabilities.js?copy=3");
    try {
      expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(true);
    } finally {
      capabilities.setCatalogSource(null);
    }
    // the sync resets the source before rebuilding; a copy that has read the
    // slot once must not keep serving the uninstalled reader
    expect(other.getCapabilitiesForModel("gateway-a", "laguna-9-preview").vision).toBe(false);
  });
});

describe("catalog schema", () => {
  it("ignores a file written before the keys were scoped", () => {
    const scoped = fs.readFileSync(catalogFile);
    // v1: flat model keys, which is exactly the shape that collided
    fs.writeFileSync(catalogFile, JSON.stringify({ v: 1, models: { "kimi-k3": { vision: true } }, providers: {} }));
    invalidateCatalog();
    expect(getCatalogModalities("kimi", "kimi-k3")).toBeNull();
    fs.writeFileSync(catalogFile, scoped);
    invalidateCatalog();
  });

  it("rebuilds an older-schema file instead of trusting its etag", async () => {
    fs.writeFileSync(catalogFile, JSON.stringify({ v: 1, etag: 'W/"old"', models: {}, providers: {} }));
    invalidateCatalog();
    startModelCatalogSync();   // picks the file's etag + schema version back up

    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sent.push(options?.headers || {});
      return { ok: true, status: 200, headers: new Map([["etag", 'W/"new"']]), json: async () => upstream };
    };
    try {
      expect((await syncModelCatalog()).status).toBe("updated");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0]["if-none-match"]).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    expect(written.v).toBe(2);
    expect(written.models["glm:glm-4.6v"]).toEqual({ vision: true });
  });

  it("rebuilds for newly added custom models even when the upstream etag is unchanged", async () => {
    const { createProviderNode, addCustomModel } = await import("../../src/lib/db/index.js");
    const node = await createProviderNode({
      id: "openai-compatible-chat-custom", type: "openai-compatible", name: "Custom",
      prefix: "custom", baseUrl: "https://custom.example/v1",
    });
    await addCustomModel({ providerAlias: node.id, id: "canary" });
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sent.push(options?.headers || {});
      return {
        ok: true, status: 200, headers: new Map([["etag", 'W/"new"']]),
        json: async () => ({
          ...upstream,
          custom: { api: "https://custom.example", models: { canary: { limit: { context: 1000000, output: 128000 } } } },
        }),
      };
    };
    try {
      expect((await syncModelCatalog()).status).toBe("updated");
      const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
      expect(written.providers[node.id]?.canary).toEqual({ contextWindow: 1000000, maxOutput: 128000 });
      expect(written.providers.custom?.canary).toEqual(written.providers[node.id].canary);
      expect(capabilities.getAutoCapabilitiesForModel(node.id, "canary").contextWindow).toBe(1000000);
      expect(capabilities.getAutoCapabilitiesForModel("custom", "canary").contextWindow).toBe(1000000);
      expect((await syncModelCatalog()).status).toBe("updated");
      expect(JSON.parse(fs.readFileSync(catalogFile, "utf8")).providers).toEqual(written.providers);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0]["if-none-match"]).toBeUndefined();
  });
});
