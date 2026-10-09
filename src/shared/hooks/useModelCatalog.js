"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always shown in the model selector
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth);

// Providers with per-account live catalogs via /api/providers/[id]/models.
// Static registry stays as fallback when the live fetch fails or is empty.
const LIVE_CATALOG_PROVIDERS = ["cursor", "cline", "clinepass", "zed"];

// Kinds where the provider IS the model (no per-model selection needed)
const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
// Kinds that map directly to the model.type field
const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
// For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

// Reject values that are not plain "provider/model" catalog entries, so a hostile
// or malformed /api/models/alias payload cannot smuggle a scheme into the UI.
function isSafeAliasValue(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("://");
}

const EMPTY_MODELS = [];

// Fetch a provider's account-scoped catalog for every active connection and merge
// the results. Entries collapse by model id on purpose: two connections of the
// same provider produce the same picker value (`alias/id`), so keeping the first
// avoids duplicate rows. There is no per-connection metadata to preserve beyond
// {id,name}. Empty array means "nothing live" so callers keep the static fallback.
function useLiveProviderModels(isOpen, connectionIds, label) {
  const [models, setModels] = useState([]);
  const idsKey = isOpen ? (connectionIds ?? []).join("|") : "";

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    if (ids.length === 0) return undefined;

    let cancelled = false;
    Promise.all(ids.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set();
        setModels(modelLists.flat().filter((model) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        // Do not hide the static fallback when the account catalog is unavailable.
        console.warn(`Unable to load ${label} models for selector:`, error);
        if (!cancelled) setModels([]);
      });

    return () => { cancelled = true; };
  }, [idsKey, label]);

  // Derived from the same guard as the fetch, so an unopened or connection-less
  // provider never needs a state reset.
  return idsKey ? models : EMPTY_MODELS;
}

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    const data = await response.json();
    if (data === null || typeof data !== "object") return fallback;
    return data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return fallback;
  }
}

/**
 * One source of truth for the model picker: combos, connected-provider catalogs,
 * custom/disabled model handling and filtering. Both the Modal-based picker and the
 * inline Playground popover read from this hook so their behavior cannot drift.
 */
