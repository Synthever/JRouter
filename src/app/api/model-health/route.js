import { getModelsHealth, summarizeHealth, getHealthHistory } from "@/lib/health/service.js";
import { healthRoute, json, rangeFrom } from "@/lib/health/api.js";
import { getAdapter } from "@/lib/db/driver.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = healthRoute(async (request) => {
  const [models, history, db] = await Promise.all([getModelsHealth(), getHealthHistory(null, rangeFrom(request)), getAdapter()]);
  return json({ models, summary: summarizeHealth(models), history, updatedAt: Date.now(),
    scheduler: { enabled: process.env.MODEL_HEALTH_SCHEDULER !== "false", available: db.driver !== "sql.js" } });
});
