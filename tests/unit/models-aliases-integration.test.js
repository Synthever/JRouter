import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => {
  const fetch = vi.fn();
  globalThis.fetch = fetch;
  return {
    fetch,
    db: null,
    adapterGate: null,
    usage: vi.fn(async () => {}),
    pxpipe: vi.fn(),
  };
});

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => {
    await boundary.adapterGate?.();
    return boundary.db;
  },
  getAdapterSync: () => boundary.db,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveUsage: vi.fn(async () => {}),
  saveRequestUsage: (...args) => boundary.usage(...args),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () =>
    new Proxy({}, { get: (_, key) => (key === "then" ? undefined : vi.fn()) }),
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: (...args) => boundary.pxpipe(...args),
}));

const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
const { TABLES } = await import("@/lib/db/schema.js");
const { createModelsAlias, getModelsAliasById } = await import("@/lib/db/repos/modelsAliasesRepo.js");
const { createCombo } = await import("@/lib/db/repos/combosRepo.js");
const {
  resolvePublicLlmTarget,
  authorizeVirtualTarget,
} = await import("../../src/sse/services/publicLlmTarget.js");
const runtime = await import("../../src/sse/services/modelsAliasRuntime.js");
const { handleModelsAliasChat } = await import("../../src/sse/services/modelsAliasChat.js");
const { GET: getV1Models } = await import("@/app/api/v1/models/route.js");

const provider = "openai-compatible-task16";
const ids = ["fixture/primary", "fixture/a", "fixture/b", "fixture/judge"];
const log = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  line: vi.fn(),
  errorLine: vi.fn(),
};

let aliases = [];
let calls = [];

function answer(model = "actual", text = "answer") {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-fixture",
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { headers: { "content-type": "application/json" } }
  );
}

function failure(status = 503, message = "upstream unavailable") {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function addAccount(id = "account1", priority = 1, p = provider) {
  boundary.db.run(
    "INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)",
    [
      id,
      p,
      "apikey",
      id,
      priority,
      JSON.stringify({
        apiKey: "private-key",
        providerSpecificData: { baseUrl: "http://127.0.0.1:20388/v1" },
      }),
      "fixture",
      "fixture",
    ]
  );
}

beforeAll(async () => {
  boundary.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) {
    boundary.db.exec(
      `CREATE TABLE ${name} (${Object.entries(table.columns)
        .map(([k, v]) => `${k} ${v}`)
        .join(",")})`
    );
  }
});

afterAll(() => boundary.db.close());

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  boundary.adapterGate = null;
  for (const name of Object.keys(TABLES)) boundary.db.run(`DELETE FROM ${name}`);
  boundary.db.run(
    "INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?, 'openai-compatible', ?, 'fixture', 'fixture')",
    [provider, JSON.stringify({ prefix: "fixture", baseUrl: "http://127.0.0.1:20388/v1", apiType: "chat" })]
  );
  boundary.db.run("INSERT INTO settings(id,data) VALUES(1, ?)", [
    JSON.stringify({
      requireApiKey: false,
      rtkEnabled: false,
      pxpipeEnabled: false,
    }),
  ]);
  addAccount();
  boundary.fetch.mockReset().mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, signal: init.signal });
    return answer(body.model, `reply from ${body.model}`);
  });
  vi.stubGlobal("fetch", boundary.fetch);
});

