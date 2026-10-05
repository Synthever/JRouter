"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import {
  Card,
  Skeleton,
  Button,
  Modal,
  Toggle,
} from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";
import { STATUS_FILTER_OPTIONS, matchesStatusFilter } from "./utils";
import styles from "./providers.module.css";

function getStatusDisplay(connected, error, errorCode) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <StatusBadge key="connected" variant="success">
        {connected} Connected
      </StatusBadge>,
    );
  }
  if (error > 0) {
    const errText = errorCode
      ? `${error} Error (${errorCode})`
      : `${error} Error`;
    parts.push(
      <StatusBadge key="error" variant="error" className={styles.errorBadge}>
        {errText}
      </StatusBadge>,
    );
  }
  if (parts.length === 0) {
    return <StatusBadge>No connections</StatusBadge>;
  }
  return parts;
}

function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime") ||
    msg.includes("not runnable") ||
    msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

const APIKEY_INITIAL_VISIBLE = 20;

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const matchSearch = (name) => {
    if (!searchQuery.trim()) return true;
    if (!name) return false;
    return name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  const sortByPriority = (entries, authType) =>
    [...entries].sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(ka, authType);
      const sb = getProviderStats(kb, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  const sortItemsByPriority = (items, authType) =>
    [...items].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(a.id, authType);
      const sb = getProviderStats(b.id, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok)
          setConnections(connectionsData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getProviderStats = (providerId, authType) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && authTypes.includes(c.authType),
    );

    const getEffectiveStatus = (conn) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) =>
          k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
      );
      return conn.testStatus === "unavailable" && !isCooldown
        ? "active"
        : conn.testStatus;
    };

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConns = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return (
        status === "error" || status === "expired" || status === "unavailable"
      );
    });

    const error = errorConns.length;
    const total = providerConnections.length;
    const allDisabled =
      total > 0 && providerConnections.every((c) => c.isActive === false);

    const latestError = errorConns.sort(
      (a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0),
    )[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt
      ? getRelativeTime(latestError.lastErrorAt)
      : null;

    return { connected, error, total, errorCode, errorTime, allDisabled };
  };

  const matchStatus = (stats, isNoAuth) =>
    matchesStatusFilter(statusFilter, stats, isNoAuth);

  // Toggle all connections for a provider on/off. authType may be a single
  // string or an array (kiro counts oauth + api_key/apikey together).
  const handleToggleProvider = async (providerId, authType, newActive) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) =>
      c.provider === providerId && authTypes.includes(c.authType);
    const providerConns = connections.filter(matches);
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  const handleBatchTest = async (mode, providerId = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch (error) {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
      baseUrl: node.baseUrl,
    }))
    .filter(
      (p) => matchSearch(p.name) && matchStatus(getProviderStats(p.id, "apikey")),
    );

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
      baseUrl: node.baseUrl,
    }))
    .filter(
      (p) => matchSearch(p.name) && matchStatus(getProviderStats(p.id, "apikey")),
    );

  // Dual-auth providers (oauth + apikey) store API keys as authType "apikey"
  // (and sometimes "api_key"). Card stats must count both so totals match detail.
  // kiro has no authModes in registry but accepts both (headless uses "api_key").
  const dualAuthTypes = (info, key) => {
    if (key === "kiro") return ["oauth", "apikey", "api_key"];
    const modes = info?.authModes;
    // Free-tier and API-key providers default to supporting apikey even when the
    // registry entry omits authModes (e.g. cloudflare-ai, byteplus, ollama,
    // vertex) — otherwise their apikey connections are invisible on the grid card.
    if (!Array.isArray(modes)) {
      return key in FREE_TIER_PROVIDERS || key in APIKEY_PROVIDERS
        ? ["oauth", "apikey", "api_key"]
        : "oauth";
    }
    if (!modes.includes("apikey")) return "oauth";
    return ["oauth", "apikey", "api_key"];
  };

  const oauthEntries = sortByPriority(
    Object.entries(OAUTH_PROVIDERS).filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    ),
    "oauth",
  );
  const freeEntries = Object.entries(FREE_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    )
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  // Free Tier cards may be oauth-only (e.g. kimchi) or dual-auth, so count via
  // dualAuthTypes per provider instead of a fixed "apikey" — otherwise oauth
  // connections are invisible here (mismatch with the detail page).
  const freeTierEntries = Object.entries(FREE_TIER_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = getProviderStats(ka, dualAuthTypes(a, ka)).connected > 0 ? 0 : 1;
      const cb = getProviderStats(kb, dualAuthTypes(b, kb)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  // API Key: connected providers first, then alphabetical by name
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, "apikey"), info.noAuth),
    )
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const isApikeySearching = !!searchQuery.trim() || statusFilter !== "all";
  const visibleApikeyEntries =
    isApikeySearching || showAllApikey
      ? apikeyEntries
      : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  if (loading) {
    return (
      <div className={`dashboard-surface ${styles.page}`} aria-busy="true" aria-label="Loading providers">
        {[0, 1].map((section) => (
          <Card key={section} className={`ui-card ${styles.panel}`}>
            <Skeleton className="mb-5 h-4 w-40" />
            <div className={styles.list}>
              {[0, 1, 2].map((card) => (
                <Skeleton key={card} className="h-16" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const hasAnyResult =
    oauthEntries.length > 0 ||
    freeEntries.length > 0 ||
    freeTierEntries.length > 0 ||
    apikeyEntries.length > 0 ||
    compatibleProviders.length > 0 ||
    anthropicCompatibleProviders.length > 0;

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <div className={styles.toolbar}>
        <p className={styles.description}>
          Connect upstream accounts and manage access to your models.
        </p>
        <div className={styles.filter}>
          <label htmlFor="provider-status-filter">Connection status</label>
          <select
            id="provider-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.select}
            aria-label="Filter providers by connection status"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!hasAnyResult && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No matching providers</p>
          <p>Try another search or change the connection status filter.</p>
        </div>
      )}

      <section className={`ui-card ${styles.panel}`} aria-labelledby="custom-providers-heading">
        <div className={styles.header}>
          <div>
            <h2 id="custom-providers-heading" className="ui-eyebrow"><Icon className="text-[16px]">api</Icon>Custom endpoints</h2>
            <p className={styles.description}>Connect APIs that use the OpenAI or Anthropic format.</p>
          </div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              aria-label="Add Anthropic compatible provider"
            >
              Add Anthropic
            </Button>
            <Button
              variant="contrast"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              aria-label="Add OpenAI compatible provider"
            >
              Add OpenAI
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No custom endpoints to show</p>
            <p>Add a compatible API, or adjust your search and filters.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
              (info) => (
                <ApiKeyProviderRow
                  key={info.id}
                  providerId={info.id}
                  provider={info}
                  stats={getProviderStats(info.id, "apikey")}
                  authType="compatible"
                  onToggle={(active) =>
                    handleToggleProvider(info.id, "apikey", active)
                  }
                />
              ),
            )}
          </ul>
        )}
      </section>

      {oauthEntries.length > 0 && (
      <section className={`ui-card ${styles.panel}`} aria-labelledby="oauth-providers-heading">
        <div className={styles.header}>
          <div>
            <h2 id="oauth-providers-heading" className="ui-eyebrow"><Icon className="text-[16px]">lock</Icon>OAuth connections</h2>
            <p className={styles.description}>Sign in with your provider account to connect.</p>
          </div>
          <div className={styles.actions}>
            <ModelAvailabilityBadge />
            <Button
              variant="secondary"
              onClick={() => handleBatchTest("oauth")}
              disabled={!!testingMode}
              aria-busy={testingMode === "oauth"}
              title="Test all OAuth connections"
              aria-label="Test all OAuth connections"
            >
              <Icon className={`text-[14px]${testingMode === "oauth" ? " animate-spin" : ""}`}>
                play_arrow
              </Icon>
              {testingMode === "oauth" ? "Testing..." : "Test connections"}
            </Button>
          </div>
        </div>
        <ul className={styles.list}>
          {oauthEntries.map(([key, info]) => {
            const authTypes = dualAuthTypes(info, key);
            return (
              <ProviderRow
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, authTypes)}
                authType="oauth"
                onToggle={(active) => handleToggleProvider(key, authTypes, active)}
              />
            );
          })}
        </ul>
      </section>
      )}

      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
      <section className={`ui-card ${styles.panel}`} aria-labelledby="free-providers-heading">
        <div className={styles.header}>
          <div>
            <h2 id="free-providers-heading" className="ui-eyebrow"><Icon className="text-[16px]">bolt</Icon>Free-tier providers</h2>
            <p className={styles.description}>Providers with free access or a free usage tier.</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => handleBatchTest("free")}
            disabled={!!testingMode}
            aria-busy={testingMode === "free"}
            title="Test all Free connections"
            aria-label="Test all Free provider connections"
          >
            <Icon className={`text-[14px]${testingMode === "free" ? " animate-spin" : ""}`}>
              play_arrow
            </Icon>
            {testingMode === "free" ? "Testing..." : "Test connections"}
          </Button>
        </div>
        <ul className={styles.list}>
          {freeEntries.map(([key, info]) => {
            // Dual-auth (e.g. kiro): count/toggle oauth + apikey/api_key so the
            // card total matches the provider detail page.
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ProviderRow
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType="free"
                onToggle={(active) =>
                  handleToggleProvider(key, freeAuthTypes, active)
                }
              />
            );
          })}
          {freeTierEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ApiKeyProviderRow
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType={Array.isArray(freeAuthTypes) ? (freeAuthTypes[0] ?? "apikey") : freeAuthTypes}
                onToggle={(active) => handleToggleProvider(key, freeAuthTypes, active)}
              />
            );
          })}
        </ul>
      </section>
      )}

      {apikeyEntries.length > 0 && (
      <section className={`ui-card ${styles.panel}`} aria-labelledby="apikey-providers-heading">
        <div className={styles.header}>
          <div>
            <h2 id="apikey-providers-heading" className="ui-eyebrow"><Icon className="text-[16px]">vpn_key</Icon>API key connections</h2>
            <p className={styles.description}>Connect providers using an API key from their dashboard.</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => handleBatchTest("apikey")}
            disabled={!!testingMode}
            aria-busy={testingMode === "apikey"}
            title="Test all API Key connections"
            aria-label="Test all API Key connections"
          >
            <Icon className={`text-[14px]${testingMode === "apikey" ? " animate-spin" : ""}`}>
              play_arrow
            </Icon>
            {testingMode === "apikey" ? "Testing..." : "Test connections"}
          </Button>
        </div>
        <ul className={styles.list}>
          {visibleApikeyEntries.map(([key, info]) => (
            <ApiKeyProviderRow
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </ul>
        {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 && (
          <Button
            variant="ghost"
            onClick={() => setShowAllApikey(true)}
            className={styles.showMore}
          >
            <Icon className="text-[16px]">expand_more</Icon>
            Show {hiddenApikeyCount} more providers
          </Button>
        )}
      </section>
      )}

      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />

      {/* Test Results Modal */}
      <Modal
        isOpen={!!testResults}
        title="Connection test results"
        size="xl"
        className={styles.dialog}
        onClose={() => setTestResults(null)}
      >
        {testResults && <ProviderTestResultsView results={testResults} />}
      </Modal>
    </div>
  );
}

