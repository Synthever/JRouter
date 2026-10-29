import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ models: vi.fn(), saveAll: vi.fn() }));
vi.mock("@/lib/health/catalog.js", () => ({ getConfiguredHealthModels: mocks.models }));
vi.mock("@/lib/health/probe.js", () => ({ probeModel: vi.fn() }));
vi.mock("@/lib/db/repos/modelHealthRepo.js", () => ({ saveHealthConfigs: mocks.saveAll }));
import { HealthError, applyHealthConfigToAll } from "@/lib/health/service.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue([{ id: "oa/gpt" }, { id: "oa/claude" }]);
  mocks.saveAll.mockResolvedValue(2);
});

describe("apply health config to all models", () => {
  it("saves the validated config once for every configured model", async () => {
    const result = await applyHealthConfigToAll({ enabled: true, intervalSeconds: 300, timeoutSeconds: 20, failureThreshold: 4, recoveryThreshold: 2, includeInRouting: true });
    expect(mocks.saveAll).toHaveBeenCalledTimes(1);
    const [ids, config] = mocks.saveAll.mock.calls[0];
    expect(ids).toEqual(["oa/gpt", "oa/claude"]);
    expect(config).toMatchObject({ enabled: true, intervalSeconds: 300, timeoutSeconds: 20, failureThreshold: 4, recoveryThreshold: 2, includeInRouting: true });
    expect(result.updated).toBe(2);
    expect(result.config).toEqual(config);
  });

  it("rejects invalid settings before touching any model", async () => {
    await expect(applyHealthConfigToAll({ intervalSeconds: 2 })).rejects.toBeInstanceOf(HealthError);
    expect(mocks.saveAll).not.toHaveBeenCalled();
  });

  it("still succeeds when no models are configured", async () => {
    mocks.models.mockResolvedValue([]);
    mocks.saveAll.mockResolvedValue(0);
    const result = await applyHealthConfigToAll({ intervalSeconds: 600 });
    expect(mocks.saveAll).toHaveBeenCalledWith([], expect.objectContaining({ intervalSeconds: 600 }));
    expect(result.updated).toBe(0);
  });
});
