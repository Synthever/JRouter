import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ aliases: [], combos: [], nodes: [], legacy: {}, usageDb: null }));
vi.mock("@/lib/db/index.js", () => ({
  getModelsAliasByName: async (name) => fx.aliases.find((entry) => entry.name === name) || null,
  getComboByName: async (name) => fx.combos.find((entry) => entry.name === name) || null,
  getProviderNodes: async () => fx.nodes,
}));
vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.legacy,
  getComboByName: async (name) => fx.combos.find((entry) => entry.name === name) || null,
  getProviderNodes: async (filter = {}) => fx.nodes.filter((node) => !filter.type || node.type === filter.type),
}));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => fx.usageDb || ({
  all(sql) {
    if (sql.includes("providerNodes")) return fx.nodes.map(({ id, type, ...data }) => ({ id, type, data: JSON.stringify(data) }));
    if (sql.includes("providerConnections")) return [{ provider: "codex" }];
    if (sql.includes("customModels")) return [{ value: JSON.stringify({ providerAlias: "cx", id: "Deep/Model", kind: "llm" }) }];
    throw new Error(`Unexpected fixture query: ${sql}`);
  },
}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));

import { resolvePublicLlmTarget, authorizeVirtualTarget } from "@/sse/services/publicLlmTarget.js";
import { virtualTargetIdentifiers, assertAuthorizedVirtualMember } from "@/lib/apiKeyPolicy/virtualTargets.js";
import { apiKeyPolicyContext, assertCurrentModelAllowed, getApiKeyPolicyContext, runWithAuthorizedVirtualMember } from "@/lib/apiKeyPolicy/context.js";
import { getModelInfo } from "@/sse/services/model.js";
import { isVirtualTargetAllowed, resolveKeyAccessModelPermissions } from "@/sse/services/keyAccess.js";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { saveRequestUsage, getUsageHistory } from "@/lib/db/repos/usageRepo.js";
import * as accounting from "@/lib/apiKeyPolicy/accounting.js";

beforeEach(() => {
  fx.usageDb = null;
  fx.aliases = [{ id: "a1", name: "deepseek/Flash", models: ["cx/Deep/Model", "fixture/Case/Model"], primaryModel: "cx/Deep/Model" }];
  fx.combos = [{ id: "c1", name: "Main", kind: null, models: ["cx/Deep/Model", "fixture/Case/Model"] }];
  fx.nodes = [{ id: "openai-compatible-chat-fixture", type: "openai-compatible", prefix: "fixture" }];
  fx.legacy = { fast: "cx/Deep/Model" };
});
const policy = (allowedModels = [], blockedModels = []) => ({ allowedModels, blockedModels });
const access = (...allow) => ({ keyId: "fixture", keyName: "fixture", allow, _sets: null });
const target = (requested = "jrouter/deepseek/Flash") => resolvePublicLlmTarget(requested);
const admission = async (options = {}, requested) => authorizeVirtualTarget(await target(requested), options);
const member = { provider: "codex", model: "Deep/Model" };
const extra = { provider: "codex", model: "Extra/Model" };
const denied = { status: 403, code: "model_not_allowed" };