function ProviderRow({ providerId, provider, stats, authType, onToggle }) {
  return (
    <ProviderListRow
      providerId={providerId}
      provider={provider}
      stats={stats}
      authType={authType}
      iconSrc={`/providers/${provider.id}.png`}
      readyWithoutAuth={!!provider.noAuth}
      onToggle={onToggle}
    />
  );
}

ProviderRow.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ApiKeyProviderRow({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (isCompatible && provider.apiType)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return getProviderIconSrc(provider.id);
  };

  return (
    <ProviderListRow
      providerId={providerId}
      provider={provider}
      stats={stats}
      authType={authType}
      iconSrc={getIconPath()}
      protocol={isCompatible
        ? provider.apiType === "responses" ? "Responses" : "Chat"
        : isAnthropicCompatible ? "Messages" : undefined}
      onToggle={onToggle}
    />
  );
}

ApiKeyProviderRow.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ProviderListRow({ providerId, provider, stats, authType, iconSrc, protocol, readyWithoutAuth, onToggle }) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const authLabels = { free: "Free", oauth: "OAuth", apikey: "API Key", compatible: "Compatible" };
  const href = `/dashboard/providers/${providerId}`;

  return (
    <li className={styles.providerRow}>
      <Link href={href} className={styles.providerLink}>
        <div className={styles.providerIcon}>
          <ProviderIcon
            src={iconSrc}
            alt=""
            size={28}
            className="object-contain max-w-7 max-h-7"
            fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
            fallbackColor={provider.color}
          />
        </div>
        <div className={styles.identity}>
          <h3 className={styles.providerName} title={provider.name} data-i18n-skip>{provider.name}</h3>
          <p className={styles.metadata}>
            <span>{protocol || authLabels[authType]}</span>
            <span className={styles.providerAddress} title={provider.baseUrl || providerId}>
              {provider.baseUrl || providerId}
            </span>
          </p>
        </div>
        <div className={styles.status}>
          {allDisabled ? <StatusBadge>Disabled</StatusBadge>
            : readyWithoutAuth ? <StatusBadge variant="success">Ready</StatusBadge>
            : getStatusDisplay(connected, error, errorCode)}
          {!allDisabled && !readyWithoutAuth && errorTime && <span>{errorTime}</span>}
        </div>
      </Link>
      <div className={styles.rowActions}>
        {stats.total > 0 && (
          <Toggle
            size="sm"
            checked={!allDisabled}
            onChange={onToggle}
            aria-label={`${allDisabled ? "Enable" : "Disable"} ${provider.name}`}
            title={allDisabled ? "Enable provider" : "Disable provider"}
          />
        )}
        <Link href={href} className={styles.iconButton} aria-label={`Configure ${provider.name}`} title={`Configure ${provider.name}`}>
          <Icon className="text-[16px]">settings</Icon>
        </Link>
      </div>
    </li>
  );
}

