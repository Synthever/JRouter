import { afterEach, describe, expect, it, vi } from "vitest";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("alias attempt deadline and cancellation", () => {
  it("rejects overdue first output before the timer task runs", () => {
    vi.useFakeTimers();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
    try {
      vi.setSystemTime(attempt.deadlineAt + 1);
      expect(attempt.signal.aborted).toBe(false);
      expect(attempt.markOutput({ choices: [{ delta: { content: "late" } }] }, "openai")).toBe(false);
      expect(attempt.outputStarted).toBe(false);
      expect(attempt.signal.reason).toMatchObject({ name: "AbortError", code: "ALIAS_ATTEMPT_ABORTED", reason: "initial-output-deadline" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      attempt.dispose();
    }
  });

  it("rechecks elapsed time after semantic inspection before latching output", () => {
    vi.useFakeTimers();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
    const event = { choices: [{ delta: { get content() {
      vi.setSystemTime(attempt.deadlineAt + 1);
      return "late";
    } } }] };
    try {
      expect(attempt.markOutput(event, "openai")).toBe(false);
      expect(attempt.outputStarted).toBe(false);
      expect(attempt.signal.reason).toMatchObject({ reason: "initial-output-deadline" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      attempt.dispose();
    }
  });

  it("clears only the initial timer after semantic output; external cancellation still works", async () => {
    vi.useFakeTimers();
    const client = new AbortController();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 15000, clientSignal: client.signal });

    expect(attempt.markOutput({ choices: [{ delta: { role: "assistant" } }] }, "openai")).toBe(false);
    await vi.advanceTimersByTimeAsync(14000);
    expect(attempt.markOutput({ choices: [{ delta: { reasoning_content: "thinking" } }] }, "openai")).toBe(true);
    await vi.advanceTimersByTimeAsync(25000);
    expect(attempt.signal.aborted).toBe(false);

    client.abort("caller-disconnected");
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toMatchObject({ reason: "client", cause: "caller-disconnected" });
    attempt.dispose();
  });

  it("aborts at the overall initial deadline with a transient-classifiable reason", async () => {
    vi.useFakeTimers();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 15000 });

    await vi.advanceTimersByTimeAsync(14999);
    expect(attempt.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toMatchObject({ name: "AbortError", code: "ALIAS_ATTEMPT_ABORTED", reason: "initial-output-deadline" });
    attempt.dispose();
  });

  it("does not disarm configuration or collection cancellation after output", () => {
    const collection = new AbortController();
    const configuration = new AbortController();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000, collectionSignal: collection.signal, configSignal: configuration.signal });

    expect(attempt.markOutput({ choices: [{ delta: { content: "answer" } }] }, "openai")).toBe(true);
    expect(attempt.signal.aborted).toBe(false);
    configuration.abort("alias-edited");
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toMatchObject({ reason: "configuration", cause: "alias-edited" });
    attempt.dispose();
  });

  it("immediately reflects a pre-aborted source signal", () => {
    const client = new AbortController();
    client.abort("already-gone");
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000, clientSignal: client.signal });

    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toMatchObject({ reason: "client", cause: "already-gone" });
    attempt.dispose();
  });

  it("removes source-signal listeners when disposed", () => {
    const client = new AbortController();
    const add = vi.spyOn(client.signal, "addEventListener");
    const remove = vi.spyOn(client.signal, "removeEventListener");
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000, clientSignal: client.signal });

    attempt.dispose();
    const addedAbortListeners = add.mock.calls.filter(([type]) => type === "abort").length;
    const removedAbortListeners = remove.mock.calls.filter(([type]) => type === "abort").length;
    expect(addedAbortListeners).toBeGreaterThan(0);
    expect(removedAbortListeners).toBe(addedAbortListeners);
  });

  it("creates one single-use refresh and redispatch budget per account for this attempt", () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const accountA = attempt.getAccountRecoveryBudget("provider:connection-a");
    const sameAccountA = attempt.getAccountRecoveryBudget("provider:connection-a");
    const accountB = attempt.getAccountRecoveryBudget("provider:connection-b");

    expect(accountA).toBe(sameAccountA);
    expect(Object.isFrozen(accountA)).toBe(true);
    expect(accountA.claimRefresh()).toBe(true);
    expect(accountA.claimRefresh()).toBe(false);
    expect(accountA.claimRedispatch()).toBe(true);
    expect(accountA.claimRedispatch()).toBe(false);
    expect(accountB.claimRefresh()).toBe(true);
    expect(accountB.claimRedispatch()).toBe(true);
    attempt.dispose();
  });

  it("keeps budgets isolated across attempts and preserves a consumed claim after cancellation", () => {
    const first = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const second = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const firstBudget = first.getAccountRecoveryBudget("provider:session");
    expect(firstBudget.claimRefresh()).toBe(true);
    first.abort("client");

    expect(firstBudget.claimRefresh()).toBe(false);
    expect(second.getAccountRecoveryBudget("provider:session").claimRefresh()).toBe(true);
    first.dispose();
    second.dispose();
  });

  it("rejects invalid or unrepresentable timer values instead of clamping", () => {
    for (const initialResponseTimeoutMs of [0, -1, NaN, Infinity, 2147483648, "15000"]) {
      expect(() => createAliasAttempt({ initialResponseTimeoutMs })).toThrow(/timeout|timer/i);
    }
  });
});
