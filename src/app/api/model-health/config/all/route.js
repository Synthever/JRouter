import { applyHealthConfigToAll } from "@/lib/health/service.js";
import { healthRoute, json, bodyFrom } from "@/lib/health/api.js";
export const PUT = healthRoute(async (request) => json(await applyHealthConfigToAll(await bodyFrom(request))));