ProviderListRow.propTypes = {
  ...ApiKeyProviderRow.propTypes,
  iconSrc: PropTypes.string,
  protocol: PropTypes.string,
  readyWithoutAuth: PropTypes.bool,
};

function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-6">
        <Icon className="text-[var(--danger)] text-[32px] mb-2 block">
          error
        </Icon>
        <p className="text-sm text-[var(--danger)]">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    {
      oauth: "OAuth",
      free: "Free",
      apikey: "API Key",
      provider: "Provider",
      all: "All",
    }[mode] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs mb-1 sm:gap-3">
          <span className="text-text-muted">{modeLabel} Test</span>
          <StatusBadge variant="success">
            {summary.passed} passed
          </StatusBadge>
          {summary.failed > 0 && (
            <StatusBadge variant="error" className={styles.errorBadge}>
              {summary.failed} failed
            </StatusBadge>
          )}
          <span className="text-text-muted sm:ml-auto">
            {summary.total} tested
          </span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className={styles.testRow}
        >
          <Icon className={`text-[16px] ${r.valid ? styles.success : styles.error}`}>
            {r.valid ? "check_circle" : "error"}
          </Icon>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">
              {r.connectionName}
            </span>
            <span className="block truncate text-text-muted sm:ml-1.5 sm:inline">
              ({r.provider})
            </span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 text-text-muted font-mono tabular-nums">
              {r.latencyMs}ms
            </span>
          )}
          <StatusBadge
            variant={r.valid ? "success" : "error"}
            className={r.valid ? undefined : styles.errorBadge}
            dot={false}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </StatusBadge>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-center py-4 text-text-muted text-sm">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResultsView.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
