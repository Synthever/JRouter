import { getHealthSummary } from "@/lib/health/service.js";
import { healthRoute, json } from "@/lib/health/api.js";
export const GET = healthRoute(async () => json(await getHealthSummary()));
