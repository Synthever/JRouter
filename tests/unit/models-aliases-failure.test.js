import { describe, expect, it } from "vitest";
import { classifyAliasMemberFailure } from "@/sse/services/modelsAliasFailure.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

function classify(input, options = {}) {
  return classifyAliasMemberFailure(input, { now: 1000, ...options });
}

describe("internal failure provenance", () => {
  it.each(["client", "policy", "quota", "cancelled", "configuration", "collection"])("does not penalize %s despite a misleading generic status", (category) => {
    expect(classify({ category, status: 503, error: "rate limit overloaded" })).toMatchObject({ category, penalize: false, shouldFallback: false, terminal: true, cooldownMs: 0, retryAt: null });
  });
  it.each(["client", "configuration", "collection-grace", "collection-timeout"])("does not penalize a %s abort", (cancelReason) => {
    expect(classify({ category: "provider", status: 500, cancelReason })).toMatchObject({ penalize: false, shouldFallback: false });
  });
  it("requires explicit server provenance, not a final public 503 or unknown label", () => {
    for (const input of [{ status: 503, error: "unavailable" }, { category: "unknown", status: 503 }, { category: "bogus", status: 429 }]) {
      expect(classify(input)).toMatchObject({ category: "unknown", penalize: false, shouldFallback: false });
    }
  });
  it.each([
    "improperly formed request", "malformed request body: quota exceeded", "invalid request: capacity", "maximum context length exceeded", "unsupported parameter: overloaded", "request not allowed", "invalid JSON payload",
  ])("does not inherit legacy account penalties for malformed input: %s", (error) => {
    expect(classify({ category: "provider", status: 400, error })).toMatchObject({ category: "client", penalize: false, shouldFallback: false, cooldownMs: 0 });
  });
  it("leaves the legacy malformed-request account classifier unchanged", () => {
    expect(checkFallbackError(400, "improperly formed request")).toEqual({ shouldFallback: true, cooldownMs: 120000 });
    expect(classify({ category: "provider", status: 400, error: "improperly formed request" }).penalize).toBe(false);
  });
  it.each([400, 406, 409, 413, 422])("unmatched request status %s is not a member fault", (status) => {
    expect(classify({ category: "provider", status, error: "bad input" })).toMatchObject({ category: "client", penalize: false });
  });
  it("no credentials is local availability/configuration, not a provider outage", () => {
    expect(classify({ category: "provider", status: 503, error: "No credentials available" })).toMatchObject({ category: "configuration", penalize: false });
  });
  it.each(["client", "policy", "quota", "configuration", "collection"])("never overrides %s provenance with a conflicting deadline reason", (category) => {
    expect(classify({ category, cancelReason: "initial-output-deadline" })).toMatchObject({ category, penalize: false, shouldFallback: false });
  });
  it("initial-output deadline is transient provider non-readiness, not client cancellation", () => {
    expect(classify({ category: "cancelled", cancelReason: "initial-output-deadline" })).toMatchObject({ category: "transient", penalize: true, shouldFallback: true, terminal: false, cooldownMs: 30000, retryAt: 31000 });
  });
  it("late actual stream faults penalize health but never allow generation replay", () => {
    expect(classify({ category: "provider", status: 502, error: "upstream reset", outputStarted: true })).toMatchObject({ category: "transient", penalize: true, shouldFallback: false, terminal: true, cooldownMs: 30000 });
    expect(classify({ category: "collection", outputStarted: true })).toMatchObject({ penalize: false, shouldFallback: false });
  });
  it("success clears both independent backoff counters without fallback", () => {
    expect(classify({ category: "success" }, { transientFailures: 4, rateLimitLevel: 8 })).toEqual({ category: "success", penalize: false, shouldFallback: false, terminal: false, cooldownMs: 0, retryAt: null, transientFailures: 0, rateLimitLevel: 0 });
  });
});

