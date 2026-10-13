import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runtime from "@/sse/services/modelsAliasRuntime.js";

const owner = Symbol.for("jrouter.modelsAliases.runtime");
const P = "cbai/Flash";
const A = "cmc/deepseek/Flash";
const B = "corp/Nested/Model";
const C = "other/Model";
let alias;

function snapshot(now = 0, allowedMembers = alias.models) {
  return runtime.getAliasCandidateSnapshot(alias, { allowedMembers, now });
}
function claim(member = P, now = 0, request = snapshot(now)) {
  return runtime.tryClaimAliasMember(request, member, { now });
}
function fail(member, now = 0, outcome = { category: "transient" }) {
  const lease = claim(member, now);
  expect(lease).not.toBeNull();
  return runtime.settleAliasMemberAttempt(lease, outcome, { now });
}
function status(now = 0) {
  return runtime.getModelsAliasRuntimeStatus(alias, { now });
}

beforeEach(() => {
  globalThis[owner]?.clear();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  alias = { id: "alias-fixture", name: "DeepSeek/Flash", models: [A, P, B, C, A], primaryModel: P };
});
afterEach(() => {
  globalThis[owner]?.clear();
  vi.useRealTimers();
});

describe("alias fallback and snapshots", () => {
  it("pins exact primary and deduplicates nested configured IDs without mutation", () => {
    expect(snapshot().candidates).toEqual([P, A, B, C]);
    expect(alias.models).toEqual([A, P, B, C, A]);
    expect(status()).toMatchObject({ aliasId: alias.id, serverNow: 0, configuredOrder: [P, A, B, C], effectiveOrder: [P, A, B, C] });
    expect(status().members).toEqual([P, A, B, C].map((modelId) => ({ modelId, status: "available", retryAt: null })));
  });
  it("demotes non-primary failures, never primary, and does not restore rank on expiry or success", () => {
    fail(P);
    fail(A);
    expect(snapshot().candidates).toEqual([B, C]);
    expect(status().effectiveOrder).toEqual([P, B, C, A]);
    expect(snapshot(30000).candidates).toEqual([P, B, C, A]);
    const lease = claim(A, 30000);
    runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 30000 });
    expect(status(30000).effectiveOrder).toEqual([P, B, C, A]);
    expect(alias.models).toEqual([A, P, B, C, A]);
  });
  it("freezes request order and permits only one claim of each member in that request", () => {
    const request = snapshot();
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.candidates)).toBe(true);
    fail(A);
    expect(request.candidates).toEqual([P, A, B, C]);
    expect(runtime.tryClaimAliasMember(request, A, { now: 1 })).toBeNull();
    const lease = runtime.tryClaimAliasMember(request, B, { now: 1 });
    expect(lease).not.toBeNull();
    runtime.releaseAliasMemberAttempt(lease);
    expect(runtime.tryClaimAliasMember(request, B, { now: 1 })).toBeNull();
    expect(runtime.tryClaimAliasMember(request, C, { now: 1 })).not.toBeNull();
  });
  it("fails closed without requested-ID authorization, not canonical IDs or ResolvedMember objects", () => {
    expect(runtime.getAliasCandidateSnapshot(alias, { now: 0 }).candidates).toEqual([]);
    expect(snapshot(0, ["codebuddy/Flash", "cmc/deepseek/flash"]).candidates).toEqual([]);
    expect(() => snapshot(0, [{ requested: P, provider: "codebuddy", model: "Flash", canonicalId: "codebuddy/Flash" }])).toThrow(/requested|member/i);
    const request = snapshot(0, [A]);
    expect(request.candidates).toEqual([A]);
    expect(runtime.tryClaimAliasMember(request, P, { now: 0 })).toBeNull();
    expect(runtime.tryClaimAliasMember({ ...request }, A, { now: 0 })).toBeNull();
  });
  it("rechecks changed authorization lists before claiming", () => {
    const allowed = [P, A];
    const request = snapshot(0, allowed);
    allowed.splice(allowed.indexOf(A), 1);
    expect(runtime.tryClaimAliasMember(request, A, { now: 0 })).toBeNull();
    expect(runtime.tryClaimAliasMember(request, P, { now: 0 })).toBeNull();
    expect(snapshot(0, allowed).candidates).toEqual([P]);
  });
  it("reports only authorized useful future retry times when all candidates are ineligible", () => {
    fail(P);
    fail(A, 0, { category: "auth" });
    expect(snapshot(1000, [P, A])).toMatchObject({ candidates: [], allIneligible: true, retryAt: 30000, serverNow: 1000 });
    expect(snapshot(1000, [A])).toMatchObject({ candidates: [], retryAt: 120000 });
    expect(snapshot(1000, [])).toMatchObject({ candidates: [], retryAt: null });
    expect(snapshot(1000, [B])).toMatchObject({ candidates: [B], allIneligible: false, retryAt: null });
  });
  it("does not expose configuration prompt or provider errors in runtime status", () => {
    alias.systemPrompt = "private instruction";
    fail(P, 0, { category: "provider", status: 503, error: "private provider detail" });
    const json = JSON.stringify(status());
    expect(json).not.toContain("private");
    expect(Object.keys(status()).sort()).toEqual(["aliasId", "configVersion", "configuredOrder", "effectiveOrder", "members", "serverNow"].sort());
  });
});