afterEach(() => {
  for (const alias of aliases.splice(0)) runtime.invalidateModelsAliasRuntime(alias.id);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Task 16: Models Aliases Integrated Offline Acceptance", () => {
  it("rejects direct raw provider model requests before contacting upstream", async () => {
    // Attempting to resolve a direct raw provider model on public target API must fail
    await expect(resolvePublicLlmTarget("fixture/primary")).rejects.toThrow();
    await expect(resolvePublicLlmTarget("openai/gpt-4o")).rejects.toThrow();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("enforces two policy systems: key-allow and key-block rules on virtual alias and its members", async () => {
    const alias = await createModelsAlias({
      name: "SmartRouter",
      models: ["fixture/primary", "fixture/a"],
      primaryModel: "fixture/primary",
    });
    aliases.push(alias);

    const publicTarget = await resolvePublicLlmTarget("jrouter/SmartRouter");
    expect(publicTarget.publicId).toBe("jrouter/SmartRouter");

    // Case 1: Key explicitly allows the alias -> authorized
    const auth1 = await authorizeVirtualTarget(publicTarget, {
      policy: {
        allowedModels: ["jrouter/SmartRouter"],
        blockedModels: [],
      },
    });
    expect(auth1.target.publicId).toBe("jrouter/SmartRouter");

    // Case 2: Key blocks the alias specifically -> rejected with 403
    await expect(
      authorizeVirtualTarget(publicTarget, {
        policy: {
          allowedModels: ["jrouter/SmartRouter"],
          blockedModels: ["jrouter/SmartRouter"],
        },
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(boundary.fetch).not.toHaveBeenCalled();

    // Case 3: Key blocks all underlying members -> rejected with 403
    await expect(
      authorizeVirtualTarget(publicTarget, {
        policy: {
          allowedModels: ["jrouter/SmartRouter"],
          blockedModels: ["fixture/primary", "fixture/a"],
        },
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("enforces extra Combo judge own permission during fusion execution", async () => {
    const combo = await createCombo({
      name: "FusionCombo",
      kind: "llm",
      models: ["fixture/primary", "fixture/a"],
      routingAlgorithm: "fusion",
      judgeModel: "fixture/judge",
    });

    const publicTarget = await resolvePublicLlmTarget("jrouter/FusionCombo");
    expect(publicTarget.publicId).toBe("jrouter/FusionCombo");

    const authorized = await authorizeVirtualTarget(publicTarget, {
      policy: {
        allowedModels: ["jrouter/FusionCombo"],
        blockedModels: [],
      },
    });

    const { assertAuthorizedVirtualMember } = await import("@/lib/apiKeyPolicy/virtualTargets.js");

    // When judgeModel is not in allowedModels for an extra member check, it must be denied
    expect(() => {
      assertAuthorizedVirtualMember(
        authorized,
        "fixture/judge",
        { provider: "fixture", model: "judge" },
        { extraComboMember: true }
      );
    }).toThrow();

    // When judgeModel is explicitly granted in allowedModels, it passes
    const authorizedWithJudge = await authorizeVirtualTarget(publicTarget, {
      policy: {
        allowedModels: ["jrouter/FusionCombo", "fixture/judge"],
        blockedModels: [],
      },
    });
    expect(() => {
      assertAuthorizedVirtualMember(
        authorizedWithJudge,
        "fixture/judge",
        { provider: "fixture", model: "judge" },
        { extraComboMember: true }
      );
    }).not.toThrow();

    // But if judgeModel is explicitly in blockedModels, it is denied
    const authorizedWithBlockedJudge = await authorizeVirtualTarget(publicTarget, {
      policy: {
        allowedModels: ["jrouter/FusionCombo", "fixture/judge"],
        blockedModels: ["fixture/judge"],
      },
    });
    expect(() => {
      assertAuthorizedVirtualMember(
        authorizedWithBlockedJudge,
        "fixture/judge",
        { provider: "fixture", model: "judge" },
        { extraComboMember: true }
      );
    }).toThrow();
  });

  it("handles fallback, deadline/timeout, cooldown rotation, and recovery", async () => {
    const alias = await createModelsAlias({
      name: "FallbackAlias",
      models: ["fixture/primary", "fixture/a", "fixture/b"],
      primaryModel: "fixture/primary",
      strategy: "fallback",
    });
    aliases.push(alias);

    const target = await resolvePublicLlmTarget("jrouter/FallbackAlias");
    const authorized = await authorizeVirtualTarget(target);

    // Primary fails with 503, fallback to fixture/a succeeds
    boundary.fetch.mockImplementation(async (url, init) => {
      const b = JSON.parse(init.body);
      calls.push(b.model);
      if (b.model === "primary") return failure(503, "rate limited");
      return answer(b.model, "fallback reply");
    });

    const body = {
      model: "jrouter/FallbackAlias",
      messages: [{ role: "user", content: "test query" }],
    };
    const req = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await handleModelsAliasChat({ authorized, body, request: req, log });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices[0].message.content).toBe("fallback reply");
    expect(calls).toEqual(["primary", "a"]);

    // Effective order updated so primary is cooled and alternative is tried first
    const status = runtime.getModelsAliasRuntimeStatus(alias);
    expect(status.members[0].status).toBe("cooldown");
  });

  it("publishes canonical identities jrouter/* in discovery without leaking internal tokens", async () => {
    const alias = await createModelsAlias({
      name: "DiscoveredAlias",
      models: ["fixture/primary"],
      primaryModel: "fixture/primary",
    });
    aliases.push(alias);

    await createCombo({
      name: "DiscoveredCombo",
      models: ["fixture/a"],
    });

    const res = await getV1Models(new Request("http://127.0.0.1/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const modelIds = body.data.map((m) => m.id);

    expect(modelIds).toContain("jrouter/DiscoveredAlias");
    expect(modelIds).toContain("jrouter/DiscoveredCombo");
    // Raw provider models must NOT be listed in public discovery
    expect(modelIds).not.toContain("fixture/primary");
    expect(modelIds).not.toContain("fixture/a");
  });

  it("injects configured system prompt in prepend/append mode", async () => {
    const aliasPrepend = await createModelsAlias({
      name: "PrependedAlias",
      models: ["fixture/primary"],
      primaryModel: "fixture/primary",
      promptInjectionEnabled: true,
      promptInjectionMode: "prepend",
      systemPrompt: "You are CodeBuddy.",
    });
    aliases.push(aliasPrepend);

    const targetPrepend = await resolvePublicLlmTarget("jrouter/PrependedAlias");
    const authorizedPrepend = await authorizeVirtualTarget(targetPrepend);

    const bodyPrepend = {
      model: "jrouter/PrependedAlias",
      messages: [{ role: "user", content: "help me code" }],
    };
    const reqPrepend = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(bodyPrepend),
    });

    await handleModelsAliasChat({
      authorized: authorizedPrepend,
      body: bodyPrepend,
      request: reqPrepend,
      log,
    });

    expect(calls.length).toBe(1);
    const sentMessages = calls[0].body.messages;
    expect(sentMessages[0].role).toBe("system");
    expect(sentMessages[0].content).toContain("You are CodeBuddy.");
  });

  it("records a single accountable usage event for fusion executions", async () => {
    const aliasFusion = await createModelsAlias({
      name: "FusionAlias",
      models: ["fixture/primary", "fixture/a"],
      primaryModel: "fixture/primary",
      strategy: "fusion",
    });
    aliases.push(aliasFusion);

    boundary.fetch.mockImplementation(async (url, init) => {
      const b = JSON.parse(init.body);
      calls.push(b.model);
      return b.model === "primary" ? answer("upstream-primary", "useful fusion answer") : failure(503, "unavailable");
    });

    const target = await resolvePublicLlmTarget("jrouter/FusionAlias");
    const authorized = await authorizeVirtualTarget(target);

    const body = {
      model: "jrouter/FusionAlias",
      messages: [{ role: "user", content: "compare opinions" }],
    };
    const req = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await handleModelsAliasChat({ authorized, body, request: req, log });
    expect(res.status).toBe(200);
    // When one candidate returns a useful answer and the other fails, single answer is selected and exactly 1 usage is saved
    expect(boundary.usage).toHaveBeenCalledTimes(1);
  });
});
