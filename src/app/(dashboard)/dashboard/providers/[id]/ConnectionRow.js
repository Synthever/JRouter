"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Toggle, Tooltip } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";
import StatusBadge from "@/shared/components/StatusBadge";
import styles from "../providers.module.css";

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const proxyDropdownRef = useRef(null);
  const proxyBtnRef = useRef(null);
  const [proxyDropdownStyle, setProxyDropdownStyle] = useState(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = (() => {
    if (!autoPing) return "";
    const activeModes = [];
    if (autoPing.reactiveOn) activeModes.push("On reset");
    if (autoPing.scheduleOn) activeModes.push(`Scheduled (${autoPing.scheduleSummary || "active"})`);
    if (activeModes.length > 0) {
      return `Auto-ping active: ${activeModes.join(" + ")}. Click to configure.`;
    }
    return autoPing.provider === "codex"
      ? "Auto-starts the next 5h Codex window after reset or on schedule. Click to configure."
      : "Auto-starts a new window on quota reset or fixed schedule. Click to configure.";
  })();

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Render via portal + fixed positioning so ancestor overflow (scrollable
  // connections list) can't clip the dropdown
  const toggleProxyDropdown = () => {
    if (showProxyDropdown) {
      setShowProxyDropdown(false);
      return;
    }
    const rect = proxyBtnRef.current?.getBoundingClientRect();
    if (!rect) {
      setShowProxyDropdown(true);
      return;
    }
    const estimatedHeight = ((proxyPools?.length || 0) + 1) * 34 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    setProxyDropdownStyle({
      position: "fixed",
      right: window.innerWidth - rect.right,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(rect.top - 8, 120) }
        : { top: rect.bottom + 4, maxHeight: Math.max(spaceBelow - 8, 120) }),
    });
    setShowProxyDropdown(true);
  };

  // Close dropdown when clicking outside, scrolling, or resizing
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handleClick = (e) => {
      if (
        proxyDropdownRef.current?.contains(e.target) ||
        proxyBtnRef.current?.contains(e.target)
      ) return;
      setShowProxyDropdown(false);
    };
    const close = () => setShowProxyDropdown(false);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  const isOff = connection.isActive === false;

  return (
    <div className={`${styles.connRow} ${isOff ? styles.connRowOff : ""}`}>
      <div className={styles.connMain}>
        <div className={styles.connPriority}>
          <button
            aria-label={`Move ${displayName} up`}
            onClick={onMoveUp}
            disabled={isFirst}
            className={styles.connArrow}
          >
            <Icon size={14}>keyboard_arrow_up</Icon>
          </button>
          <button
            aria-label={`Move ${displayName} down`}
            onClick={onMoveDown}
            disabled={isLast}
            className={styles.connArrow}
          >
            <Icon size={14}>keyboard_arrow_down</Icon>
          </button>
        </div>
        <span className={styles.connTile} aria-hidden="true">
          <Icon size={18}>{authIcon}</Icon>
        </span>
        <div className={styles.connBody}>
          <p className={styles.connName} title={displayName}>{displayName}</p>
          {secondaryDisplayName && (
            <p className={styles.connSub} title={secondaryDisplayName}>{secondaryDisplayName}</p>
          )}
          <div className={styles.connBadges}>
            <StatusBadge variant={getStatusVariant()} className={getStatusVariant() === "error" ? styles.errorBadge : undefined}>
              {isOff ? "disabled" : (effectiveStatus || "Unknown")}
            </StatusBadge>
            {connection.demotedAt && !isOff && (
              <span
                title={`Failed recently — serving at the back of the rotation until its next success (since ${new Date(connection.demotedAt).toLocaleTimeString()})`}
                className={styles.connBadgeText}
              >
                ⬇ demoted
              </span>
            )}
            <StatusBadge dot={false}>
              {authLabel}
            </StatusBadge>
            {hasAnyProxy && (
              <StatusBadge variant={proxyBadgeVariant} dot={false}>
                Proxy
              </StatusBadge>
            )}
            {isCooldown && !isOff && <CooldownTimer until={modelLockUntil} />}
            {getOneByOneLabel() && (
              <StatusBadge variant={getOneByOneVariant() === "primary" ? "default" : getOneByOneVariant()} dot={false}>
                {getOneByOneLabel()}
              </StatusBadge>
            )}
            <span className={styles.connBadgeText}>#{connection.priority}</span>
            {connection.globalPriority && (
              <span className={styles.connBadgeText}>Auto: {connection.globalPriority}</span>
            )}
          </div>
          {connection.lastError && !isOff && (
            <span className={styles.connError} title={connection.lastError}>
              {connection.lastError}
            </span>
          )}
          {hasAnyProxy && (
            <div className={styles.connProxy}>
              <span title={proxyDisplayText}>{proxyDisplayText}</span>
              {maskedProxyUrl && (
                <code className={styles.connProxyCode}>{maskedProxyUrl}</code>
              )}
              {noProxyText && (
                <span title={noProxyText}>no_proxy: {noProxyText}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={styles.connActions}>
        <div className={styles.connButtons}>
          {(proxyPools || []).length > 0 && (
            <div>
              <button
                ref={proxyBtnRef}
                onClick={toggleProxyDropdown}
                className={styles.connButton}
                disabled={updatingProxy}
                aria-label={`Proxy for ${displayName}`}
                title={hasAnyProxy ? "Change proxy pool" : "Bind a proxy pool"}
              >
                <Icon size={16}>
                  {updatingProxy ? "progress_activity" : "lan"}
                </Icon>
                <span>Proxy</span>
              </button>
              {showProxyDropdown && createPortal(
                <div
                  ref={proxyDropdownRef}
                  style={proxyDropdownStyle}
                  className={styles.menu}
                >
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`${styles.menuItem} ${!boundProxyPoolId ? styles.menuItemActive : ""}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`${styles.menuItem} ${boundProxyPoolId === pool.id ? styles.menuItemActive : ""}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={autoPing.onConfigure}
                className={styles.connButton}
                aria-label={`Auto-ping for ${displayName}`}
              >
                <Icon size={16}>bolt</Icon>
                <span>Auto-ping</span>
              </button>
            </Tooltip>
          )}
          <button onClick={onEdit} className={styles.iconButton} aria-label={`Edit ${displayName}`} title={`Edit ${displayName}`}>
            <Icon size={16}>edit</Icon>
          </button>
          <button onClick={onDelete} className={`${styles.iconButton} ${styles.error}`} aria-label={`Delete ${displayName}`} title={`Delete ${displayName}`}>
            <Icon size={16}>delete</Icon>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          aria-label={`${isOff ? "Enable" : "Disable"} ${displayName}`}
          onChange={onToggleActive}
          title={isOff ? "Enable connection" : "Disable connection"}
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
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    isActive: PropTypes.bool,
    provider: PropTypes.string,
    reactiveOn: PropTypes.bool,
    scheduleOn: PropTypes.bool,
    scheduleSummary: PropTypes.string,
    onConfigure: PropTypes.func,
  }),
};