describe("cooldown, recovery, and concurrent leases", () => {
  it("advances failed recovery cooldowns through 30/60/120/300/300 seconds and resets after success", () => {
    let now = 0;
    for (const duration of [30000, 60000, 120000, 300000, 300000]) {
      fail(P, now);
      expect(status(now).members[0]).toEqual({ modelId: P, status: "cooldown", retryAt: now + duration });
      expect(claim(P, now + duration - 1)).toBeNull();
      now += duration;
      expect(status(now).members[0]).toEqual({ modelId: P, status: "recovering", retryAt: null });
    }
    runtime.settleAliasMemberAttempt(claim(P, now), { category: "success" }, { now });
    expect(status(now).members[0].status).toBe("available");
    fail(P, now);
    expect(status(now).members[0].retryAt).toBe(now + 30000);
  });
  it("allows healthy concurrency, but only one trial across independent recovery requests", () => {
    const first = claim();
    const second = claim();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    runtime.settleAliasMemberAttempt(first, { category: "transient" }, { now: 0 });
    runtime.releaseAliasMemberAttempt(second);
    const ready = snapshot(30000);
    const racing = snapshot(30000);
    const recovery = claim(P, 30000, ready);
    expect(recovery).toMatchObject({ aliasId: alias.id, memberId: P, recovery: true });
    expect(claim(P, 30000, racing)).toBeNull();
    expect(snapshot(30000).candidates).toEqual([A, B, C]);
    expect(claim(A, 30000)).not.toBeNull();
    expect(runtime.releaseAliasMemberAttempt(recovery)).toBe(true);
    expect(runtime.releaseAliasMemberAttempt(recovery)).toBe(false);
    expect(claim(P, 30000)).not.toBeNull();
  });
  it.each(["client", "policy", "quota", "cancelled", "configuration", "collection"])("releases %s without demotion or cooldown", (category) => {
    const result = runtime.settleAliasMemberAttempt(claim(A), { category }, { now: 0 });
    expect(result).toMatchObject({ penalize: false, shouldFallback: false });
    expect(status().effectiveOrder).toEqual([P, A, B, C]);
    expect(status().members.every((member) => member.status === "available")).toBe(true);
  });
  it("cancellation frees a recovery trial without clearing the need to recover", () => {
    fail(P);
    runtime.settleAliasMemberAttempt(claim(P, 30000), { category: "cancelled", cancelReason: "client" }, { now: 30000 });
    expect(status(30000).members[0].status).toBe("recovering");
    expect(claim(P, 30000)).not.toBeNull();
  });
  it("protects a newer failure from an older healthy success", () => {
    const old = claim();
    const newer = claim();
    runtime.settleAliasMemberAttempt(newer, { category: "transient" }, { now: 1000 });
    expect(runtime.settleAliasMemberAttempt(old, { category: "success" }, { now: 2000 })).toBeNull();
    expect(status(2000).members[0].retryAt).toBe(31000);
  });
  it("counts simultaneous healthy failures once, not as failed recovery attempts", () => {
    const first = claim();
    const second = claim();
    fail(P);
    expect(runtime.settleAliasMemberAttempt(first, { category: "transient" }, { now: 1000 })).toBeNull();
    expect(runtime.settleAliasMemberAttempt(second, { category: "transient" }, { now: 2000 })).toBeNull();
    expect(status().members[0].retryAt).toBe(30000);
    fail(P, 30000);
    expect(status(30000).members[0].retryAt).toBe(90000);
  });
  it("does not suppress a real concurrent failure just because another healthy request succeeded", () => {
    const first = claim();
    const second = claim();
    runtime.settleAliasMemberAttempt(first, { category: "success" }, { now: 100 });
    runtime.settleAliasMemberAttempt(second, { category: "transient" }, { now: 200 });
    expect(status(200).members[0].retryAt).toBe(30200);
  });
  it("settles/releases once and ignores forged lease objects", () => {
    const lease = claim();
    expect(runtime.settleAliasMemberAttempt({ ...lease }, { category: "transient" }, { now: 0 })).toBeNull();
    expect(runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 0 })).toMatchObject({ category: "success" });
    expect(runtime.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 0 })).toBeNull();
    expect(runtime.releaseAliasMemberAttempt(lease)).toBe(false);
    expect(status().members[0].status).toBe("available");
  });
  it("applies rate resets without generic transient delay and keeps rate backoff separate", () => {
    fail(P, 0, { category: "provider", status: 429, retryAfter: "1" });
    expect(status().members[0].retryAt).toBe(1000);
    fail(P, 1000, { category: "rate-limit" });
    expect(status(1000).members[0].retryAt).toBe(3000);
    fail(P, 3000, { category: "rate-limit" });
    expect(status(3000).members[0].retryAt).toBe(7000);
    runtime.settleAliasMemberAttempt(claim(P, 7000), { category: "success" }, { now: 7000 });
    fail(P, 7000, { category: "rate-limit" });
    expect(status(7000).members[0].retryAt).toBe(9000);
  });
  it.each([
    ["ag/Gemini/Nested", { category: "rate-limit", resetsAtMs: 7200000 }, 7200000],
    ["cx/Gpt/Nested", { category: "provider", status: 404, error: "model is not supported when using codex with a chatgpt account" }, 1800000],
  ])("keeps requested ID %s while respecting canonical provider cooldown protections", (member, outcome, retryAt) => {
    alias.models = [member];
    alias.primaryModel = member;
    expect(snapshot().candidates).toEqual([member]);
    fail(member, 0, outcome);
    expect(status().members).toEqual([{ modelId: member, status: "cooldown", retryAt }]);
  });
  it("a late provider failure updates health but cannot authorize fallback", () => {
    const result = runtime.settleAliasMemberAttempt(claim(B), { category: "provider", status: 502, outputStarted: true }, { now: 100 });
    expect(result).toMatchObject({ penalize: true, shouldFallback: false, terminal: true });
    expect(status(100).members[2]).toEqual({ modelId: B, status: "cooldown", retryAt: 30100 });
  });
  it("blocks an initial-output deadline and preserves an owned trial through order reset", () => {
    fail(P, 0, { category: "cancelled", cancelReason: "initial-output-deadline" });
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    runtime.resetModelsAliasRuntimeOrder(alias);
    expect(status().members[0].retryAt).toBe(30000);
    expect(runtime.getModelsAliasConfigurationSignal(alias)).toBe(signal);
    expect(claim(P, 29999)).toBeNull();
  });
  it("an expired authoritative rate reset still needs exactly one recovery trial", () => {
    fail(P, 1000, { category: "rate-limit", resetsAtMs: 500 });
    const request = snapshot(1000);
    expect(status(1000).members[0].status).toBe("recovering");
    expect(claim(P, 1000, request)).not.toBeNull();
    expect(claim(P, 1000)).toBeNull();
  });
  it("reports no known retry time for an exclusively owned recovery trial", () => {
    fail(P);
    claim(P, 30000);
    expect(snapshot(30000, [P])).toMatchObject({ candidates: [], allIneligible: true, retryAt: null });
  });
});

