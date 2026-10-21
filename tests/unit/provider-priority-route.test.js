import { beforeEach, describe, expect, it, vi } from "vitest";

const swap = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ swapProviderConnectionPriorities: swap }));
vi.mock("@/models", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/providerConnectionResponse", () => ({}));
import * as route from "@/app/api/providers/[id]/route.js";
const request = (body) => new Request("http://localhost/api/providers/A", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "A" }) };
beforeEach(() => { swap.mockReset(); });

describe("manual priority swap API", () => {
  it("performs one ID-based swap without accepting priority or health updates", async () => {
    const response = await route.PATCH(request({ swapWithId: "B", priority: 99, demotedAt: null }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(swap).toHaveBeenCalledExactlyOnceWith("A", "B");
  });

  it.each([400, 404])("preserves expected validation status %i", async (status) => {
    swap.mockRejectedValue(Object.assign(new Error("Synthetic validation error"), { status }));
    const response = await route.PATCH(request({ swapWithId: "B" }), params);
    expect(response.status).toBe(status);
  });

  it("does not expose unexpected storage errors", async () => {
    swap.mockRejectedValue(new Error("Synthetic private database path"));
    const response = await route.PATCH(request({ swapWithId: "B" }), params);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database");
  });
});