describe("virtual parent permission intersection", () => {
  it("gives aliases only public IDs and Combos both equivalent IDs", async () => {
    expect(virtualTargetIdentifiers(await target())).toEqual(["jrouter/deepseek/Flash"]);
    expect(virtualTargetIdentifiers(await target("Main"))).toEqual(["jrouter/Main", "Main"]);
  });

  it.each(["alias", "combo"])("an allowed provider member never grants the %s parent", async (kind) => {
    const requested = kind === "alias" ? undefined : "Main";
    await expect(admission({ policy: policy(["cx/*"]) }, requested)).rejects.toMatchObject(denied);
    await expect(admission({ keyAccess: access("cx/Deep/Model") }, requested)).rejects.toMatchObject(denied);
  });

  it("requires both independent parent grants", async () => {
    await expect(admission({ policy: policy(["jrouter/*"]), keyAccess: access() })).rejects.toMatchObject(denied);
    await expect(admission({ policy: policy(["other"]), keyAccess: access("jrouter/deepseek/flash") })).rejects.toMatchObject(denied);
    expect((await admission({ policy: policy(["jrouter/*"]), keyAccess: access("JROUTER/DEEPSEEK/FLASH") })).members).toHaveLength(2);
  });

  it("does not let a bare alias grant its public target", async () => {
    await expect(admission({ policy: policy(["deepseek/Flash"]) })).rejects.toMatchObject(denied);
    await expect(admission({ keyAccess: access("deepseek/Flash") })).rejects.toMatchObject(denied);
  });

  it.each(["Main", "jrouter/Main"])("normalizes Combo permissions without writes for %s", async (entry) => {
    const current = policy([entry]);
    const legacy = access(entry.toUpperCase());
    const before = structuredClone({ current, allow: legacy.allow });
    expect((await admission({ policy: current, keyAccess: legacy }, "jrouter/Main")).members).toHaveLength(2);
    expect({ current, allow: legacy.allow }).toEqual(before);
  });

  it("keeps current pattern matching case-sensitive and legacy matching exact case-insensitive", async () => {
    await expect(admission({ policy: policy(["jrouter/deepseek/flash"]) })).rejects.toMatchObject(denied);
    await expect(admission({ keyAccess: access("jrouter/*") })).rejects.toMatchObject(denied);
    expect((await admission({ policy: policy(["jrouter/deepseek/*"]), keyAccess: access("JROUTER/DEEPSEEK/FLASH") })).members).toHaveLength(2);
  });

  it.each(["jrouter/Main", "Main"])("a blocked equivalent Combo parent %s wins", async (entry) => {
    await expect(admission({ policy: policy(["jrouter/*"], [entry]) }, "Main")).rejects.toMatchObject(denied);
  });

  it("blocks an alias parent even when every provider is allowed", async () => {
    await expect(admission({ policy: policy(["*"], ["jrouter/deepseek/*"]) })).rejects.toMatchObject(denied);
  });

  it("handles legacy parent and leaf permissions without enforcing active request policy during resolution", async () => {
    const legacy = access("main", "fast", "fixture/CASE/Model");
    await apiKeyPolicyContext.run({ policy: policy(["nothing"]) }, async () => {
      expect(await isVirtualTargetAllowed(legacy, await target("Main"))).toBe(true);
      expect(await resolveKeyAccessModelPermissions(legacy)).toEqual(new Set(["codex/deep/model", "openai-compatible-chat-fixture/case/model"]));
    });
  });
});

