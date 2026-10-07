import { checkModel } from "@/lib/health/service.js";
import { healthRoute, json, bodyFrom } from "@/lib/health/api.js";
export const runtime = "nodejs";
export const maxDuration = 90;
export const POST = healthRoute(async (request) => {
  const { modelId } = await bodyFrom(request);
  const result = await checkModel(modelId);
  return json(result, result.skipped ? 409 : 200);
});
