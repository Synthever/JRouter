// Usage rows persist raw provider ids. Every surface that renders a provider
// name must show the resolved label instead — in particular a compatible node
// that has been deleted keeps its generated id in history and must degrade to
// "Custom provider" rather than leaking the uuid.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const DELETED_NODE_ID = "openai-compatible-chat-dbd29ab7-ec2a-4cf6-afe5-bed174f3f67f";

let tempDir;
let adapter;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jrouter-provider-labels-"));
  vi.stubEnv("DATA_DIR", tempDir);
  vi.stubEnv("ENABLE_REQUEST_LOGS", "false");
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

beforeEach(() => {
  adapter.exec("DELETE FROM usageHistory; DELETE FROM usageDaily;");
});

afterAll(() => {
  adapter?.close();
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seed() {
  await db.saveRequestUsage({
    provider: DELETED_NODE_ID, model: "deepseek-v4.1-flash",
    tokens: { prompt_tokens: 10, completion_tokens: 2 }, status: "ok",
  });
  await db.saveRequestUsage({
    provider: "river", model: "deepseek-ai/DeepSeek-V4.1-Flash",
    tokens: { prompt_tokens: 20, completion_tokens: 3 }, status: "ok",
  });
}

describe("provider labels on usage surfaces", () => {
  it("labels byProvider buckets in both the live and the daily aggregation paths", async () => {
    await seed();

    for (const period of ["24h", "7d"]) {
      const stats = await db.getUsageStats(period);
      expect(stats.byProvider[DELETED_NODE_ID].label, period).toBe("Custom provider");
      expect(stats.byProvider.river.label, period).toBe("River");
      // Request totals still key on the raw id; only the label changed.
      expect(stats.byProvider[DELETED_NODE_ID].requests, period).toBe(1);
    }
  });

  it("labels recent requests and the request-logs feed", async () => {
    await seed();

    const stats = await db.getUsageStats("24h");
    expect(stats.recentRequests.map((row) => row.providerLabel).sort()).toEqual(["Custom provider", "River"]);

    const logs = await db.getRecentLogs(10, { format: "json" });
    expect(logs.map((row) => row.providerLabel).sort()).toEqual(["Custom provider", "River"]);
    // The raw id stays available for filtering/debugging.
    expect(logs.map((row) => row.provider).sort()).toEqual([DELETED_NODE_ID, "river"].sort());
  });

  it("resolves a live compatible node to its configured name", async () => {
    const liveNodeId = "openai-compatible-chat-2bf75408-9a1b-4ebb-910c-929dbbfef720";
    const now = new Date().toISOString();
    adapter.run(
      "INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
      [liveNodeId, "openai-compatible", "Dahl", "{}", now, now],
    );
    await db.saveRequestUsage({ provider: liveNodeId, model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });

    const stats = await db.getUsageStats("24h");
    expect(stats.byProvider[liveNodeId].label).toBe("Dahl");
  });
});
