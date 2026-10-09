import { describe, expect, it } from "vitest";
import { advanceStatus, classifyFailure, availability, validateConfig, DEFAULT_CONFIG } from "@/lib/health/logic.js";

describe("model health policy", () => {
  it("holds the first failure, degrades on two and goes down on three", () => {
    let state = { status: "HEALTHY", failures: 0, successes: 0 };
    state = advanceStatus(state, false, DEFAULT_CONFIG);
    expect(state.status).toBe("HEALTHY");
    state = advanceStatus(state, false, DEFAULT_CONFIG);
    expect(state.status).toBe("DEGRADED");
    state = advanceStatus(state, false, DEFAULT_CONFIG);
    expect(state.status).toBe("DOWN");
    state = advanceStatus(state, true, DEFAULT_CONFIG);
    expect(state.status).toBe("DOWN");
    state = advanceStatus(state, true, DEFAULT_CONFIG);
    expect(state.status).toBe("HEALTHY");
  });
  it("resets consecutive streaks and honors custom thresholds", () => {
    const config = { ...DEFAULT_CONFIG, failureThreshold: 5, recoveryThreshold: 3 };
    let state = { status: "HEALTHY", failures: 0, successes: 0 };
    for (let i = 0; i < 4; i++) state = advanceStatus(state, false, config);
    expect(state.status).toBe("DEGRADED");
    state = advanceStatus(state, false, config);
    expect(state.status).toBe("DOWN");
    state = advanceStatus(state, true, config);
    state = advanceStatus(state, false, config);
    expect(state.successes).toBe(0);
    expect(advanceStatus({ status: "UNKNOWN", failures: 0, successes: 0 }, true, config).status).toBe("HEALTHY");
  });
  it("distinguishes no data from zero availability", () => {
    expect(availability(0, 0)).toBeNull();
    expect(availability(0, 3)).toBe(0);
    expect(availability(3, 4)).toBe(75);
  });
  it.each([
    [429, "rate limit", "RATE_LIMITED"], [429, "insufficient_quota", "QUOTA_EXCEEDED"],
    [402, '{"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}', "QUOTA_EXCEEDED"],
    [401, "sk-secret-value", "AUTH_ERROR"], [403, "forbidden", "AUTH_ERROR"],
    [404, "model unknown", "MODEL_NOT_FOUND"], [500, "internal", "PROVIDER_ERROR"],
    [null, "fetch failed", "NETWORK_ERROR"], [200, "invalid response", "INVALID_RESPONSE"],
  ])("classifies %s safely", (httpStatus, raw, expected) => {
    const result = classifyFailure({ httpStatus, message: `${raw} Bearer private-token https://user:pass@host/?key=secret` });
    expect(result.errorType).toBe(expected);
    expect(result.errorMessage).not.toMatch(/private-token|sk-secret|user:pass|key=secret/);
  });
  it("recognizes timeouts", () => {
    expect(classifyFailure({ name: "TimeoutError" }).errorType).toBe("TIMEOUT");
  });
  it("validates settings without silently coercing invalid values", () => {
    expect(validateConfig({ intervalSeconds: 300, enabled: true })).toMatchObject({ enabled: true, timeoutSeconds: 15 });
    for (const config of [{ intervalSeconds: 2 }, { timeoutSeconds: 0 }, { failureThreshold: 1.2 }, { enabled: "true" }, { includeInRouting: null }, { recoveryThreshold: 0 }]) {
      expect(() => validateConfig(config)).toThrow();
    }
    expect(DEFAULT_CONFIG.enabled).toBe(false);
  });
});
