import { getModelHealth, HealthError } from "@/lib/health/service.js";
import { healthRoute, json, modelIdFrom, rangeFrom } from "@/lib/health/api.js";
export const GET = healthRoute(async (request) => {
  const page = Number(new URL(request.url).searchParams.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new HealthError("Invalid history page");
  return json(await getModelHealth(modelIdFrom(request), rangeFrom(request), page));
});