describe("provider cooldown decisions", () => {
  it.each([[0, 30000], [1, 60000], [2, 120000], [3, 300000], [4, 300000], [100, 300000]])("transient failure %s uses %s milliseconds", (transientFailures, cooldownMs) => {
    const result = classify({ category: "transient" }, { transientFailures });
    expect(result).toMatchObject({ category: "transient", penalize: true, shouldFallback: true, cooldownMs, retryAt: 1000 + cooldownMs, transientFailures: Math.min(transientFailures + 1, 4) });
  });
  it.each([401, 402, 403, 404])("retains existing fixed 2-minute account-scoped provider status %s", (status) => {
    expect(classify({ category: "provider", status, error: "upstream refusal" })).toMatchObject({ penalize: true, shouldFallback: true, cooldownMs: 120000, retryAt: 121000 });
  });
  it.each(["auth", "payment"])("accepts structured %s without needing status text", (category) => {
    expect(classify({ category })).toMatchObject({ category, penalize: true, cooldownMs: 120000 });
  });
  it.each(["rate limit", "too many requests", "quota exceeded", "capacity exhausted", "overloaded"])("reuses account rate-backoff text rule: %s", (error) => {
    expect(classify({ category: "provider", status: 503, error })).toMatchObject({ category: "rate-limit", cooldownMs: 2000, retryAt: 3000, rateLimitLevel: 1 });
  });
  it("rate wording on 400 is still provider quota when it is not malformed input", () => {
    expect(classify({ category: "provider", status: 400, error: "rate limit reached" })).toMatchObject({ category: "rate-limit", penalize: true, cooldownMs: 2000 });
  });
  it.each([[0, 2000], [1, 4000], [2, 8000], [7, 256000], [8, 300000], [15, 300000]])("rate-limit level %s uses existing bounded %s milliseconds", (rateLimitLevel, cooldownMs) => {
    expect(classify({ category: "provider", status: 429 }, { rateLimitLevel })).toMatchObject({ category: "rate-limit", cooldownMs, rateLimitLevel: Math.min(rateLimitLevel + 1, 15) });
  });
  it.each(["1", 1, "0.5"])("Retry-After %s seconds overrides even a long backoff", (retryAfter) => {
    const result = classify({ category: "provider", status: 429, retryAfter }, { rateLimitLevel: 15 });
    expect(result.cooldownMs).toBe(Number(retryAfter) * 1000);
    expect(result.retryAt).toBe(1000 + Number(retryAfter) * 1000);
    expect(result.rateLimitLevel).toBe(0);
  });
  it("accepts HTTP-date Retry-After", () => {
    expect(classify({ category: "provider", status: 429, retryAfter: "Thu, 01 Jan 1970 00:00:05 GMT" })).toMatchObject({ cooldownMs: 4000, retryAt: 5000 });
  });
  it("provider reset timestamp outranks Retry-After without extending short reset", () => {
    expect(classify({ category: "provider", status: 429, resetsAtMs: 1250, retryAfter: "100" }, { rateLimitLevel: 15 })).toMatchObject({ cooldownMs: 250, retryAt: 1250, rateLimitLevel: 0 });
  });
  it.each([{ resetsAtMs: 500 }, { retryAfter: "0" }, { retryAfter: "Thu, 01 Jan 1970 00:00:00 GMT" }])("expired authoritative reset does not invent another delay: %j", (metadata) => {
    expect(classify({ category: "provider", status: 429, ...metadata }, { rateLimitLevel: 15 })).toMatchObject({ cooldownMs: 0, retryAt: 1000, rateLimitLevel: 0, penalize: true });
  });
  it.each(["bad date", "-1", Infinity, "", null])("invalid Retry-After %s falls back to existing backoff", (retryAfter) => {
    expect(classify({ category: "rate-limit", retryAfter }, { rateLimitLevel: 1 })).toMatchObject({ cooldownMs: 4000, retryAt: 5000 });
  });
  it("caps ordinary reported resets at existing 30-minute limit", () => {
    expect(classify({ category: "rate-limit", resetsAtMs: 7201000 })).toMatchObject({ cooldownMs: 1800000, retryAt: 1801000 });
    expect(classify({ category: "rate-limit", retryAfter: "7200" })).toMatchObject({ cooldownMs: 1800000, retryAt: 1801000 });
  });
  it("preserves the existing Antigravity precise reset exemption", () => {
    expect(classify({ category: "rate-limit", resetsAtMs: 7201000 }, { provider: "antigravity" })).toMatchObject({ cooldownMs: 7200000, retryAt: 7201000 });
  });
  it("retains provider-specific unsupported-account protections", () => {
    expect(classify({ category: "provider", status: 404, error: "model is not supported when using codex with a chatgpt account" }, { provider: "codex" })).toMatchObject({ penalize: true, cooldownMs: 1800000 });
  });
  it("a provider quota reset on 409 is authoritative without becoming invalid client input", () => {
    expect(classify({ category: "provider", status: 409, resetsAtMs: 9001000 }, { provider: "ag" })).toMatchObject({ category: "rate-limit", penalize: true, cooldownMs: 9000000, retryAt: 9001000 });
  });
  it("no-penalty results preserve existing backoff counters", () => {
    expect(classify({ category: "client" }, { transientFailures: 2, rateLimitLevel: 4 })).toMatchObject({ transientFailures: 2, rateLimitLevel: 4, retryAt: null });
  });
});
