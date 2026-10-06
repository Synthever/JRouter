export const API_KEY_ENDPOINTS = [
  { value: "chat", label: "Chat / Responses", hint: "Chat completions, Responses, Claude, Gemini and Ollama" },
  { value: "embeddings", label: "Embeddings", hint: "Text embeddings" },
  { value: "images", label: "Images", hint: "Image generation" },
  { value: "audio", label: "Audio", hint: "Speech, transcription and voices" },
  { value: "web", label: "Web / Search", hint: "Search and web fetch" },
  { value: "videos", label: "Videos", hint: "Generation, edits, extensions and job status" },
  { value: "systemone", label: "SystemOne", hint: "SystemOne browser automation" },
];

export const QUOTA_CYCLES = ["lifetime", "hourly", "daily", "weekly", "monthly"];
export const DEFAULT_KEY_POLICY = {
  description: "", maxTokensQuota: null, maxCostUsd: null, quotaResetCycle: "lifetime",
  tokenMultiplier: 1, maxOutputTokens: null, rateLimitRpm: null, rateLimitTpm: null,
  expiresAt: null, allowedModels: [], blockedModels: [], allowedEndpoints: null,
};

export const POLICY_RESERVATION_TTL_MS = 30 * 60 * 1000;
export const POLICY_RATE_WINDOW_MS = 60 * 1000;
export const POLICY_ESTIMATED_OUTPUT_TOKENS = 4096;

export function endpointFamily(pathname) {
  const path = pathname.replace(/^\/api(?=\/v1)/, "");
  if (path.includes("/audio/")) return "audio";
  if (path.includes("/images/")) return "images";
  if (path.includes("/videos/")) return "videos";
  if (path.endsWith("/embeddings")) return "embeddings";
  if (path.includes("/search") || path.includes("/web/")) return "web";
  if (path.endsWith("/systemone")) return "systemone";
  return "chat";
}
