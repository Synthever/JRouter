import { buildErrorBody } from "open-sse/utils/error.js";

export class ApiKeyPolicyError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
  response() {
    const body = buildErrorBody(this.status, this.message);
    body.error.code = this.code;
    return Response.json(body, { status: this.status, headers: {
      "Access-Control-Allow-Origin": "*", ...(this.retryAfter ? { "Retry-After": String(this.retryAfter) } : {}),
    } });
  }
}

export function quotaPeriodStart(cycle, now = new Date()) {
  if (cycle === "lifetime") return null;
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  if (cycle !== "hourly") date.setUTCHours(0);
  if (cycle === "weekly") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (cycle === "monthly") date.setUTCDate(1);
  return date.toISOString();
}

function modelMatches(pattern, model) {
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`).test(model);
}

export function assertModelAllowed(policy, identifiers) {
  const models = identifiers.filter((id) => typeof id === "string" && id.length);
  if (policy.blockedModels?.some((pattern) => models.some((id) => modelMatches(pattern, id))) ||
      (policy.allowedModels?.length && !policy.allowedModels.some((pattern) => models.some((id) => modelMatches(pattern, id))))) {
    throw new ApiKeyPolicyError(403, "model_not_allowed", "This model is not allowed for this API key.");
  }
}

export function enforceOutputLimit(body, limit) {
  if (limit == null) return body;
  const candidates = [body.max_tokens, body.max_completion_tokens, body.max_output_tokens, body.generationConfig?.maxOutputTokens, body.options?.num_predict];
  if (candidates.some((value) => value != null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > limit))) {
    throw new ApiKeyPolicyError(400, "max_output_tokens_exceeded", `Maximum output tokens for this API key is ${limit}.`);
  }
  const capped = { ...body };
  if (body.generationConfig) capped.generationConfig = { ...body.generationConfig, maxOutputTokens: body.generationConfig.maxOutputTokens ?? limit };
  else if (body.options) capped.options = { ...body.options, num_predict: body.options.num_predict ?? limit };
  else if (candidates.slice(0, 3).every((v) => v == null)) {
    if (Object.hasOwn(body, "input")) capped.max_output_tokens = limit;
    else capped.max_tokens = limit;
  }
  return capped;
}
