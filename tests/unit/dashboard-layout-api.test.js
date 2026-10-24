import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getDashboardKpiLayout: vi.fn(),
  saveDashboardKpiLayout: vi.fn(),
  clearDashboardKpiLayout: vi.fn(),
}));
vi.mock("@/lib/db/repos/dashboardLayoutRepo.js", () => repo);

import { DELETE, GET, PUT, dynamic as routeDynamic } from "@/app/api/dashboard/layout/route.js";
import {
  DEFAULT_KPI_LAYOUT, KPI_ITEMS, KPI_LAYOUT_STORAGE_KEY, sanitizeKpiLayout,
} from "@/shared/constants/dashboardKpi.js";

const LAYOUT_URL = "http://localhost/api/dashboard/layout";
const UPDATED_AT = "2026-10-24T00:00:00.000Z";

function request(method = "GET", body) {
  return new Request(LAYOUT_URL, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getDashboardKpiLayout.mockResolvedValue(null);
  repo.saveDashboardKpiLayout.mockImplementation(async (layout) => ({ layout, updatedAt: UPDATED_AT }));
  repo.clearDashboardKpiLayout.mockResolvedValue(undefined);
});

describe("shared dashboard KPI layout constants", () => {
  it("keeps the storage key and reference item order stable", () => {
    expect(KPI_LAYOUT_STORAGE_KEY).toBe("jrouter.dashboard.kpiLayout.v1");
    expect(KPI_ITEMS.map((item) => item.id)).toEqual(["requests", "cost", "connections", "success", "tokens"]);
    expect(KPI_ITEMS.map((item) => item.defaultSpan)).toEqual([2, 2, 2, 3, 3]);
  });

  it("uses the reference layout for non-array input", () => {
    const expected = [
      { id: "requests", span: 2 }, { id: "cost", span: 2 }, { id: "connections", span: 2 },
      { id: "success", span: 3 }, { id: "tokens", span: 3 },
    ];
    for (const value of [null, undefined, "layout", 42, {}, { layout: [] }]) {
      expect(sanitizeKpiLayout(value)).toEqual(expected);
    }
    expect(DEFAULT_KPI_LAYOUT).toEqual(expected);
  });

  it("keeps the first known id, drops unknown ids and never leaks extra fields", () => {
    expect(sanitizeKpiLayout([
      { id: "cost", span: 3 }, { id: "missing", span: 6 }, { id: "cost", span: 6 },
      { id: "requests", span: 2, secret: "ignored" }, null, 7, "tokens",
    ])).toEqual([
      { id: "cost", span: 3 }, { id: "requests", span: 2 },
      { id: "connections", span: 2 }, { id: "success", span: 3 }, { id: "tokens", span: 3 },
    ]);
  });

  it("rounds and clamps spans to 2..6 and falls back to the default for non-numbers", () => {
    const [requests, cost, connections, success] = sanitizeKpiLayout([
      { id: "requests", span: 1 }, { id: "cost", span: 7 },
      { id: "connections", span: 3.6 }, { id: "success", span: "5" },
    ]);
    expect([requests.span, cost.span, connections.span, success.span]).toEqual([2, 6, 4, 3]);
    expect(sanitizeKpiLayout([{ id: "requests", span: Infinity }, { id: "cost", span: -100 }]).slice(0, 2))
      .toEqual([{ id: "requests", span: 2 }, { id: "cost", span: 2 }]);
  });

  it("appends every missing known id after the saved order", () => {
    expect(sanitizeKpiLayout([{ id: "tokens", span: 4 }])).toEqual([
      { id: "tokens", span: 4 }, { id: "requests", span: 2 }, { id: "cost", span: 2 },
      { id: "connections", span: 2 }, { id: "success", span: 3 },
    ]);
  });
});

describe("dashboard layout API route", () => {
  it("is never statically cached", () => {
    expect(routeDynamic).toBe("force-dynamic");
  });

  it("returns an empty layout when nothing is stored", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ layout: null, updatedAt: null });
  });

  it("returns the stored layout and timestamp", async () => {
    const saved = [{ id: "cost", span: 4 }, { id: "requests", span: 2 }];
    repo.getDashboardKpiLayout.mockResolvedValue({ layout: saved, updatedAt: UPDATED_AT });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ layout: saved, updatedAt: UPDATED_AT });
  });

  it("does not leak database errors on read", async () => {
    repo.getDashboardKpiLayout.mockRejectedValue(new Error("SQLITE_CORRUPT: /var/data/db.sqlite"));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to load layout" });
    expect(JSON.stringify(body)).not.toContain("SQLITE_CORRUPT");
  });

  it("canonicalizes and saves an array layout", async () => {
    const response = await PUT(request("PUT", {
      layout: [{ id: "tokens", span: 99, extra: "drop" }, { id: "unknown", span: 2 }],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(repo.saveDashboardKpiLayout).toHaveBeenCalledExactlyOnceWith([
      { id: "tokens", span: 6 }, { id: "requests", span: 2 }, { id: "cost", span: 2 },
      { id: "connections", span: 2 }, { id: "success", span: 3 },
    ]);
    expect(body).toEqual({ layout: repo.saveDashboardKpiLayout.mock.calls[0][0], updatedAt: UPDATED_AT });
  });

  it.each([
    ["missing body", "PUT", undefined],
    ["unknown method body", "PUT", {}],
    ["null layout", "PUT", { layout: null }],
    ["string layout", "PUT", { layout: "requests" }],
    ["object layout", "PUT", { layout: { id: "requests", span: 2 } }],
    ["malformed JSON", "PUT", "{not-json"],
  ])("rejects %s with 400 without touching the repo", async (_label, method, body) => {
    const response = await PUT(request(method, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid layout" });
    expect(repo.saveDashboardKpiLayout).not.toHaveBeenCalled();
  });

  it("does not leak database errors on write", async () => {
    repo.saveDashboardKpiLayout.mockRejectedValue(new Error("disk I/O error at C:\\data\\jrouter.sqlite"));
    const response = await PUT(request("PUT", { layout: [{ id: "requests", span: 2 }] }));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to save layout" });
    expect(JSON.stringify(body)).not.toContain("disk I/O");
  });

  it("clears the stored layout", async () => {
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(repo.clearDashboardKpiLayout).toHaveBeenCalledOnce();
  });

  it("responds with a generic error when the reset fails", async () => {
    repo.clearDashboardKpiLayout.mockRejectedValue(new Error("database is locked"));
    const response = await DELETE();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to reset layout" });
    expect(JSON.stringify(body)).not.toContain("database is locked");
  });
});
