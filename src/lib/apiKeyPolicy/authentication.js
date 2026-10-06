import { getApiKeyBySecret } from "@/lib/db/repos/apiKeysRepo.js";
import { ApiKeyPolicyError } from "./rules.js";

export function extractPolicyApiKey(request) {
  if (!request?.headers) return null;
  const authorization = request.headers.get("authorization");
  return (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null) || request.headers.get("x-api-key") || request.headers.get("x-goog-api-key") || new URL(request.url).searchParams.get("key");
}

export async function authenticatePolicyKey(request) {
  const secret = extractPolicyApiKey(request);
  if (!secret) return null;
  const key = await getApiKeyBySecret(secret);
  if (!key || !key.isActive) throw new ApiKeyPolicyError(401, "invalid_api_key", "API key is invalid or inactive.");
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) throw new ApiKeyPolicyError(401, "api_key_expired", "API key has expired.");
  return key;
}