describe("configured member grants and blocks", () => {
  it("a parent grants only authorized configured provider identities", async () => {
    const authorized = await admission({ policy: policy(["jrouter/*"]), keyAccess: access("jrouter/deepseek/Flash") });
    expect(() => assertAuthorizedVirtualMember(authorized, "codex/Deep/Model", member)).not.toThrow();
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra)).toThrow(expect.objectContaining(denied));
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Deep/Model", { provider: "openai", model: "Deep/Model", canonicalId: "codex/Deep/Model" })).toThrow(expect.objectContaining(denied));
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Deep/Model", { ...member, model: "deep/Model" })).toThrow(expect.objectContaining(denied));
  });

  it.each(["cx/*", "codex/Deep/*", "Deep/Model"])("blocked configured leaf %s wins over parent", async (blocked) => {
    const authorized = await admission({ policy: policy(["jrouter/*"], [blocked]) });
    expect(authorized.members.map((leaf) => leaf.canonicalId)).toEqual(["openai-compatible-chat-fixture/Case/Model"]);
    expect(() => assertAuthorizedVirtualMember(authorized, "codex/Deep/Model", member)).toThrow(expect.objectContaining(denied));
  });

  it.each(["fixture/Case/*", "openai-compatible-chat-fixture/*"])("custom-node block %s covers alternate spelling", async (blocked) => {
    const authorized = await admission({ policy: policy(["jrouter/*"], [blocked]) });
    expect(authorized.members.map((leaf) => leaf.canonicalId)).toEqual(["codex/Deep/Model"]);
    expect(() => assertAuthorizedVirtualMember(authorized, "openai-compatible-chat-fixture/Case/Model", { provider: "openai-compatible-chat-fixture", model: "Case/Model" })).toThrow(expect.objectContaining(denied));
  });

  it("retains case-sensitive blocks and denies fully blocked targets explicitly", async () => {
    expect((await admission({ policy: policy(["jrouter/*"], ["cx/deep/*"]) })).members).toHaveLength(2);
    await expect(admission({ policy: policy(["jrouter/*"], ["*"]) })).rejects.toMatchObject(denied);
  });

  it("rejects invalid configured aliases explicitly before granting members", async () => {
    fx.aliases[0].models = ["jrouter/Main"];
    fx.aliases[0].primaryModel = "jrouter/Main";
    await expect(admission()).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("protects admitted snapshots against caller and repository edits", async () => {
    const current = policy(["jrouter/*"]);
    const authorized = await admission({ policy: current });
    current.allowedModels.push("cx/*");
    fx.aliases[0].models.push("cx/Extra/Model");
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra)).toThrow();
    expect(() => assertAuthorizedVirtualMember({ ...authorized }, "cx/Deep/Model", member)).toThrow();
    expect(() => authorized.members.push({ requested: "cx/Extra/Model", ...extra, canonicalId: "codex/Extra/Model" })).toThrow();
  });
});

describe("Combo judges and adapters outside membership", () => {
  it("parent grants cannot authorize extras under either policy", async () => {
    for (const options of [
      { policy: policy(["Main"]), keyAccess: null },
      { policy: policy(), keyAccess: access("jrouter/Main") },
    ]) {
      const authorized = await admission(options, "Main");
      expect(() => assertAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra, { extraComboMember: true })).toThrow(expect.objectContaining(denied));
    }
  });

  it("allows extras only on their own intersection of both systems", async () => {
    const authorized = await admission({ policy: policy(["Main", "cx/Extra/*"]), keyAccess: access("Main", "codex/EXTRA/MODEL") }, "Main");
    expect(() => assertAuthorizedVirtualMember(authorized, "codex/Extra/Model", extra, { extraComboMember: true })).not.toThrow();
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra)).toThrow();
    const blocked = await admission({ policy: policy(["*"], ["cx/Extra/*"]) }, "Main");
    expect(() => assertAuthorizedVirtualMember(blocked, "codex/Extra/Model", extra, { extraComboMember: true })).toThrow();
  });

  it("does not let extra dispatch inherit a parent through the requested spelling", async () => {
    const authorized = await admission({ policy: policy(["Main"]) }, "Main");
    expect(() => assertAuthorizedVirtualMember(authorized, "Main", extra, { extraComboMember: true })).toThrow();
    expect(() => assertAuthorizedVirtualMember(authorized, "jrouter/Main", extra, { extraComboMember: true })).toThrow();
  });

  it("an extra model cannot borrow an unrelated allowed provider spelling", async () => {
    const authorized = await admission({ policy: policy(["Main", "cx/Allowed"]) }, "Main");
    expect(() => assertAuthorizedVirtualMember(authorized, "cx/Allowed", extra, { extraComboMember: true })).toThrow();
  });

  it("a blocked legacy member identity cannot reenter under another spelling or as an extra", async () => {
    fx.combos[0].models = ["fast", "cx/Deep/Model", "fixture/Case/Model"];
    const authorized = await admission({ policy: policy(["*"], ["fast"]) }, "Main");
    expect(authorized.members.map((leaf) => leaf.canonicalId)).toEqual(["openai-compatible-chat-fixture/Case/Model"]);
    expect(() => assertAuthorizedVirtualMember(authorized, "codex/Deep/Model", member, { extraComboMember: true })).toThrow();
  });

  it("keeps unrestricted Combo extras but never allows alias extras", async () => {
    const combo = await admission({}, "Main");
    const alias = await admission();
    expect(() => assertAuthorizedVirtualMember(combo, "cx/Extra/Model", extra, { extraComboMember: true })).not.toThrow();
    expect(() => assertAuthorizedVirtualMember(alias, "cx/Extra/Model", extra, { extraComboMember: true })).toThrow();
  });
});

