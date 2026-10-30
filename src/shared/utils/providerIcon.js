// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "ollama-search": "ollama",
  // MiniMax Code rides the existing MiniMax brand mark
  "minimax-code": "minimax",
  "minimax-code-global": "minimax",
};

// Icons served from a CDN instead of /public/providers
const REMOTE_ICONS = {
  claude: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/claude/default.svg",
};

// Icons with a separate light-mode variant (dark variant is the default)
const REMOTE_ICONS_LIGHT = {
  cursor: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/cursor/mono.svg",
  openai: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/openai/light.svg",
  anthropic: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/anthropic/light.svg",
};

const REMOTE_ICONS_DARK = {
  cursor: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/cursor/default.svg",
  openai: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/openai/dark.svg",
  anthropic: "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/anthropic/dark.svg",
};

// Custom compatible endpoints get generated ids; show their protocol's brand mark.
const COMPATIBLE_ICON_IDS = [
  ["openai-compatible-", "openai"],
  ["anthropic-compatible-", "anthropic"],
];

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set();

function normalizeId(providerId) {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
export function resolveProviderIconId(providerId) {
  const id = normalizeId(providerId);
  if (!id) return "";
  if (failedIds.has(id)) return "";
  const aliased = ICON_ALIASES[id] || id;
  const compatible = COMPATIBLE_ICON_IDS.find(([prefix]) => aliased.startsWith(prefix));
  const resolved = compatible ? compatible[1] : aliased;
  if (failedIds.has(resolved)) return "";
  return resolved;
}

/** Remote URL or `/providers/{id}.png`; null when previously failed. */
export function getProviderIconSrc(providerId, { isDark = true } = {}) {
  const id = resolveProviderIconId(providerId);
  if (!id) return null;
  if (REMOTE_ICONS_LIGHT[id]) return isDark ? REMOTE_ICONS_DARK[id] : REMOTE_ICONS_LIGHT[id];
  return REMOTE_ICONS[id] || `/providers/${id}.png`;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId) {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}
