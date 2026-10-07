import { runScheduledHealthChecks } from "@/lib/health/scheduler.js";
import { healthRoute, json } from "@/lib/health/api.js";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = healthRoute(async () => json({ result: await runScheduledHealthChecks() || null }));
