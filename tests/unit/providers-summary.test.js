import { describe, expect, it } from "vitest";
import { computeProviderSummary } from "@/app/(dashboard)/dashboard/providers/utils.js";

const provider = (id, name, total, extra = {}) => ({
  id,
  name,
  stats: { total, allDisabled: false, connected: total, error: 0 },
  ...extra,
});

describe("providers summary strip", () => {
  it("counts the whole catalog and the providers carrying connections", () => {
    const summary = computeProviderSummary([
      provider("alpha", "Alpha", 2),
      provider("beta", "Beta", 0),
      provider("gamma", "Gamma", 5),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.activeCount).toBe(2);
    expect(summary.topProvider).toEqual({
      id: "gamma",
      name: "Gamma",
      connections: 5,
    });
  });

  it("ignores providers whose connections are all disabled", () => {
    const summary = computeProviderSummary([
      provider("alpha", "Alpha", 4, {
        stats: { total: 4, allDisabled: true, connected: 0, error: 0 },
      }),
      provider("beta", "Beta", 1),
    ]);

    expect(summary.activeCount).toBe(1);
    expect(summary.topProvider.name).toBe("Beta");
    expect(summary.total).toBe(2);
  });

  it("breaks connection-count ties alphabetically", () => {
    const summary = computeProviderSummary([
      provider("zed", "Zed", 3),
      provider("kilo", "Kilo", 3),
    ]);

    expect(summary.topProvider.name).toBe("Kilo");
  });

  it("counts only free entries for the free-to-try card and lists noAuth ones", () => {
    const summary = computeProviderSummary([
      provider("paid", "Paid", 0),
      provider("free-a", "Free A", 0, { free: true }),
      provider("free-b", "Free B", 0, { free: true, noAuth: true }),
      provider("free-c", "Free C", 0, { free: true, noAuth: true }),
    ]);

    expect(summary.freeCount).toBe(3);
    expect(summary.readyFreeNames).toEqual(["Free B", "Free C"]);
  });

  it("returns an empty summary for an empty catalog", () => {
    const summary = computeProviderSummary();

    expect(summary).toEqual({
      total: 0,
      activeCount: 0,
      topProvider: null,
      freeCount: 0,
      readyFreeNames: [],
    });
  });
});
