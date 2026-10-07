import { getHealthHistory } from "@/lib/health/service.js";
import { healthRoute, json, rangeFrom } from "@/lib/health/api.js";
export const GET = healthRoute(async (request) => json(await getHealthHistory(new URL(request.url).searchParams.get("modelId"), rangeFrom(request))));
