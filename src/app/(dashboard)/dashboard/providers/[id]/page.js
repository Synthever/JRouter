"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, ZedAuthModal, XiaomiMimoAuthModal, IFlowCookieModal, GitLabAuthModal, Toggle, Select, EditConnectionModal, NoAuthProxyCard, ConfirmModal } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { translate } from "@/i18n/runtime";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { applyDemotionOverlay } from "@/sse/services/demotion.js";
import ModelRow from "./ModelRow";
import PassthroughModelsSection from "./PassthroughModelsSection";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import ProviderDetailStats from "./ProviderDetailStats";
import AddApiKeyModal from "./AddApiKeyModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import BulkImportGrokCliModal from "./BulkImportGrokCliModal";
import CustomConfigCard from "./CustomConfigCard";
import styles from "../providers.module.css";
import AutoPingScheduleModal from "./AutoPingScheduleModal";
import { getScheduleSlotLabels } from "@/shared/services/quotaPingSchedule";

const ONE_BY_ONE_DELAY_MS = 1000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const { getCaps } = useModelCaps();
  const [connections, setConnections] = useState([]);
  const reorderBusy = useRef(false);
  const [reordering, setReordering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showXiaomiMimoModal, setShowXiaomiMimoModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showBulkImportGrokCli, setShowBulkImportGrokCli] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState(() => new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  // null = default ON (no explicit setting persisted); false = user opted out
  const [providerDemoteOnError, setProviderDemoteOnError] = useState(null);
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [autoPing, setAutoPing] = useState({ enabled: false, connections: {}, schedules: {} });
  const [scheduleConnection, setScheduleConnection] = useState(null);
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [liveModels, setLiveModels] = useState([]);
  // Live-catalog fetch warning/error (surfaced for zed only; cursor behavior unchanged).
  const [liveModelsError, setLiveModelsError] = useState(null);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const stopOneByOneRef = useRef(false);
  const [importingQoderModels, setImportingQoderModels] = useState(false);
  const [importingClineModels, setImportingClineModels] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const openOAuthConnection = () => {
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    // Xiaomi Desktop: auto-import local credentials first, OAuth as fallback
    if (providerId === "xiaomi-mimo") {
      setShowXiaomiMimoModal(true);
      return;
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = () => {
    if (isOAuth) {
      triggerOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]);
  const authModes = providerInfo?.authModes || [];
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId] || authModes.includes("oauth");
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const staticModels = getModelsByProviderId(providerId);
  const models = (providerId === "cursor" || providerId === "zed") && liveModels.length > 0
    ? liveModels
    : staticModels;
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel =
    providerId === "xai" ? "Grok Build OAuth"
    : providerId === "grok-cli" ? "Grok CLI Device Login"
    : providerId === "kimi" ? "Kimi Coding OAuth"
    : "OAuth";
  const apiKeyConnectionLabel =
    providerId === "xai" ? "xAI API Key"
    : providerId === "kimi" ? "Kimi API Key"
    : (providerId === "qoder" || providerId === "qoder-cn") ? "PAT"
    : "API Key";
  // Resolve suffix "(level)" for a model when a thinking level is picked and the model supports it.
  const resolveThinkingSuffix = (modelId) => {
    if (!thinkingMode || thinkingMode === "auto") return null;
    const levels = getThinkingLevels(providerId, modelId);
    return levels && levels.includes(thinkingMode) ? thinkingMode : null;
  };
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  // Union of levels across this provider's reasoning models — drives the level picker options.
  // Include custom models too (e.g. manually added gpt-5.6-sol → max).
  const providerThinkingLevels = (() => {
    const set = new Set();
    const seen = new Set();
    const addLevels = (modelId) => {
      if (!modelId || seen.has(modelId)) return;
      seen.add(modelId);
      const lv = getThinkingLevels(providerId, modelId);
      if (lv) lv.forEach((l) => { if (l !== "none") set.add(l); });
    };
    for (const m of models) addLevels(m.id);
    for (const m of kiloFreeModels) addLevels(m.id);
    for (const entry of customModels) {
      if (entry.providerAlias !== providerStorageAlias) continue;
      if ((entry.kind || entry.type || "llm") !== "llm") continue;
      addLevels(entry.id);
    }
    return set.size ? ["auto", ...[...set]] : null;
  })();
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.log("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids) => {
    if (!ids.length) return;
    setConfirmState({
      title: "Disable All Models",
      message: `Disable all ${ids.length} model(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
          });
          if (res.ok) await fetchDisabledModels();
        } catch (error) {
          console.log("Error disabling all models:", error);
        }
      }
    });
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling all models:", error);
    }
  };

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.log("Error fetching custom models:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Move-on-error toggle: absent = ON (default); only false = explicitly off
      setProviderDemoteOnError(override.demoteOnError === false ? false : null);
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {}, schedules: apCfg.schedules || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  // Move-on-error per-provider toggle. Default is ON with nothing persisted;
  // persist demoteOnError:false only when the user opts out, and drop the key
  // again when they re-enable (absent = ON for every provider).
  const handleDemoteOnErrorToggle = async (enabled) => {
    setProviderDemoteOnError(enabled ? null : false);
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};
      const existing = { ...(current[providerId] || {}) };
      if (enabled) delete existing.demoteOnError;
      else existing.demoteOnError = false;
      const updated = { ...current };
      if (Object.keys(existing).length === 0) delete updated[providerId];
      else updated[providerId] = existing;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.log("Error saving demoteOnError toggle:", error);
    }
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.log("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveAutoPing = async (next) => {
    const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!autoPingSettingsKey) return;

    setAutoPing(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [autoPingSettingsKey]: next }),
      });
    } catch (error) {
      console.log("Error saving auto-ping config:", error);
    }
  };

  const handleSaveAutoPing = (connectionId, { reactive, schedule }) => {
    saveAutoPing({
      ...autoPing,
      connections: { ...autoPing.connections, [connectionId]: reactive },
      schedules: { ...autoPing.schedules, [connectionId]: schedule },
    });
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();
    fetchCustomModels();
    fetchDisabledModels();
  }, [fetchConnections, fetchAliases, fetchCustomModels, fetchDisabledModels]);

  // Keep runtime badges (demoted / cooldown / lastError) live while the page is open.
  useEffect(() => {
    const t = setInterval(() => { fetchConnections(); }, 5000);
    return () => clearInterval(t);
  }, [fetchConnections]);

  // Live per-connection catalogs (cursor, zed): the static registry carries
  // no usable list, so resolve from the active connection. Fires only when
  // the provider id or connection list changes — no polling, no loop.
  // Cursor path is statement-identical to before; zed adds error surfacing.
  useEffect(() => {
    const isLiveCatalog = providerId === "cursor" || providerId === "zed";
    if (!isLiveCatalog) {
      setLiveModels([]);
      return;
    }

    const connection = connections.find((item) => item.isActive !== false);
    if (!connection?.id) {
      setLiveModels([]);
      if (providerId === "zed") setLiveModelsError(null);
      return;
    }

    let cancelled = false;
    if (providerId === "zed") setLiveModelsError(null);
    fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok && Array.isArray(data?.models) && data.models.length > 0) {
          setLiveModels(data.models);
          if (providerId === "zed" && data?.warning) setLiveModelsError(data.warning);
          return;
        }
        if (providerId === "zed") {
          setLiveModels([]);
          setLiveModelsError(data?.warning || data?.error || "Zed returned no live models.");
        }
      })
      .catch(() => {
        if (!cancelled && providerId === "zed") {
          setLiveModels([]);
          setLiveModelsError("Failed to reach the Zed model catalog.");
        }
      });

    return () => { cancelled = true; };
  }, [providerId, connections]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  // `transport` pins a realtime STT dispatch marker (shared whitelist
  // STT_TRANSPORT_META); the API only honours it on type "stt" records.
  const handleAddCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias, caps, transport) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerAliasOverride, id: modelId, type, ...(caps ? { caps } : {}), ...(transport ? { transport } : {}) }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add custom model");
      }
    } catch (error) {
      console.log("Error adding custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.log("Error deleting custom model:", error);
    }
  };

  // Fetch Qoder model list and automatically add to available models
  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      alert(translate("Please add an active Qoder connection first"));
      return;
    }

    setImportingQoderModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || translate("Failed to fetch models"));
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert(translate("No models returned"));
        return;
      }

      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name;
        if (!modelId) continue;
        
        // Qoder model ID format may be "qoder/auto", "qoder-cn/auto" or "auto",
        // need to remove the provider prefix before storing.
        const cleanModelId = modelId.replace(/^(qoder-cn|qoder)\//, "");
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === cleanModelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${cleanModelId}`);
        if (alreadyExists) {
          continue;
        }

        await handleAddCustomModel(cleanModelId, "llm", providerStorageAlias);
        importedCount += 1;
      }
      
      if (importedCount === 0) {
        alert(translate("All models already exist, no new models added"));
      } else {
        alert(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
      }
    } catch (error) {
      console.log("Error importing Qoder models:", error);
      alert(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingQoderModels(false);
    }
  };
  // Fetch the live Cline /models catalog and add every model not yet present.
  // Cline and ClinePass share the same catalog endpoint (api.cline.bot/api/v1/models).
  const handleImportClineModels = async () => {
    if (importingClineModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      alert(translate("Please add an active Cline connection first"));
      return;
    }
    setImportingClineModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || translate("Failed to fetch models"));
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert(translate("No models returned"));
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name;
        if (!modelId) continue;
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === modelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${modelId}`);
        if (alreadyExists) {
          continue;
        }
        await handleAddCustomModel(modelId, "llm", providerStorageAlias);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert(translate("All models already exist, no new models added"));
      } else {
        alert(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
      }
    } catch (error) {
      console.log("Error importing Cline models:", error);
      alert(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingClineModels(false);
    }
  };

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
            },
          }));
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error.message || "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            setConnections(prev => prev.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting connection:", error);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
      message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) {
            console.log("Error deleting connection:", error);
            failed += 1;
          }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) alert(`Deleted ${idsToDelete.length - failed} connection(s), ${failed} failed.`);
      }
    });
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.log("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (id, swapWithId) => {
    if (reorderBusy.current || !swapWithId) return;
    reorderBusy.current = true;
    setReordering(true);
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swapWithId }),
      });
      if (!response.ok) throw new Error("Failed to reorder connections");
    } catch (error) {
      console.log("Error swapping priority:", error);
    } finally {
      await fetchConnections();
      reorderBusy.current = false;
      setReordering(false);
    }
  };

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    ));
  };

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  useEffect(() => {
    setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? uniquePoolIds[0] : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          if (!res.ok) failed += 1;
        } catch (e) {
          console.log("Error applying proxy for", connectionId, e);
          failed += 1;
        }
      }
      if (failed > 0) alert(`Updated with ${failed} failed request(s).`);
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      alert("No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };


  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);

  const [extractingKeys, setExtractingKeys] = useState(false);
  const handleExtractKeys = async () => {
    if (extractingKeys) return;
    setExtractingKeys(true);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/connections/keys`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to export connection keys");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keys-${providerId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      useNotificationStore.getState().error(error.message);
    } finally {
      setExtractingKeys(false);
    }
  };

  // Display the same demotion overlay as routing; arrows still edit manual order.
  const displayedConnections = providerDemoteOnError === false ? connections : applyDemotionOverlay(connections);
  const manualIndexById = new Map(connections.map((conn, index) => [conn.id, index]));
  const connectionsList = (
    <div
      title="Routing order includes auto-demotion. Arrows edit manual priority (#), not demotion."
      className={styles.connList}
    >
      {displayedConnections.map((conn) => (
        <div key={conn.id} className={styles.connItem}>
          <input
            type="checkbox"
            checked={isSelected(conn.id)}
            onChange={() => toggleSelectConnection(conn.id)}
            className={styles.checkbox}
            aria-label={`Select ${conn.name || conn.email || conn.id}`}
          />
          <ConnectionRow
                connection={conn}
                proxyPools={proxyPools}
                isOAuth={isOAuth}
                isFirst={reordering || manualIndexById.get(conn.id) === 0}
                isLast={reordering || manualIndexById.get(conn.id) === connections.length - 1}
                onMoveUp={() => handleSwapPriority(conn.id, connections[manualIndexById.get(conn.id) - 1]?.id)}
                onMoveDown={() => handleSwapPriority(conn.id, connections[manualIndexById.get(conn.id) + 1]?.id)}
                onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" ? {
                  isActive: autoPing.connections[conn.id] === true || autoPing.schedules?.[conn.id]?.enabled === true,
                  reactiveOn: autoPing.connections[conn.id] === true,
                  provider: providerId,
                  scheduleOn: autoPing.schedules?.[conn.id]?.enabled === true,
                  scheduleSummary: getScheduleSlotLabels(autoPing.schedules?.[conn.id]).join(" / "),
                  onConfigure: () => setScheduleConnection(conn),
                } : null}
                onUpdateProxy={async (proxyPoolId) => {
                  try {
                    const res = await fetch(`/api/providers/${conn.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                    });
                    if (res.ok) {
                      setConnections(prev => prev.map(c =>
                        c.id === conn.id
                          ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } }
                          : c
                      ));
                    }
                  } catch (error) {
                    console.log("Error updating proxy:", error);
                  }
                }}
                onEdit={() => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                onDelete={() => handleDelete(conn.id)}
                oneByOneStatus={oneByOneResults[conn.id] || null}
          />
        </div>
      ))}
    </div>
  );

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const bulkActionModal = (
    <Modal
      isOpen={showBulkProxyModal}
      onClose={closeBulkProxyModal}
      title={`Apply Proxy (${connections.length} connections)`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={handleApplyOneToOne}
            disabled={bulkUpdatingProxy || activePools.length === 0}
            className={styles.proxyOption}
          >
            <Icon className={styles.proxyOptionIcon} size={18}>sync_alt</Icon>
            <span className={styles.proxyOptionLabel}>One-to-one (rotate)</span>
          </button>
          <button
            onClick={() => handleApplySinglePool(null)}
            disabled={bulkUpdatingProxy}
            className={styles.proxyOption}
          >
            <Icon className={styles.proxyOptionIcon} size={18}>link_off</Icon>
            <span className={styles.proxyOptionLabel}>None (unbind all)</span>
          </button>
          {proxyPools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => handleApplySinglePool(pool.id)}
              disabled={bulkUpdatingProxy || pool.isActive !== true}
              className={styles.proxyOption}
            >
              <Icon className={styles.proxyOptionIcon} size={18}>lan</Icon>
              <span className={styles.proxyOptionLabel}>{pool.name}</span>
              {pool.isActive !== true && (
                <span className={styles.proxyOptionNote}>(inactive)</span>
              )}
            </button>
          ))}
        </div>

        {bulkUpdatingProxy && <p className="text-xs text-text-muted">Applying...</p>}

        <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );

  const handleTestModel = async (modelId) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          customModels={customModels}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          onAddCustomModel={(modelId) => handleAddCustomModel(modelId, "llm", providerStorageAlias)}
          onDeleteCustomModel={(modelId) => handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    const customModelRows = getProviderCustomModelRows({
      customModels,
      modelAliases,
      providerAlias: providerStorageAlias,
      builtInModels: models,
      type: "llm",
    });

    return (
      <div className={styles.modelGrid}>
        {/* Custom models first */}
        {customModelRows.map((model) => (
          <ModelRow
            key={`${model.source}-${model.fullModel}`}
            model={{ id: model.id, name: model.name }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => {
              if (model.source === "custom") {
                handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
              } else {
                handleDeleteAlias(model.alias);
              }
            }}
            testStatus={modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
            isTesting={testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            caps={getCaps(`${providerId}/${model.id}`)}
            thinkingSuffix={resolveThinkingSuffix(model.id)}
          />
        ))}

        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isFree={model.isFree}
              onDisable={() => handleDisableModel(model.id)}
              caps={getCaps(`${providerId}/${model.id}`)}
              thinkingSuffix={resolveThinkingSuffix(model.id)}
            />
          );
        })}

        {/* Add model button — same footprint as the model chips */}
        <button type="button" onClick={() => setShowAddCustomModel(true)} className={styles.addModelChip}>
          <Icon size={16}>add</Icon>
          Add model
        </button>

        {/* Import Qoder models button — only show for qoder/qoder-cn provider */}
        {(providerId === "qoder" || providerId === "qoder-cn") && connections.some((conn) => conn.isActive !== false) && (
          <button
            type="button"
            onClick={handleImportQoderModels}
            disabled={importingQoderModels}
            className={styles.addModelChip}
          >
            <Icon size={16} style={importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingQoderModels ? "progress_activity" : "download"}
            </Icon>
            {importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
          </button>
        )}

        {/* Import Cline /models catalog button — only show for cline and clinepass providers */}
        {(providerId === "cline" || providerId === "clinepass") && connections.some((conn) => conn.isActive !== false) && (
          <button
            type="button"
            onClick={handleImportClineModels}
            disabled={importingClineModels}
            className={styles.addModelChip}
          >
            <Icon size={16} style={importingClineModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingClineModels ? "progress_activity" : "download"}
            </Icon>
            {importingClineModels ? translate("Fetching...") : translate("Import from /models")}
          </button>
        )}

        {/* Suggested models from provider API — show only models not yet added */}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set([
            ...Object.values(modelAliases),
            ...customModelRows.map((model) => model.fullModel),
          ]);
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
          );
          if (notAdded.length === 0) return null;
          return (
            <div className={styles.modelGroup}>
              <p className={styles.modelGroupLabel}>Suggested free models (≥200k context)</p>
              <div className={styles.modelGrid}>
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={async () => {
                      await handleAddCustomModel(m.id, "llm", providerStorageAlias);
                    }}
                    className={styles.modelPill}
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <Icon size={13}>add</Icon>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
          <div className={styles.modelGroup}>
            <p className={styles.modelGroupLabel}>Disabled models ({disabledDisplayModels.length})</p>
            <div className={styles.modelGrid}>
              {disabledDisplayModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleEnableModel(m.id)}
                  className={styles.modelPill}
                  title="Restore model"
                >
                  <Icon size={13}>add</Icon>
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };


  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
}

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className={`${styles.detailLink} mt-4`}>
          <Icon size={14}>arrow_back</Icon>
          Back to providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : getProviderIconSrc("openai");
    }
    if (isAnthropicCompatible) {
      return getProviderIconSrc("anthropic");
    }
    return getProviderIconSrc(providerInfo.id);
  };

  const activeConnectionCount = connections.filter((c) => c.isActive !== false).length;
  const disabledConnectionCount = connections.length - activeConnectionCount;
  const llmModelIds = new Set([...models, ...kiloFreeModels].map((m) => m.id));
  const disabledLlmCount = disabledModelIds.filter((id) => llmModelIds.has(id)).length;
  const llmModelCount = [...models, ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id))]
    .filter((m) => { const k = getModelKind(m); return !k || k === "llm"; }).length;
  // Custom rows count toward both provider kinds; compatible nodes carry no
  // built-in catalog, so their total is exactly the custom list.
  const customModelCount = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    builtInModels: models,
    type: "llm",
  }).length;
  const totalModelCount = isCompatible ? customModelCount : llmModelCount + customModelCount;
  const enabledModelCount = isCompatible
    ? customModelCount
    : Math.max(totalModelCount - disabledLlmCount, 0);
  const demoteOn = providerDemoteOnError !== false;
  const routingValue = providerStrategy === "round-robin" ? "Round robin" : "Fill first";
  const routingNote = providerStrategy === "round-robin"
    ? `Pool of ${providerStickyLimit || 1} · ${demoteOn ? "auto-demote on" : "auto-demote off"}`
    : `Auto-demote ${demoteOn ? "on" : "off"}`;
  const introSub = [
    `${connections.length} connection${connections.length === 1 ? "" : "s"}`,
    isCompatible
      ? `${customModelCount} custom model${customModelCount === 1 ? "" : "s"}`
      : `${totalModelCount} model${totalModelCount === 1 ? "" : "s"}`,
    providerStrategy === "round-robin" ? `Round robin · pool ${providerStickyLimit || 1}` : "Fill first",
  ].join(" · ");

  const addConnectionButtons = hasDualAuthModes ? (
    <>
      <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection} className={styles.ctaSm}>
        {oauthConnectionLabel}
      </Button>
      <Button size="sm" icon="key" variant="contrast" onClick={triggerApiKeyConnection} className={styles.ctaSm}>
        {apiKeyConnectionLabel}
      </Button>
    </>
  ) : (
    <>
      {!isCompatible && providerId === "iflow" && (
        <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)} className={styles.ctaSm}>
          Cookie
        </Button>
      )}
      {providerId === "codex" && (
        <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)} className={styles.ctaSm}>
          {translate("Bulk add")}
        </Button>
      )}
      {providerId === "grok-cli" && (
        <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportGrokCli(true)} className={styles.ctaSm}>
          {translate("Bulk add")}
        </Button>
      )}
      <Button size="sm" icon="add" variant="contrast" onClick={triggerAddConnection} className={styles.cta}>
        {isCompatible ? "Add API key" : providerId === "iflow" ? "OAuth" : "Add connection"}
      </Button>
    </>
  );

  return (
    <div className={`dashboard-surface ${styles.page} ${styles.detailPage}`}>
      {/* Intro ------------------------------------------------------------ */}
      <header className={styles.detailHead}>
        <Link href="/dashboard/providers" className={styles.detailLink}>
          <Icon size={14}>arrow_back</Icon>
          Back to providers
        </Link>
        <div className={styles.detailIntro}>
          <div className={styles.detailIdentity}>
            <span
              className={styles.detailLogo}
              style={{ backgroundColor: `color-mix(in srgb, ${providerInfo.color} 16%, var(--surface-2))` }}
            >
              {headerImgError || !getHeaderIconPath() ? (
                <span className={styles.detailLogoFallback} style={{ color: providerInfo.color }}>
                  {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <Image
                  src={getHeaderIconPath()}
                  alt=""
                  width={40}
                  height={40}
                  className="max-h-10 max-w-10 rounded-[12px] object-contain"
                  sizes="40px"
                  onError={() => {
                    markProviderIconMissing(providerInfo.id);
                    setHeaderImgError(true);
                  }}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </span>
            <div className={styles.detailCopy}>
              <div className={styles.detailTitleRow}>
                <h1 className={styles.detailTitle}>{providerInfo.name}</h1>
                {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) && (
                  <a
                    href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.detailMetaLink}
                  >
                    <Icon size={13}>open_in_new</Icon>
                    {providerInfo.notice?.apiKeyUrl ? "Get API key" : "Sign up / Learn more"}
                  </a>
                )}
              </div>
              <p className={styles.detailSub}>{introSub}</p>
            </div>
          </div>
        </div>
      </header>

      {providerInfo.deprecated && (
        <div className={`${styles.notice} ${styles.noticeWarn}`} role="status">
          <Icon className={styles.noticeIcon} size={16}>warning</Icon>
          <p className={styles.noticeCopy}>{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <div className={`${styles.notice} ${styles.noticeInfo}`}>
          <Icon className={styles.noticeIcon} size={16}>info</Icon>
          <p className={styles.noticeCopy}>{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.noticeLink}
            >
              Get API key
              <Icon size={13}>open_in_new</Icon>
            </a>
          )}
        </div>
      )}

      <ProviderDetailStats
        activeConnections={activeConnectionCount}
        totalConnections={connections.length}
        connectionsNote={
          connections.length === 0
            ? "No connections yet"
            : disabledConnectionCount > 0
              ? `${disabledConnectionCount} disabled`
              : "All connections enabled"
        }
        modelsValue={enabledModelCount}
        modelsUnit={isCompatible ? "custom" : `of ${totalModelCount}`}
        modelsNote={
          isCompatible
            ? (customModelCount > 0 ? "Added to this endpoint" : "No custom models yet")
            : disabledLlmCount > 0
              ? `${disabledLlmCount} disabled`
              : "All models enabled"
        }
        routingValue={routingValue}
        routingNote={routingNote}
      />

      {/* Compatible endpoint details -------------------------------------- */}
      {isCompatible && providerNode && (
        <section className={styles.panel} aria-labelledby="compatible-panel-title">
          <div className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <h2 className={styles.panelTitle} id="compatible-panel-title">
                <Icon className={styles.panelIcon} size={18}>api</Icon>
                {isAnthropicCompatible ? "Anthropic-compatible endpoint" : "OpenAI-compatible endpoint"}
              </h2>
              <p className={styles.panelDesc}>
                Requests are forwarded to this base URL using the selected protocol.
              </p>
            </div>
            <div className={styles.panelActions}>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
                className={styles.ctaSm}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="delete"
                onClick={async () => {
                  setConfirmState({
                    title: "Delete Compatible Node",
                    message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                    onConfirm: async () => {
                      setConfirmState(null);
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                        if (res.ok) {
                          router.push("/dashboard/providers");
                        }
                      } catch (error) {
                        console.log("Error deleting provider node:", error);
                      }
                    }
                  });
                }}
                className={styles.ctaSm}
              >
                Delete
              </Button>
            </div>
          </div>
          <div className={styles.kvList}>
            <div className={styles.kvRow}>
              <span className={styles.kvKey}>Base URL</span>
              <span className={styles.kvValue}>{(providerNode.baseUrl || "").replace(/\/$/, "")}</span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.kvKey}>Protocol</span>
              <span className={styles.kvValue}>
                {isAnthropicCompatible
                  ? "Messages API · /messages"
                  : providerNode.apiType === "responses"
                    ? "Responses API · /responses"
                    : "Chat Completions · /chat/completions"}
              </span>
            </div>
            {providerNode.prefix && (
              <div className={styles.kvRow}>
                <span className={styles.kvKey}>Prefix</span>
                <span className={styles.kvValue}>{providerNode.prefix}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Connections ------------------------------------------------------ */}
      {isFreeNoAuth ? (
        <NoAuthProxyCard providerId={providerId} />
      ) : (
        <section className={styles.panel} aria-labelledby="connections-panel-title">
          <div className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <h2 className={styles.panelTitle} id="connections-panel-title">
                <Icon className={styles.panelIcon} size={18}>vpn_key</Icon>
                Connections
              </h2>
              <p className={styles.panelDesc}>
                Accounts and keys this provider rotates between.
              </p>
            </div>
            <div className={styles.panelActions}>
              {connections.some((c) => (c.authType || "apikey") === "apikey") && (
                <button
                  type="button"
                  onClick={handleExtractKeys}
                  disabled={extractingKeys}
                  title={extractingKeys ? "Extracting keys…" : "Export connection keys"}
                  aria-label={extractingKeys ? "Extracting keys" : "Export connection keys"}
                  className={styles.iconButton}
                >
                  <Icon size={16}>{extractingKeys ? "hourglass_top" : "download"}</Icon>
                </button>
              )}
              {connections.length > 0 && (
                <button
                  type="button"
                  onClick={handleRunOneByOneTest}
                  disabled={oneByOneRunning}
                  title={oneByOneRunning ? "Testing connections one-by-one…" : "Test connections one-by-one"}
                  aria-label={oneByOneRunning ? "Testing connections one by one" : "Test connections one by one"}
                  className={styles.iconButton}
                >
                  <Icon size={16}>{oneByOneRunning ? "hourglass_top" : "sync"}</Icon>
                </button>
              )}
              {oneByOneRunning && (
                <button
                  type="button"
                  onClick={handleStopOneByOneTest}
                  disabled={oneByOneStopping}
                  title={oneByOneStopping ? "Stopping…" : "Stop testing"}
                  aria-label={oneByOneStopping ? "Stopping" : "Stop testing"}
                  className={styles.iconButton}
                >
                  <Icon size={16}>stop</Icon>
                </button>
              )}
              {connections.length > 0 && proxyPools.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="lan"
                  onClick={() => setShowBulkProxyModal(true)}
                  className={styles.ctaSm}
                >
                  Apply proxy
                </Button>
              )}
              {selectedConnectionIds.length > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  icon="delete"
                  onClick={handleBulkDelete}
                  className={styles.ctaSm}
                >
                  Delete selected ({selectedConnectionIds.length})
                </Button>
              )}
              {addConnectionButtons}
            </div>
          </div>

          {connections.length > 0 && (
            <div className={styles.settingsStrip}>
              <div className={styles.setting}>
                <div className={styles.settingCopy}>
                  <p className={styles.settingLabel}>Round robin</p>
                  <p className={styles.settingHint}>Rotate requests across every connection in this pool.</p>
                </div>
                <div className={styles.settingControl}>
                  <Toggle
                    checked={providerStrategy === "round-robin"}
                    onChange={handleRoundRobinToggle}
                    aria-label="Round robin"
                  />
                  {providerStrategy === "round-robin" && (
                    <label className={styles.poolField}>
                      Pool
                      <input
                        type="number"
                        min={1}
                        value={providerStickyLimit}
                        onChange={(e) => handleStickyLimitChange(e.target.value)}
                        placeholder="1"
                        className={styles.poolInput}
                        aria-label="Round robin pool size"
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className={styles.setting}>
                <div className={styles.settingCopy}>
                  <p className={styles.settingLabel}>Auto-demote on error</p>
                  <p className={styles.settingHint}>Failed keys move to the back until their next success.</p>
                </div>
                <Toggle
                  checked={demoteOn}
                  onChange={handleDemoteOnErrorToggle}
                  aria-label="Auto-demote on error"
                />
              </div>
            </div>
          )}

          {connections.length === 0 ? (
            <div className={styles.connEmpty}>
              <span className={styles.connEmptyIcon} aria-hidden="true">
                <Icon size={18}>{isOAuth ? "lock" : "key"}</Icon>
              </span>
              <div>
                <p className={styles.connEmptyTitle}>No connections yet</p>
                <p className={styles.connEmptyHint}>
                  {hasDualAuthModes
                    ? `Choose ${oauthConnectionLabel} or ${apiKeyConnectionLabel}.`
                    : "Add a connection to start routing through this provider."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {oneByOneSummary && (
                <div className={styles.summaryBox} role="status">
                  <span>Total <b>{oneByOneSummary.total}</b></span>
                  <span>Completed <b>{oneByOneSummary.completed}</b></span>
                  <span>Passed <b>{oneByOneSummary.passed}</b></span>
                  <span>Failed <b>{oneByOneSummary.failed}</b></span>
                  {oneByOneSummary.stopped && <span className={styles.summaryWarn}>Stopped</span>}
                  {oneByOneRunning && oneByOneCurrentConnectionId && (
                    <span>
                      Running{" "}
                      <b>
                        {connections.find((conn) => conn.id === oneByOneCurrentConnectionId)?.name
                          || oneByOneCurrentConnectionId}
                      </b>
                    </span>
                  )}
                </div>
              )}
              <div className={styles.selectBar}>
                <label className={styles.selectLabel}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAllConnections}
                    className={styles.checkbox}
                  />
                  Select all
                </label>
                <span className={styles.selectCount}>
                  {displayedConnections.length} in routing order
                </span>
              </div>
              {connectionsList}
            </>
          )}
        </section>
      )}

      {/* Per-provider user overrides (custom headers / connect timeout) */}
      <CustomConfigCard providerId={providerId} />

      {/* Models ----------------------------------------------------------- */}
      <section className={styles.panel} aria-labelledby="models-panel-title">
        <div className={styles.panelHead}>
          <div className={styles.panelHeadCopy}>
            <h2 className={styles.panelTitle} id="models-panel-title">
              <Icon className={styles.panelIcon} size={18}>smart_toy</Icon>
              Models
            </h2>
            <p className={styles.panelDesc}>
              {isCompatible
                ? "Model IDs exposed through this endpoint."
                : "Model IDs routed through this provider."}
            </p>
          </div>
          <div className={styles.panelActions}>
            {providerThinkingLevels && (
              <select
                value={thinkingMode}
                onChange={(e) => handleThinkingModeChange(e.target.value)}
                title="Appends (level) suffix to copied model names"
                className={styles.selectField}
              >
                {providerThinkingLevels.map((opt) => (
                  <option key={opt} value={opt}>{`Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}`}</option>
                ))}
              </select>
            )}
            {!isCompatible && (() => {
              const allIds = [
                ...models,
                ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
              ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; }).map((m) => m.id);
              const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
              return (
                <>
                  {disabledModelIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="restart_alt"
                      onClick={handleEnableAll}
                      className={styles.ctaSm}
                    >
                      Active all
                    </Button>
                  )}
                  {activeIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="block"
                      onClick={() => handleDisableAll(activeIds)}
                      className={styles.ctaSm}
                    >
                      Disable all
                    </Button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        {!!modelsTestError && (
          <div className="mb-3">
            <p className={styles.inlineError}>{modelsTestError}</p>
            {/RegionError|hosted in China|regionNotAllowed/i.test(modelsTestError) && (() => {
              const str = typeof modelsTestError === "string" ? modelsTestError : JSON.stringify(modelsTestError);
              const linkMatch = str.match(/https:\/\/opencode\.ai\/workspace\/[^\s"')]+/);
              const wrkMatch = str.match(/wrk_[0-9A-Za-z]+/);
              const targetUrl = linkMatch
                ? (linkMatch[0].endsWith("/go") ? linkMatch[0] : `${linkMatch[0]}/go`)
                : wrkMatch
                  ? `https://opencode.ai/workspace/${wrkMatch[0]}/go`
                  : "https://opencode.ai";

              return (
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.inlineWarnLink}
                >
                  Allow China-hosted models
                  <Icon size={13}>open_in_new</Icon>
                </a>
              );
            })()}
          </div>
        )}
        {providerId === "zed" && !!liveModelsError && (
          <p className={`mb-3 ${styles.inlineError}`}>{liveModelsError}</p>
        )}
        {renderModelsSection()}
      </section>

      {bulkActionModal}

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "zed" ? (
        <ZedAuthModal
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      )}

      {/* Xiaomi Desktop: auto-import local credentials modal */}
      <XiaomiMimoAuthModal
        isOpen={showXiaomiMimoModal}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowXiaomiMimoModal(false)}
      />
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={showIFlowCookieModal}
          onSuccess={handleIFlowCookieSuccess}
          onClose={() => setShowIFlowCookieModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        error={addConnectionError}
        existingNames={connections.map((c) => c.name).filter(Boolean)}
        onSave={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onClose={() => {
          setAddConnectionError("");
          setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId, caps, transport) => {
            // caps.stt is a UI-only flag; the API accepts transports only on
            // type "stt" records, so the save derives the type from it.
            await handleAddCustomModel(modelId, caps?.stt ? "stt" : "llm", providerStorageAlias, caps, transport);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}

      {providerId === "codex" && (
        <BulkImportCodexModal
          isOpen={showBulkImportCodex}
          onClose={() => setShowBulkImportCodex(false)}
          onSuccess={fetchConnections}
        />
      )}

      {providerId === "grok-cli" && (
        <BulkImportGrokCliModal
          isOpen={showBulkImportGrokCli}
          onClose={() => setShowBulkImportGrokCli(false)}
          onSuccess={fetchConnections}
        />
      )}

      {scheduleConnection && (
        <AutoPingScheduleModal
          isOpen={!!scheduleConnection}
          onClose={() => setScheduleConnection(null)}
          connection={scheduleConnection}
          reactive={autoPing.connections[scheduleConnection.id] === true}
          schedule={autoPing.schedules?.[scheduleConnection.id] || null}
          onSave={(result) => handleSaveAutoPing(scheduleConnection.id, result)}
        />
      )}

      {/* AG Risk Confirmation Modal */}
      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={() => setShowAgRiskModal(false)}
        onConfirm={handleAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
