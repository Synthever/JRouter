"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStatusVariant } from "@/shared/utils/connectionStatus";
import { applyDemotionOverlay } from "@/sse/services/demotion.js";
import PropTypes from "prop-types";
import { Button, Modal, Select, Toggle, EditConnectionModal, ConfirmModal } from "@/shared/components";
import styles from "../../media-providers/media-providers.module.css";

const STATUS_CLASS = {
  success: styles.badgeOn,
  error: styles.badgeError,
  warning: styles.badgeWarn,
  default: "",
};

// ── CooldownTimer ──────────────────────────────────────────────
function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) { setRemaining(""); return; }
      const s = Math.floor(diff / 1000);
      if (s < 60) setRemaining(`${s}s`);
      else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!remaining) return null;
  return <span className={styles.cooldown}>⏱ {remaining}</span>;
}

CooldownTimer.propTypes = { until: PropTypes.string.isRequired };

// ── ConnectionRow ──────────────────────────────────────────────
function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((p) => [p.id, p]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId ? `Pool: ${boundProxyPoolId} (inactive/missing)`
    : hasLegacyProxy ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}` : "";

  let maskedProxyUrl = "";
  const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
  if (rawProxyUrl) {
    try {
      const p = new URL(rawProxyUrl);
      maskedProxyUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
    } catch { maskedProxyUrl = rawProxyUrl; }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";
  const proxyBadgeClass = boundProxyPool?.isActive === true ? styles.badgeOn : (boundProxyPoolId || hasLegacyProxy) ? styles.badgeError : "";

  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v).filter(Boolean).sort()[0] || null;

  useEffect(() => {
    const check = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v).filter(v => v && new Date(v).getTime() > Date.now()).sort()[0] || null;
      setIsCooldown(!!until);
    };
    check();
    const t = modelLockUntil ? setInterval(check, 1000) : null;
    return () => { if (t) clearInterval(t); };
  }, [modelLockUntil]);

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus = connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;
  const statusLabel = connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown");

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try { await onUpdateProxy(poolId === "__none__" ? null : poolId); }
    finally { setUpdatingProxy(false); setShowProxyDropdown(false); }
  };

  return (
    <div className={`${styles.rowItem} ${connection.isActive === false ? styles.rowOff : ""}`}>
      <div className={styles.rowMain}>
        <div className={styles.reorder}>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className={styles.iconBtn}
            aria-label={`Move ${displayName} up`}
            title="Move up"
          >
            <Icon className="text-[16px]">keyboard_arrow_up</Icon>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className={styles.iconBtn}
            aria-label={`Move ${displayName} down`}
            title="Move down"
          >
            <Icon className="text-[16px]">keyboard_arrow_down</Icon>
          </button>
        </div>

        <Icon className={styles.rowIcon}>{isOAuth ? "lock" : "key"}</Icon>

        <div className={styles.rowBody}>
          <p className={styles.rowTitle}>{displayName}</p>
          <div className={styles.rowMeta}>
            <span className={`${styles.badge} ${STATUS_CLASS[getStatusVariant(connection.isActive, effectiveStatus)] || ""}`}>
              <i className={styles.dot} aria-hidden="true" />
              {statusLabel}
            </span>
            {connection.demotedAt && connection.isActive !== false && (
              <span
                className={styles.demoted}
                title={`Failed recently — serving at the back of the rotation until its next success (since ${new Date(connection.demotedAt).toLocaleTimeString()})`}
              >
                ⬇ demoted
              </span>
            )}
            {hasAnyProxy && (
              <span className={`${styles.badge} ${proxyBadgeClass}`}>Proxy</span>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className={styles.metaError} title={connection.lastError}>{connection.lastError}</span>
            )}
            <span className={styles.metaMono}>#{connection.priority}</span>
          </div>

          {hasAnyProxy && (
            <div className={styles.proxyLine}>
              <span className={styles.metaText} title={proxyDisplayText}>{proxyDisplayText}</span>
              {maskedProxyUrl && <code className={styles.proxyCode}>{maskedProxyUrl}</code>}
              {noProxyText && (
                <span className={styles.metaText} title={noProxyText}>no_proxy: {noProxyText}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.rowActions}>
        {(proxyPools || []).length > 0 && (
          <div className={styles.menuWrap} ref={proxyDropdownRef}>
            <button
              type="button"
              onClick={() => setShowProxyDropdown((v) => !v)}
              className={styles.iconBtn}
              disabled={updatingProxy}
              aria-label="Proxy pool"
              aria-haspopup="menu"
              aria-expanded={showProxyDropdown}
              title="Proxy pool"
            >
              <Icon className="text-[18px]">{updatingProxy ? "progress_activity" : "lan"}</Icon>
            </button>
            {showProxyDropdown && (
              <div className={styles.proxyMenu} role="menu" aria-label="Proxy pool">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!boundProxyPoolId}
                  aria-current={!boundProxyPoolId ? "true" : undefined}
                  onClick={() => handleSelectProxy("__none__")}
                  className={styles.proxyOption}
                >
                  None
                </button>
                {(proxyPools || []).map((pool) => (
                  <button
                    key={pool.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={boundProxyPoolId === pool.id}
                    aria-current={boundProxyPoolId === pool.id ? "true" : undefined}
                    onClick={() => handleSelectProxy(pool.id)}
                    className={styles.proxyOption}
                  >
                    {pool.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onEdit}
          className={styles.iconBtn}
          aria-label={`Edit ${displayName}`}
          title="Edit"
        >
          <Icon className="text-[16px]">edit</Icon>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          aria-label={`Delete ${displayName}`}
          title="Delete"
        >
          <Icon className="text-[16px]">delete</Icon>
        </button>
        <Toggle
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          aria-label={`${(connection.isActive ?? true) ? "Disable" : "Enable"} ${displayName}`}
          title={(connection.isActive ?? true) ? "Disable" : "Enable"}
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.array,
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

// ── AddApiKeyModal ─────────────────────────────────────────────
function AddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: NONE });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch { setValidationResult("failed"); }
    finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); }
      finally { setValidating(false); }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className={styles.fieldList}>
        <div>
          <label className={styles.fieldLabel}>Name</label>
          <input className={styles.input} value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Key" />
        </div>
        <div className={styles.buttonRow}>
          <div className="flex-1">
            <label className={styles.fieldLabel}>API Key</label>
            <input type="password" className={styles.input} value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} />
          </div>
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <span className={`${styles.badge} ${validationResult === "success" ? styles.badgeOn : styles.badgeError}`}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </span>
        )}
        <div>
          <label className={styles.fieldLabel}>Priority</label>
          <input type="number" className={styles.input} value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })} />
        </div>
        <Select label="Proxy Pool" value={formData.proxyPoolId} onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[{ value: NONE, label: "None" }, ...(proxyPools || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <div className={styles.buttonRow}>
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  proxyPools: PropTypes.array,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ConnectionsCard ────────────────────────────────────────────
// Self-contained panel: fetches, displays and manages all connections for a provider.
// Only mounted by the media-provider detail page.
export default function ConnectionsCard({ providerId, isOAuth }) {
  const [connections, setConnections] = useState([]);
  const reorderBusy = useRef(false);
  const [reordering, setReordering] = useState(false);
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("1");
  // null = default ON (nothing persisted); false = user opted out
  const [demoteOnError, setDemoteOnError] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const [connRes, proxyRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connData = await connRes.json();
      const proxyData = await proxyRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connRes.ok) setConnections((connData.connections || []).filter((c) => c.provider === providerId));
      if (proxyRes.ok) setProxyPools(proxyData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Move-on-error toggle: absent = ON (default); only false = explicitly off
      setDemoteOnError(override.demoteOnError === false ? false : null);
    } catch (e) { console.log("ConnectionsCard fetch error:", e); }
    finally { setLoading(false); }
  }, [providerId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Keep demotion/cooldown badges fresh while the user stares at the list.
  useEffect(() => {
    const t = setInterval(() => { fetch_(); }, 5000);
    return () => clearInterval(t);
  }, [fetch_]);

  const saveStrategy = async (strategy, stickyLimit) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (e) { console.log("saveStrategy error:", e); }
  };

  // Move-on-error per-provider toggle (same absence-is-ON contract as page.js)
  const saveDemoteOnError = async (enabled) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const existing = { ...(current[providerId] || {}) };
      if (enabled) delete existing.demoteOnError;
      else existing.demoteOnError = false;
      const updated = { ...current };
      if (Object.keys(existing).length === 0) delete updated[providerId];
      else updated[providerId] = existing;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (e) { console.log("saveDemoteOnError error:", e); }
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
      await fetch_();
      reorderBusy.current = false;
      setReordering(false);
    }
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
        } catch (e) { console.log("delete error:", e); }
      }
    });
  };

  const handleToggleActive = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
    } catch (e) { console.log("toggle error:", e); }
  };

  const handleUpdateProxy = async (connId, proxyPoolId) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: proxyPoolId || null }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === connId ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } } : c));
    } catch (e) { console.log("proxy error:", e); }
  };

  const handleSaveApiKey = async (formData) => {
    try {
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, ...formData }) });
      if (res.ok) { await fetch_(); setShowAddModal(false); }
    } catch (e) { console.log("save apikey error:", e); }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { await fetch_(); setShowEditModal(false); }
    } catch (e) { console.log("update connection error:", e); }
  };

  if (loading) {
    return (
      <section className={styles.panel} aria-label="Connections">
        <div className={styles.loading} />
      </section>
    );
  }

  const displayedConnections = demoteOnError === false ? connections : applyDemotionOverlay(connections);
  const manualIndexById = new Map(connections.map((conn, index) => [conn.id, index]));

  return (
    <>
      <section className={styles.panel} aria-labelledby="connections-heading">
        <div className={styles.panelHead}>
          <div className="min-w-0">
            <h2 id="connections-heading" className={styles.panelTitle}>
              <Icon className={styles.panelIcon}>lan</Icon> Connections
              <small>{connections.length}</small>
            </h2>
            <p className={styles.panelDesc}>
              Routing order follows priority; the arrows swap manual neighbours.
            </p>
          </div>
          <div className={styles.panelActions}>
            <span className={styles.controlLabel}>Round Robin</span>
            <Toggle
              checked={providerStrategy === "round-robin"}
              aria-label="Round robin"
              onChange={(enabled) => {
                const strategy = enabled ? "round-robin" : null;
                setProviderStrategy(strategy);
                if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
                saveStrategy(strategy, enabled ? (providerStickyLimit || "1") : providerStickyLimit);
              }}
            />
            {providerStrategy === "round-robin" && (
              <>
                <span className={styles.controlLabel}>Pool</span>
                <input
                  type="number"
                  min={1}
                  value={providerStickyLimit}
                  onChange={(e) => { setProviderStickyLimit(e.target.value); saveStrategy("round-robin", e.target.value); }}
                  className={styles.poolInput}
                  aria-label="Sticky round robin pool size"
                />
              </>
            )}
            <span className={styles.controlLabel}>Auto-demote</span>
            <Toggle
              checked={demoteOnError === null ? true : demoteOnError}
              aria-label="Auto-demote on error"
              onChange={(enabled) => {
                setDemoteOnError(enabled ? null : false);
                saveDemoteOnError(enabled);
              }}
            />
          </div>
        </div>

        {connections.length === 0 ? (
          <div className={styles.empty}>
            <p>No connections yet.</p>
            <div className={styles.emptyActions}>
              <Button size="sm" variant="outline" icon="add" onClick={() => setShowAddModal(true)}>
                Add Connection
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.rowList}>
              {displayedConnections.map((conn) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  proxyPools={proxyPools}
                  isOAuth={isOAuth}
                  isFirst={reordering || manualIndexById.get(conn.id) === 0}
                  isLast={reordering || manualIndexById.get(conn.id) === connections.length - 1}
                  onMoveUp={() => handleSwapPriority(conn.id, connections[manualIndexById.get(conn.id) - 1]?.id)}
                  onMoveDown={() => handleSwapPriority(conn.id, connections[manualIndexById.get(conn.id) + 1]?.id)}
                  onToggleActive={(isActive) => handleToggleActive(conn.id, isActive)}
                  onUpdateProxy={(poolId) => handleUpdateProxy(conn.id, poolId)}
                  onEdit={() => { setSelectedConnection(conn); setShowEditModal(true); }}
                  onDelete={() => handleDelete(conn.id)}
                />
              ))}
            </div>
            <div className={styles.panelActions}>
              <Button size="sm" variant="outline" icon="add" onClick={() => setShowAddModal(true)}>
                Add Connection
              </Button>
            </div>
          </>
        )}
      </section>

      <AddApiKeyModal
        isOpen={showAddModal}
        provider={providerId}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
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
    </>
  );
}

ConnectionsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  isOAuth: PropTypes.bool,
};