describe("trusted AsyncLocalStorage virtual context", () => {
  it("activates only for an admitted descriptor and records policy failures and resolved attribution", async () => {
    const authorized = await admission({ policy: policy(["jrouter/*"]), keyAccess: access("jrouter/deepseek/Flash") });
    const context = { policy: policy(["nothing"]), authorizedVirtualTarget: authorized };
    await apiKeyPolicyContext.run(context, async () => {
      expect(await getModelInfo("cx/Deep/Model")).toEqual(member);
      expect(getApiKeyPolicyContext().resolvedModel).toEqual(member);
      expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow();
      expect(context.modelPolicyError).toMatchObject(denied);
      assertCurrentModelAllowed("cx/Deep/Model", member);
      expect(context.modelPolicyError).toBeNull();
    });
  });

  it("does not trust cloned descriptors or client-like flags/headers/query/body fields", async () => {
    const authorized = await admission();
    for (const forged of [authorized.target, { ...authorized }, JSON.parse(JSON.stringify(authorized))]) {
      apiKeyPolicyContext.run({ policy: policy(["nothing"]), authorizedVirtualTarget: forged, admittedTarget: authorized.target, internal: true, body: { internal: true }, headers: { "x-internal": "true" }, query: { internal: true } }, () => {
        expect(() => assertCurrentModelAllowed("cx/Deep/Model", member)).toThrow();
      });
    }
  });

  it("fails closed for an unrecognized context descriptor even with old Combo grants", async () => {
    const authorized = await admission({}, "Main");
    for (const forged of [{ ...authorized }, JSON.parse(JSON.stringify(authorized))]) {
      apiKeyPolicyContext.run({ policy: policy(["Main"]), isCombo: true, requestedModel: "Main", authorizedVirtualTarget: forged }, () => {
        expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow(expect.objectContaining(denied));
      });
    }
  });

  it("records admission-helper denials on the request context before callback execution", async () => {
    const authorized = await admission({}, "Main");
    const context = { policy: policy(), authorizedVirtualTarget: authorized };
    const callback = vi.fn();
    apiKeyPolicyContext.run(context, () => {
      expect(() => runWithAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra, callback)).toThrow();
      expect(context.modelPolicyError).toMatchObject(denied);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  it("a client-like extra flag cannot activate Combo own-permission execution", async () => {
    const authorized = await admission({}, "Main");
    apiKeyPolicyContext.run({ policy: policy(), authorizedVirtualTarget: authorized, extraComboMember: true }, () => {
      expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow();
    });
  });

  it("runs server-owned extra Combo members with independent approval before the callback", async () => {
    const authorized = await admission({ policy: policy(["Main", "cx/Extra/*"]), keyAccess: access("Main", "cx/Extra/Model") }, "Main");
    await apiKeyPolicyContext.run({ policy: policy(["Main"]), authorizedVirtualTarget: authorized }, async () => {
      expect(await runWithAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra, () => getModelInfo("codex/Extra/Model"), { extraComboMember: true })).toEqual(extra);
      expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow();
      expect(() => runWithAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra, () => assertCurrentModelAllowed("cx/Other", { provider: "codex", model: "Other" }), { extraComboMember: true })).toThrow();
    });
    const callback = vi.fn();
    expect(() => runWithAuthorizedVirtualMember(authorized, "cx/Other", { provider: "codex", model: "Other" }, callback, { extraComboMember: true })).toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves marker demand through server-owned dispatch without client-field activation", async () => {
    const authorized = await admission({}, "jrouter/deepseek/Flash[1m]");
    await runWithAuthorizedVirtualMember(authorized, "cx/Deep/Model", member, async () => {
      expect(authorized.target.contextMarker).toBe("1m");
      expect(getApiKeyPolicyContext()).toBeUndefined();
      expect(await getModelInfo("cx/Deep/Model")).toEqual(member);
      expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow(expect.objectContaining(denied));
    });
  });

  it("records real no-key provider usage without creating a key accounting admission", async () => {
    const authorized = await admission();
    const db = await createNodeSqliteAdapter(":memory:");
    for (const name of ["usageHistory", "usageDaily", "_meta", "kv", "apiKeys", "apiKeyRequests"]) db.exec(buildCreateTableSql(name, TABLES[name]));
    fx.usageDb = db;
    const accountUsage = vi.spyOn(accounting, "accountKeyUsage");
    const consoleError = vi.spyOn(console, "error");
    const entry = { timestamp: "2026-10-11T12:00:00.000Z", provider: "codex", model: "Deep/Model", connectionId: "fixture-connection", endpoint: "/v1/chat/completions", tokens: { prompt_tokens: 17, completion_tokens: 9 }, latency: 23 };
    let saveError;
    let usagePromise;
    let activeContext;
    try {
      await runWithAuthorizedVirtualMember(authorized, "cx/Deep/Model", member, async () => {
        activeContext = getApiKeyPolicyContext();
        assertCurrentModelAllowed("cx/Deep/Model", member);
        expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow(expect.objectContaining(denied));
        try { usagePromise = saveRequestUsage(entry); }
        catch (error) { saveError = error; }
        if (usagePromise) await usagePromise;
      });
      // The old synchronous throw leaves the real recorder running; await its writes before closing SQLite.
      await vi.waitFor(() => expect(db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'")?.value).toBe("1"));
      expect(saveError).toBeUndefined();
      expect(activeContext).toBeUndefined();
      expect(usagePromise).toBeInstanceOf(Promise);
      expect(await getUsageHistory()).toEqual([{ timestamp: entry.timestamp, provider: "codex", model: "Deep/Model", connectionId: "fixture-connection", apiKeyMasked: null, endpoint: "/v1/chat/completions", cost: 0, status: "ok", tokens: { prompt_tokens: 17, completion_tokens: 9 } }]);
      expect(db.get("SELECT provider, model, connectionId, apiKey, promptTokens, completionTokens FROM usageHistory")).toEqual({ provider: "codex", model: "Deep/Model", connectionId: "fixture-connection", apiKey: null, promptTokens: 17, completionTokens: 9 });
      const day = JSON.parse(db.get("SELECT data FROM usageDaily").data);
      expect(day).toMatchObject({ requests: 1, promptTokens: 17, completionTokens: 9, byProvider: { codex: { requests: 1 } }, byAccount: { "fixture-connection": { requests: 1, rawModel: "Deep/Model", provider: "codex" } } });
      expect(db.get("SELECT COUNT(*) AS count FROM apiKeys").count).toBe(0);
      expect(db.get("SELECT COUNT(*) AS count FROM apiKeyRequests").count).toBe(0);
      expect(accountUsage).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      fx.usageDb = null;
      accountUsage.mockRestore();
      consoleError.mockRestore();
      db.close();
    }
    expect(getApiKeyPolicyContext()).toBeUndefined();
  });

  it("no-key scopes reject copied admissions and require private identity-scoped extra approval", async () => {
    const authorized = await admission({}, "Main");
    const callback = vi.fn();
    for (const forged of [{ ...authorized }, JSON.parse(JSON.stringify(authorized))]) {
      expect(() => runWithAuthorizedVirtualMember(forged, "cx/Deep/Model", member, callback)).toThrow(expect.objectContaining(denied));
    }
    expect(callback).not.toHaveBeenCalled();
    await runWithAuthorizedVirtualMember(authorized, "cx/Deep/Model", member, async () => {
      expect(getApiKeyPolicyContext()).toBeUndefined();
      expect(() => assertCurrentModelAllowed("cx/Extra/Model", { ...extra, extraComboMember: true, internal: true })).toThrow(expect.objectContaining(denied));
    });
    await runWithAuthorizedVirtualMember(authorized, "cx/Extra/Model", extra, async () => {
      expect(getApiKeyPolicyContext()).toBeUndefined();
      expect(await getModelInfo("cx/Extra/Model")).toEqual(extra);
      expect(() => assertCurrentModelAllowed("cx/Other", { provider: "codex", model: "Other" })).toThrow(expect.objectContaining(denied));
    }, { extraComboMember: true });
  });

  it("keeps usage attribution and policy failures on the existing request context", async () => {
    const authorized = await admission({ policy: policy(["jrouter/*"]) });
    const current = { id: "fixture-reservation", apiKeyId: "fixture", multiplier: 2, quotaPeriodStartedAt: "2026-10-01", policy: policy(["jrouter/*"]), pending: new Set(), accounted: false };
    await apiKeyPolicyContext.run(current, async () => {
      await runWithAuthorizedVirtualMember(authorized, "cx/Deep/Model", member, async () => {
        const active = getApiKeyPolicyContext();
        expect(active.apiKeyId).toBe("fixture");
        expect(active.id).toBe("fixture-reservation");
        expect(active.multiplier).toBe(2);
        expect(active.quotaPeriodStartedAt).toBe("2026-10-01");
        expect(active.pending).toBe(current.pending);
        expect(await getModelInfo("cx/Deep/Model")).toEqual(member);
        active.accounted = true;
        expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow();
      });
      expect(getApiKeyPolicyContext()).toBe(current);
      expect(current.resolvedModel).toEqual(member);
      expect(current.accounted).toBe(true);
      expect(current.modelPolicyError).toMatchObject(denied);
    });
  });

  it("does not leak admitted member state into a concurrent request", async () => {
    const first = await admission({}, "Main");
    const second = await admission({ policy: policy(["jrouter/*"]) });
    await Promise.all([
      runWithAuthorizedVirtualMember(first, "cx/Extra/Model", extra, async () => {
        await Promise.resolve();
        expect(await getModelInfo("cx/Extra/Model")).toEqual(extra);
        expect(getApiKeyPolicyContext()).toBeUndefined();
        expect(() => assertCurrentModelAllowed("cx/Other", { provider: "codex", model: "Other" })).toThrow(expect.objectContaining(denied));
      }, { extraComboMember: true }),
      runWithAuthorizedVirtualMember(second, "cx/Deep/Model", member, async () => {
        await Promise.resolve();
        expect(() => assertCurrentModelAllowed("cx/Extra/Model", extra)).toThrow();
        expect(getApiKeyPolicyContext()).toBeUndefined();
        expect(await getModelInfo("cx/Deep/Model")).toEqual(member);
      }),
    ]);
    expect(getApiKeyPolicyContext()).toBeUndefined();
  });

  it("leaves direct, media, legacy Combo and no-context behavior unchanged", () => {
    expect(() => assertCurrentModelAllowed("anything", {})).not.toThrow();
    apiKeyPolicyContext.run({ policy: policy(["openai/*"]) }, () => {
      expect(() => assertCurrentModelAllowed("openai/direct", { provider: "openai", model: "direct" })).not.toThrow();
      expect(() => assertCurrentModelAllowed("anthropic/direct", { provider: "anthropic", model: "direct" })).toThrow();
    });
    apiKeyPolicyContext.run({ policy: policy(["Pictures"]), isCombo: true, requestedModel: "Pictures" }, () => {
      expect(() => assertCurrentModelAllowed("openai/image", { provider: "openai", model: "image" })).not.toThrow();
    });
    apiKeyPolicyContext.run({ policy: policy(["Main"]), isCombo: true, requestedModel: "Main" }, () => {
      expect(() => assertCurrentModelAllowed("cx/Deep/Model", member)).not.toThrow();
    });
  });
});