describe("rotation and fusion selection", () => {
  it("rotates eligible first choices including primary with stable failover order", () => {
    alias.strategy = "round-robin";
    expect(snapshot().candidates).toEqual([P, A, B, C]);
    const second = snapshot();
    expect(second.candidates).toEqual([A, B, C, P]);
    const failed = runtime.tryClaimAliasMember(second, A, { now: 0 });
    runtime.settleAliasMemberAttempt(failed, { category: "transient" }, { now: 0 });
    expect(second.candidates).toEqual([A, B, C, P]);
    expect(snapshot().candidates).toEqual([B, C, P]);
    expect(snapshot().candidates).toEqual([C, P, B]);
    expect(snapshot().candidates).toEqual([P, B, C]);
    expect(status().configuredOrder[0]).toBe(P);
  });
  it("skips blocked/cooling/owned-recovery choices and resets round-robin without clearing health", () => {
    alias.strategy = "round-robin";
    fail(P);
    expect(snapshot(0, [P, B, C]).candidates).toEqual([B, C]);
    runtime.resetModelsAliasRuntimeOrder(alias);
    expect(snapshot(0, [P, B, C]).candidates).toEqual([B, C]);
    claim(P, 30000);
    expect(snapshot(30000).candidates).not.toContain(P);
    expect(status(30000).members[0].status).toBe("recovering");
  });
  it("fusion only supplies candidates; panel callers claim individually just before dispatch", () => {
    alias.strategy = "fusion";
    fail(A);
    const panel = snapshot(30000);
    const other = snapshot(30000);
    expect(panel.candidates).toEqual([P, A, B, C]);
    expect(claim(P, 30000, panel)).not.toBeNull();
    expect(claim(P, 30000, other)).not.toBeNull();
    expect(claim(A, 30000, panel)).not.toBeNull();
    expect(claim(A, 30000, other)).toBeNull();
  });
});

