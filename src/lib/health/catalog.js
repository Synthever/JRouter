import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getProviderConnections, getProviderNodes, getCustomModels, getDisabledModels, getModelAliases } from "@/lib/db/index.js";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers.js";
import { findModelName } from "@/shared/constants/models.js";

export async function getConfiguredHealthModels() {
  const [connections, nodes, custom, disabled, aliases] = await Promise.all([
    getProviderConnections({ isActive: true }), getProviderNodes(), getCustomModels(), getDisabledModels(), getModelAliases(),
  ]);
  if (!connections.length) return [];
  const activeProviders = new Map();
  for (const connection of connections) {
    const provider = connection.provider;
    const node = nodes.find((item) => item.id === provider);
    for (const alias of [provider, getProviderAlias(provider), connection.providerSpecificData?.prefix, node?.prefix].filter(Boolean)) activeProviders.set(alias, { provider, node });
  }
  const cacheKey = JSON.stringify([connections.map((connection) => [connection.id, connection.provider, connection.providerSpecificData?.prefix, connection.providerSpecificData?.baseUrl, connection.providerSpecificData?.enabledModels]), nodes.map((node) => [node.id, node.name, node.prefix, node.baseUrl]), custom, disabled, aliases]);
  const cache = globalThis.__jrouterHealthCatalog ||= new Map();
  let cached = cache.get(cacheKey);
  if (!cached || cached.expiresAt < Date.now()) {
    // Only model-list discovery can contact upstreams, never inference. Share cold loads.
    cached = { expiresAt: Date.now() + 300000, promise: buildModelsList(["llm"], { skipLiveResolvers: true }) };
    cache.clear(); cache.set(cacheKey, cached);
    cached.promise.catch(() => { if (cache.get(cacheKey) === cached) cache.delete(cacheKey); });
  }
  const catalog = await cached.promise;
  return catalog.flatMap((entry) => {
    if (entry.owned_by === "combo") return [];
    const configured = activeProviders.get(entry.owned_by);
    if (!configured) return [];
    const modelId = entry.id.slice(entry.id.indexOf("/") + 1);
    const alias = entry.owned_by;
    const customModel = custom.find((item) => item.id === modelId && [alias, configured.provider, configured.node?.prefix].includes(item.providerAlias));
    return [{ id: entry.id, modelId, providerId: configured.provider,
      name: customModel?.name || findModelName(configured.provider, modelId) || modelId,
      providerName: configured.node?.name || AI_PROVIDERS[configured.provider]?.name || configured.provider,
      capabilities: entry.capabilities || {} }];
  }).sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name));
}
