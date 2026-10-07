import { getAdapter } from "@/lib/db/driver.js";
import * as repo from "@/lib/db/repos/modelHealthRepo.js";
import { getConfiguredHealthModels } from "./catalog.js";
import { checkAllModels } from "./service.js";

export async function runScheduledHealthChecks() {
  const db = await getAdapter();
  // sql.js keeps a private in-memory copy, so its leases cannot coordinate workers.
  if (db.driver === "sql.js") return { available: false, reason: "Scheduled health checks require a native SQLite driver" };
  const lease = await repo.claimLease("scheduler", 120000);
  if (!lease) return;
  const heartbeat = setInterval(() => { repo.renewLease(lease, 120000).catch(() => {}); }, 30000);
  heartbeat.unref?.();
  try {
    if ((await repo.getDueModels(1)).length) {
      const configured = await getConfiguredHealthModels();
      const dueIds = new Set(await repo.getDueModels(30, configured.map((model) => model.id)));
      const models = configured.filter((model) => dueIds.has(model.id));
      await checkAllModels({ models, scheduled: true });
    }
    await repo.pruneHealthHistory();
    return { driver: db.driver };
  } finally { clearInterval(heartbeat); await repo.releaseLease(lease); }
}

export function startHealthScheduler() {
  if (process.env.MODEL_HEALTH_SCHEDULER === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
  const state = globalThis.__jrouterHealthScheduler ||= { timer: null };
  if (state.timer) return;
  const tick = async () => {
    try { await runScheduledHealthChecks(); } catch { console.warn("[Model Health] Scheduled checks unavailable; will retry on the next tick"); }
    state.timer = setTimeout(tick, 15000);
    state.timer.unref?.();
  };
  state.timer = setTimeout(tick, 30000);
  state.timer.unref?.();
}