describe("configuration ownership and restart", () => {
  it("normalizes omitted defaults and ignores timestamps", () => {
    const initial = status().configVersion;
    expect(runtime.getModelsAliasRuntimeStatus({ ...alias, strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 15, updatedAt: "new" }).configVersion).toBe(initial);
  });
  it.each([
    { name: "Renamed/Nested" }, { models: [P, A, C] }, { primaryModel: A }, { strategy: "fusion" },
    { strategy: "fusion", judgeModel: A }, { initialResponseTimeoutSeconds: 16 }, { systemPrompt: "new" },
  ])("aborts old controllers and rejects old work on configuration edit %j", (edit) => {
    const request = snapshot();
    const lease = claim(A, 0, request);
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    Object.assign(alias, edit);
    const fresh = status();
    expect(signal.aborted).toBe(true);
    expect(fresh.configVersion).not.toBe(request.configVersion);
    expect(runtime.getModelsAliasConfigurationSignal(alias).aborted).toBe(false);
    expect(runtime.tryClaimAliasMember(request, B, { now: 0 })).toBeNull();
    expect(runtime.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 0 })).toBeNull();
    expect(fresh.members.every((member) => member.status === "available")).toBe(true);
  });
  it("settlement detects edits before another status read and cannot cool the replacement", () => {
    const lease = claim(A);
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    alias.name = "Edited/Name";
    expect(runtime.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 100 })).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(status(100).members.every((member) => member.status === "available")).toBe(true);
  });
  it("claim detects a mutable config edit even before another status/snapshot read", () => {
    const request = snapshot();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    alias.initialResponseTimeoutSeconds = 20;
    expect(runtime.tryClaimAliasMember(request, P, { now: 0 })).toBeNull();
    expect(signal.aborted).toBe(true);
  });
  it("order reset preserves controller, cooldown and active recovery ownership", () => {
    fail(A);
    const lease = claim(A, 30000);
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    const version = status(30000).configVersion;
    runtime.resetModelsAliasRuntimeOrder(alias);
    expect(status(30000).effectiveOrder).toEqual([P, A, B, C]);
    expect(status(30000).configVersion).toBe(version);
    expect(runtime.getModelsAliasConfigurationSignal(alias)).toBe(signal);
    expect(signal.aborted).toBe(false);
    expect(claim(A, 30000)).toBeNull();
    runtime.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 30000 });
    expect(status(30000).members[1].retryAt).toBe(90000);
    expect(status(30000).effectiveOrder).toEqual([P, A, B, C]);
  });
  it("full invalidation/deletion aborts only this alias and rejects old leases even on identical recreation", () => {
    const lease = claim();
    const request = snapshot();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    const other = { ...alias, id: "other-alias" };
    const otherSignal = runtime.getModelsAliasConfigurationSignal(other);
    runtime.invalidateModelsAliasRuntime(alias.id);
    expect(signal.aborted).toBe(true);
    expect(otherSignal.aborted).toBe(false);
    expect(runtime.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 0 })).toBeNull();
    expect(runtime.releaseAliasMemberAttempt(lease)).toBe(false);
    expect(snapshot().configVersion).not.toBe(request.configVersion);
    expect(runtime.tryClaimAliasMember(request, P, { now: 0 })).toBeNull();
    expect(status().members[0].status).toBe("available");
  });
  it("keeps stable IDs independent even if names are equal", () => {
    fail(P);
    const other = { ...alias, id: "second-id" };
    expect(runtime.getAliasCandidateSnapshot(other, { allowedMembers: other.models, now: 0 }).candidates[0]).toBe(P);
  });
  it("shares recovery ownership and controller across real duplicate module imports", async () => {
    fail(P);
    const request = snapshot(30000);
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    vi.resetModules();
    const duplicate = await import("@/sse/services/modelsAliasRuntime.js");
    expect(duplicate.getModelsAliasConfigurationSignal(alias)).toBe(signal);
    const trial = duplicate.tryClaimAliasMember(request, P, { now: 30000 });
    expect(trial).not.toBeNull();
    expect(claim(P, 30000)).toBeNull();
    expect(runtime.releaseAliasMemberAttempt(trial)).toBe(true);
    expect(duplicate.tryClaimAliasMember(snapshot(30000), P, { now: 30000 })).not.toBeNull();
  });
  it("a fresh process-owner fixture resets transient health/order/rotation, not saved config", async () => {
    fail(A);
    const saved = structuredClone(alias);
    const request = snapshot();
    const lease = claim(B);
    delete globalThis[owner];
    vi.resetModules();
    const restarted = await import("@/sse/services/modelsAliasRuntime.js");
    expect(restarted.getAliasCandidateSnapshot(saved, { allowedMembers: saved.models, now: 0 }).candidates).toEqual([P, A, B, C]);
    expect(restarted.tryClaimAliasMember(request, B, { now: 0 })).toBeNull();
    expect(restarted.settleAliasMemberAttempt(lease, { category: "transient" }, { now: 0 })).toBeNull();
    expect(alias).toEqual(saved);
  });
});