export function useModelCatalog({
  isOpen = true,
  activeProviders = [],
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
} = {}) {
  const { getCaps } = useModelCaps();
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    Promise.all([
      fetchJson("/api/combos", {}),
      fetchJson("/api/provider-nodes", {}),
      fetchJson("/api/models/custom", {}),
      fetchJson("/api/models/disabled", {}),
    ]).then(([comboData, nodeData, customData, disabledData]) => {
      if (cancelled) return;
      setCombos(Array.isArray(comboData.combos) ? comboData.combos : []);
      setProviderNodes(Array.isArray(nodeData.nodes) ? nodeData.nodes : []);
      setCustomModels(Array.isArray(customData.models) ? customData.models : []);
      setDisabledModels(disabledData.disabled && typeof disabledData.disabled === "object" ? disabledData.disabled : {});
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Filter activeProviders by serviceKinds when kindFilter is set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);

  // Cursor/Cline/Zed expose the usable catalog per account, so the static catalog is
  // kept only as a fallback: it goes stale quickly and entitlements differ per account.
  const liveConnectionIdsByProvider = useMemo(() => {
    const map = Object.fromEntries(LIVE_CATALOG_PROVIDERS.map((id) => [id, []]));
    for (const p of activeProviders) {
      if (p?.id && Object.prototype.hasOwnProperty.call(map, p.provider)) map[p.provider].push(p.id);
    }
    return map;
  }, [activeProviders]);

  const cursorModels = useLiveProviderModels(isOpen, liveConnectionIdsByProvider.cursor, "Cursor");
  const clineModels = useLiveProviderModels(isOpen, liveConnectionIdsByProvider.cline, "Cline");
  const clinepassModels = useLiveProviderModels(isOpen, liveConnectionIdsByProvider.clinepass, "ClinePass");
  const zedModels = useLiveProviderModels(isOpen, liveConnectionIdsByProvider.zed, "Zed");

  const allProviders = useMemo(
    () => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }),
    []
  );

  // Group models by provider with priority order
  const groups = useMemo(() => {
    const result = {};

    // No kindFilter means the LLM selector. Custom models stay visible because
    // user-added models may have typed capabilities (for example imageToText)
    // while still being valid chat/combo targets.
    const filterByKind = (models) => {
      if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
    };

    const activeConnectionIds = filteredActiveProviders.map((p) => p.provider);

    const noAuthIds = kindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter))
      : NO_AUTH_PROVIDER_IDS;

    // Registered compatible models remain selectable without a saved API key.
    const compatibleNodeIds = kindFilter
      ? []
      : customModels
          .map((m) => m.providerAlias)
          .filter((alias) => isOpenAICompatibleProvider(alias) || isAnthropicCompatibleProvider(alias));
    const providerIdsToShow = new Set([...activeConnectionIds, ...noAuthIds, ...compatibleNodeIds]);

    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    const aliases = Object.entries(modelAliases).filter(([, fullModel]) => isSafeAliasValue(fullModel));

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        result[providerId] = {
          name: providerInfo.name,
          alias,
          color: providerInfo.color,
          models: [{ id: providerId, name: providerInfo.name, value: providerId }],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = aliases
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
            isCustom: true,
          }));

        // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
          combined = [
            ...registeredTyped,
            ...getModelsByProviderId(providerId)
              .filter((m) => getModelKind(m) === kindFilter)
              .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
              .filter((m) => !registeredTyped.some((registered) => registered.value === m.value)),
          ];
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
            if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        } else {
          // LLM/null kind: merge hardcoded models (e.g. mimo-free → mimo-auto) with user-added models
          const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
          const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
          const hardcoded = getModelsByProviderId(providerId)
            .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !seen.has(m.value));
          combined = [
            ...registeredLlms,
            ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)),
            ...hardcoded,
          ];
        }

        if (combined.length > 0) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find((node) => node.id === providerId);
          result[providerId] = {
            name: matchedNode?.name || providerInfo.name,
            alias,
            color: providerInfo.color,
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        // Custom (openai/anthropic-compatible) providers are LLM-only — skip for typed media kinds
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        const connection = activeProviders.find((p) => p.provider === providerId);
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

        // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
        // so we must filter by providerId, not by the display prefix.
        const nodeModels = aliases
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        // Merge custom models registered via /api/models/custom for this provider
        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${nodePrefix}/${m.id}`,
            isCustom: true,
          }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];

        // Always show compatible providers that are connected, even with no aliases.
        const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
          id: `__placeholder__${providerId}`,
          name: `${nodePrefix}/model-id`,
          value: `${nodePrefix}/model-id`,
          isPlaceholder: true,
        }];

        result[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color,
          models: modelsToShow,
          isCustom: true,
          hasModels: mergedModels.length > 0,
        };
      } else {
        const liveModels = providerId === "cursor"
          ? cursorModels
          : providerId === "cline"
            ? clineModels
            : providerId === "clinepass"
              ? clinepassModels
              : providerId === "zed"
                ? zedModels
                : [];
        const hardcodedModels = liveModels.length > 0 ? liveModels : getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        // Custom models: when the provider has no hardcoded models (e.g. openrouter),
        // show all aliases; otherwise only aliases whose name equals the model id.
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = aliases
          .filter(([aliasName, fullModel]) =>
            fullModel.startsWith(`${alias}/`) &&
            (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
            !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
          )
          .map(([aliasName, fullModel]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
          });

        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));

        const merged = [
          ...hardcodedModels.map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];
        // Dedupe by value (alias may equal a hardcoded id, causing React key collision)
        const seen = new Set();
        let allModels = filterByKind(merged.filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        }));

        // Provider-as-model fallback: providers that support the kind but have no hardcoded models
        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
        }

        if (allModels.length > 0) {
          result[providerId] = {
            name: providerInfo.name,
            alias,
            color: providerInfo.color,
            models: allModels,
          };
        }
      }
    });

    // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
    Object.entries(result).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete result[providerId];
    });

    return result;
  }, [
    filteredActiveProviders,
    modelAliases,
    allProviders,
    providerNodes,
    customModels,
    disabledModels,
    kindFilter,
    activeProviders,
    cursorModels,
    clineModels,
    clinepassModels,
    zedModels,
  ]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter((c) => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter, capFilter]);

  // Sort models alphabetically, with added models floated to top
  const sortModels = (models, addedValues) => {
    if (!addedValues?.length) return [...models].sort((a, b) => a.name.localeCompare(b.name));
    const added = models.filter((m) => addedValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter((m) => !addedValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  // Filter models by input-modality capability + search query, then order added models first.
  const visibleGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = {};
    Object.entries(groups).forEach(([providerId, group]) => {
      let models = group.models;
      if (capFilter) {
        models = models.filter((m) => getCaps(m.value)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = { ...group, models: sortModels(models, addedModelValues) };
    });
    return filtered;
  }, [groups, searchQuery, capFilter, addedModelValues, getCaps]);

  return {
    groups,
    visibleGroups,
    filteredCombos,
    searchQuery,
    setSearchQuery,
    providerNodes,
    customModels,
  };
}

export default useModelCatalog;
