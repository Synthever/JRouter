import { requireModel, updateHealthConfig } from "@/lib/health/service.js";
import { getHealthConfig } from "@/lib/db/repos/modelHealthRepo.js";
import { DEFAULT_CONFIG } from "@/lib/health/logic.js";
import { healthRoute, json, modelIdFrom, bodyFrom } from "@/lib/health/api.js";
export const GET = healthRoute(async (request) => {
  const id = modelIdFrom(request);
  await requireModel(id);
  const config = await getHealthConfig(id);
  return json({ config: Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, config[key]])) });
});
export const PUT = healthRoute(async (request) => json({ config: await updateHealthConfig(modelIdFrom(request), await bodyFrom(request)) }));
