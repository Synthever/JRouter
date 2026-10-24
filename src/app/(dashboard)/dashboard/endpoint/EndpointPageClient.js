"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  TUNNEL_BENEFITS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "./endpointConstants";
import { clientPingUrl, clientPingAny } from "./endpointPing";
import useSettingsStore from "@/store/settingsStore";
import EndpointRow from "./components/EndpointRow";
import StatusAlert from "./components/StatusAlert";
import Tooltip from "./components/Tooltip";
import SecurityWarning from "./components/SecurityWarning";
import styles from "./endpoint.module.css";
import ConfigureApiKeyDialog from "./components/ConfigureApiKeyDialog";
import EndpointStats from "./components/EndpointStats";
import { useNotificationStore } from "@/store/notificationStore";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic formatting keeps server and client markup identical.
function formatDate(value, { withYear = true } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const stamp = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return withYear ? `${stamp}, ${date.getUTCFullYear()}` : stamp;
}

function countLabel(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function quotaLabel(key) {
  if (key.maxTokensQuota != null) return `${countLabel(key.quotaTokens)} / ${countLabel(key.maxTokensQuota)} tokens`;
  if (key.maxCostUsd != null) return `$${Number(key.quotaCost || 0).toFixed(2)} / $${Number(key.maxCostUsd).toFixed(2)}`;
  return "Unlimited quota";
}

const AVATAR_TONES = ["var(--brand-lavender)", "var(--brand-peach)", "var(--brand-ochre)", "var(--brand-mint)"];

function ConnectionBadge({ enabled, reachable, loading, checking, previouslyReachable, error, loadingLabel }) {
  let label = "Disabled";
  let tone = "";
  if (loading) {
    label = loadingLabel;
  } else if (enabled) {
    label = reachable ? "Connected" : previouslyReachable ? "Reconnecting" : "Checking";
    tone = reachable ? styles.badgeOn : styles.badgeWarn;
  } else if (error) {
    label = "Error";
    tone = styles.badgeError;
  } else if (checking) {
    label = "Checking";
    tone = styles.badgeWarn;
  }

  return (
    <span className={`${styles.badge} ${tone}`}>
      <i className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

ConnectionBadge.propTypes = {
  enabled: PropTypes.bool,
  reachable: PropTypes.bool,
  loading: PropTypes.bool,
  checking: PropTypes.bool,
  previouslyReachable: PropTypes.bool,
  error: PropTypes.bool,
  loadingLabel: PropTypes.string,
};

/** One remote-access row inside the endpoint rail. */
function RemoteRow({ icon, tone, title, description, badge, children, action }) {
  return (
    <div className={styles.remoteRow}>
      <span className={styles.tile} style={{ background: tone }} aria-hidden="true">
        <Icon className="text-[20px]">{icon}</Icon>
      </span>
      <div className={styles.remoteBody}>
        <b className={styles.remoteTitle}>
          {title}
          {badge}
        </b>
        <p className={styles.remoteDesc}>{description}</p>
        {children}
      </div>
      <div className={styles.remoteActions}>{action}</div>
    </div>
  );
}

RemoteRow.propTypes = {
  icon: PropTypes.string.isRequired,
  tone: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  badge: PropTypes.node,
  children: PropTypes.node,
  action: PropTypes.node,
};

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyFilter, setKeyFilter] = useState("");
  const [freshKeyName, setFreshKeyName] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  // The create dialog defaults to user: handing out an owner key by accident is
  // the one mistake this UI must make hard.
  const [newKeyRole, setNewKeyRole] = useState("user");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [configureKeyId, setConfigureKeyId] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
 const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

 // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  // Clear the "just created" highlight after the reference flash animation.
  useEffect(() => {
    if (!freshKeyName) return;
    const timer = setTimeout(() => setFreshKeyName(""), 2000);
    return () => clearTimeout(timer);
  }, [freshKeyName]);

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false); }
      } else {
        tunnelClientReachableRef.current = false;
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) { tsMissRef.current = 0; setTsReachable(true); if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); } }
        else { tsMissRef.current += 1; if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false); }
      } else {
        tsClientReachableRef.current = false;
      }
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tsEnabled, tsUrl, tunnelReachable, tsReachable]);

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
      const tsUrlVal = data.tailscale?.tunnelUrl || "";
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsData, statusRes] = await Promise.all([
        useSettingsStore.getState().fetchSettings(),
        fetch("/api/tunnel/status", { cache: "no-store" })
      ]);
      if (settingsData) {
        setRequireApiKey(settingsData.requireApiKey || false);
        setRequireLogin(settingsData.requireLogin !== false);
        setHasPassword(settingsData.hasPassword || false);
        setTunnelDashboardAccess(settingsData.tunnelDashboardAccess || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || "");
        setTunnelEnabled(tEnabled);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
        const tsUrlVal = data.tailscale?.tunnelUrl || "";
        setTsUrl(tsUrlVal);
        setTsEnabled(tsEn);
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const updated = await useSettingsStore.getState().patchSettings({ tunnelDashboardAccess: value });
      if (updated) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const updated = await useSettingsStore.getState().patchSettings({ requireApiKey: value });
      if (updated) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    try {
      const fetchKeys = async () => {
        const res = await fetch("/api/keys?view=settings", { cache: "no-store" });
        if (!res.ok) return [];
        const data = await res.json();
        return data.keys || [];
      };

      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      if (existing.length === 0) {
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch { /* fall through to empty render */ }
      }
      setKeys(existing);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  // u2500u2500u2500 Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
  const requestUserAuth = (url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    const createdName = newKeyName.trim();

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, role: newKeyRole }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setFreshKeyName(createdName);
        setKeyFilter("");
        setNewKeyName("");
        setNewKeyRole("user");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      }
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const copyKey = async (keyId) => {
    try {
      const response = await fetch(`/api/keys/${keyId}/secret`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to copy API key.");
      await copy(data.key, keyId);
    } catch (error) { useNotificationStore.getState().error(error.message); }
  };

  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  if (loading) {
    return (
      <div className={`dashboard-surface ${styles.page}`} aria-busy="true" aria-label="Loading endpoint settings">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = baseUrl;

  const activeKeyCount = keys.filter((key) => key.isActive !== false && !key.isExpired).length;
  const pausedKeyCount = keys.length - activeKeyCount;
  const limitedKeyCount = keys.filter((key) => (key.allowedModels?.length || 0) + (key.blockedModels?.length || 0) > 0).length;
  const lastUsedKey = keys
    .filter((key) => key.lastUsedAt)
    .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt))[0] || null;
  const limitedNote = `${limitedKeyCount} limited to specific models${pausedKeyCount ? `, ${pausedKeyCount} paused` : ""}`;
  const lastUsedValue = lastUsedKey ? formatDate(lastUsedKey.lastUsedAt, { withYear: false }) : "Never";
  const lastUsedNote = lastUsedKey ? `${lastUsedKey.name} sent the latest request` : "No requests recorded yet";
  const keyRequiredNote = requireApiKey
    ? "Requests without a valid key are rejected"
    : "Requests without a key are accepted";
  const keyQuery = keyFilter.trim().toLowerCase();
  const matchingKeys = keyQuery ? keys.filter((key) => key.name?.toLowerCase().includes(keyQuery)) : keys;
  const curlSnippet = [
    `curl ${currentEndpoint}/chat/completions \\`,
    '  -H "Authorization: Bearer $JROUTER_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d '{\"model\":\"<model-id>\",",
    '       "messages":[{"role":"user","content":"Hello"}]}\'',
  ].join("\n");

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Endpoint &amp; key</h1>
        <p className={styles.sub}>Point your tools at the gateway, then decide which keys are allowed to use it.</p>
      </header>

      <EndpointStats
        activeKeys={activeKeyCount}
        limitedNote={limitedNote}
        lastUsedValue={lastUsedValue}
        lastUsedNote={lastUsedNote}
        requireApiKey={requireApiKey}
        keyRequiredNote={keyRequiredNote}
      />

      <div className={styles.layout}>
        <section className={`${styles.panel} ${styles.endpointRail}`} aria-labelledby="endpoint-panel-title">
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle} id="endpoint-panel-title">
                <Icon className="text-[18px]" aria-hidden="true">api</Icon>
                API endpoint
              </h2>
              <p className={styles.panelDesc}>Connect your tools locally or enable secure remote access.</p>
            </div>
          </div>

          {/* Local */}
          <EndpointRow
            label="Local"
            url={currentEndpoint}
            copyId="local_url"
            copied={copied}
            onCopy={copy}
            badge="Always on"
          />
          {/* Cloudflare Tunnel */}
          <RemoteRow
            icon="cloud_upload"
            tone="var(--brand-peach)"
            title="Tunnel"
            description="Reach this gateway from anywhere through a secure public URL."
            badge={(
              <ConnectionBadge
                enabled={tunnelEnabled}
                reachable={tunnelReachable}
                loading={tunnelLoading}
                checking={tunnelChecking}
                previouslyReachable={tunnelEverReachable}
                error={tunnelStatus?.type === "error"}
                loadingLabel="Starting"
              />
            )}
            action={(
              <>
                {tunnelLoading ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="power_settings_new"
                    onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  >
                    Stop
                  </Button>
                ) : tunnelEnabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="power_settings_new"
                    onClick={() => setShowDisableTunnelModal(true)}
                  >
                    Disable
                  </Button>
                ) : tunnelStatus?.type === "error" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="cloud_upload"
                    onClick={() => setShowEnableTunnelModal(true)}
                  >
                    Enable
                  </Button>
                ) : tunnelChecking ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="power_settings_new"
                    onClick={() => setTunnelChecking(false)}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="cloud_upload"
                    onClick={() => {
                      if (isLoginUnsafe) {
                        setTunnelStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                        return;
                      }
                      if (!requireApiKey) {
                        setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
                        return;
                      }
                      setShowEnableTunnelModal(true);
                    }}
                  >
                    Enable
                  </Button>
                )}
              </>
            )}
          >
            {tunnelEnabled && !tunnelLoading && tunnelReachable && (
              <div className={styles.urlBox}>
                <output className={`${styles.endpointValue} font-mono`} aria-label="Tunnel endpoint" tabIndex={0}>
                  {`${tunnelPublicUrl || tunnelUrl}/v1`}
                </output>
                <button
                  type="button"
                  onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                  className={styles.iconButton}
                  aria-label="Copy tunnel endpoint"
                >
                  <Icon className="text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</Icon>
                </button>
              </div>
            )}
            {tunnelEnabled && !tunnelLoading && !tunnelReachable && (
              <p className={styles.remoteStatus}>
                <Icon className="animate-spin text-[16px]" aria-hidden="true">progress_activity</Icon>
                {tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}
              </p>
            )}
            {tunnelLoading && (
              <p className={styles.remoteStatus}>
                <Icon className="animate-spin text-[16px]" aria-hidden="true">progress_activity</Icon>
                {tunnelProgress || "Creating tunnel..."}
              </p>
            )}
            {!tunnelEnabled && !tunnelLoading && tunnelStatus?.type === "error" && (
              <p className={`${styles.remoteStatus} ${styles.remoteStatusError}`} role="alert">
                <Icon className="text-[16px]" aria-hidden="true">error</Icon>
                {tunnelStatus.message}
              </p>
            )}
            {!tunnelEnabled && !tunnelLoading && !tunnelStatus && tunnelChecking && (
              <p className={styles.remoteStatus}>
                <Icon className="animate-spin text-[16px]" aria-hidden="true">progress_activity</Icon>
                Checking...
              </p>
            )}
          </RemoteRow>
          {/* Tailscale */}
          <RemoteRow
            icon="vpn_lock"
            tone="var(--brand-lavender)"
            title="Tailscale"
            description="Reach this gateway from devices on your private tailnet."
            badge={(
              <ConnectionBadge
                enabled={tsEnabled}
                reachable={tsReachable}
                loading={tsLoading || tsConnecting}
                previouslyReachable={tsEverReachable}
                error={tsStatus?.type === "error"}
                loadingLabel="Connecting"
              />
            )}
            action={(
              <>
                {(tsLoading || tsConnecting) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="power_settings_new"
                    onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                  >
                    Stop
                  </Button>
                ) : tsEnabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="power_settings_new"
                    onClick={() => setShowDisableTsModal(true)}
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className={styles.ctaSm}
                    icon="vpn_lock"
                    onClick={() => {
                      if (isLoginUnsafe) {
                        setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                        return;
                      }
                      handleOpenTsModal();
                    }}
                  >
                    Enable
                  </Button>
                )}
              </>
            )}
          >
            {tsEnabled && !tsLoading && tsReachable && (
              <div className={styles.urlBox}>
                <output className={`${styles.endpointValue} font-mono`} aria-label="Tailscale endpoint" tabIndex={0}>
                  {`${tsUrl}/v1`}
                </output>
                <button
                  type="button"
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className={styles.iconButton}
                  aria-label="Copy Tailscale endpoint"
                >
                  <Icon className="text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</Icon>
                </button>
              </div>
            )}
            {tsEnabled && !tsLoading && !tsReachable && (
              <p className={styles.remoteStatus}>
                <Icon className="animate-spin text-[16px]" aria-hidden="true">progress_activity</Icon>
                {tsEverReachable ? "Tailscale reconnecting..." : "Tailscale checking..."}
              </p>
            )}
            {(tsLoading || tsConnecting) && (
              <p className={styles.remoteStatus}>
                <Icon className="animate-spin text-[16px]" aria-hidden="true">progress_activity</Icon>
                {tsProgress || "Connecting..."}
              </p>
            )}
            {(tsLoading || tsConnecting) && tsAuthUrl && (
              <Button
                variant="outline"
                size="sm"
                className={styles.ctaSm}
                icon="open_in_new"
                onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
              >
                {tsAuthLabel || "Open"}
              </Button>
            )}
            {!tsEnabled && !tsLoading && !tsConnecting && tsStatus?.type === "error" && (
              <p className={`${styles.remoteStatus} ${styles.remoteStatusError}`} role="alert">
                <Icon className="text-[16px]" aria-hidden="true">error</Icon>
                {tsStatus.message}
              </p>
            )}
          </RemoteRow>

          {/* Pre-enable security gate banner */}
          {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
            <div className={styles.railNote}>
              <SecurityWarning
                message={unsafeReason}
                action={{ label: "Open settings", href: "/dashboard/profile" }}
              />
            </div>
          )}

          {/* Security warnings when tunnel or tailscale is active */}
          {(tunnelEnabled || tsEnabled) && (
            <div className={styles.railWarnings}>
              {!requireApiKey && (
                <SecurityWarning
                  message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                  action={{ label: "Enable", href: "#require-api-key" }}
                />
              )}
              {(!requireLogin || !hasPassword) && (
                <SecurityWarning
                  message={
                    !requireLogin
                      ? "Require login is disabled — anyone can access your dashboard via tunnel."
                      : "Dashboard uses the default password — change it in Profile settings."
                  }
                  action={{
                    label: !requireLogin ? "Enable" : "Change password",
                    href: "/dashboard/profile",
                  }}
                />
              )}
            </div>
          )}

          {(tunnelEnabled || tsEnabled) && (
            <div className={styles.accessRow}>
              <Toggle
                aria-label="Allow dashboard access via tunnel"
                checked={tunnelDashboardAccess}
                onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
              />
              <div className={styles.accessCopy}>
                <p className={styles.accessTitle}>
                  Allow dashboard access via tunnel
                  <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
                </p>
                <span className={styles.accessHint}>Dashboard login is still required.</span>
              </div>
            </div>
          )}

          <div className={styles.tryBlock}>
            <div className={styles.rowHead}>
              <span className={styles.rowLabel}>Try it from your terminal</span>
              <button
                type="button"
                className={styles.codeCopy}
                onClick={() => copy(curlSnippet, "curl")}
                aria-label="Copy curl command"
              >
                <Icon className="text-[18px]">{copied === "curl" ? "check" : "content_copy"}</Icon>
              </button>
            </div>
            <div className={styles.codeWrap}>
              <pre className={`${styles.codeBlock} font-mono`}><code>{curlSnippet}</code></pre>
            </div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.keysPanel}`} id="require-api-key" aria-labelledby="keys-panel-title">
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle} id="keys-panel-title">
                <Icon className="text-[18px]" aria-hidden="true">vpn_key</Icon>
                API keys
              </h2>
              <p className={styles.panelDesc}>Manage credentials used to authenticate API requests.</p>
            </div>
            <Button className={styles.cta} variant="contrast" icon="add" onClick={() => setShowAddModal(true)}>
              Create key
            </Button>
          </div>

          <div className={styles.requireRow}>
            <div>
              <p className={styles.requireTitle}>Require API key</p>
              <p className={styles.requireHint}>Requests without a valid key will be rejected</p>
            </div>
            <Toggle
              aria-label="Require API key"
              checked={requireApiKey}
              onChange={() => handleRequireApiKey(!requireApiKey)}
            />
          </div>

          {!requireApiKey && (
            <p className={styles.inlineWarn} role="status">
              {isRemoteHost ? "This endpoint is exposed remotely without a key. " : ""}
              Anyone who can reach this endpoint can send requests. Turn this back on before enabling Tunnel or Tailscale.
            </p>
          )}

          <div className={styles.listTools}>
            <label className={styles.filter}>
              <Icon className="text-[18px]" aria-hidden="true">search</Icon>
              <input
                type="search"
                value={keyFilter}
                onChange={(event) => setKeyFilter(event.target.value)}
                placeholder="Filter keys by name"
                aria-label="Filter keys"
              />
            </label>
            <span className={styles.count} aria-live="polite">
              {keyQuery
                ? `${matchingKeys.length} of ${keys.length} keys`
                : `${keys.length} ${keys.length === 1 ? "key" : "keys"}`}
            </span>
          </div>

          {keys.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon className="text-[32px]" aria-hidden="true">vpn_key</Icon>
              <p className={styles.emptyTitle}>No API keys yet</p>
              <p className={styles.emptyHint}>Create your first API key to get started.</p>
              <Button className={styles.ctaSm} variant="contrast" icon="add" onClick={() => setShowAddModal(true)}>
                Create key
              </Button>
            </div>
          ) : matchingKeys.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyHint}>
                No keys match “{keyFilter.trim()}”. Clear the filter or create a new key.
              </p>
            </div>
          ) : (
            <ul className={styles.keyList}>
              {matchingKeys.map((key, index) => {
                const keyState = key.isActive === false ? "Paused" : key.isExpired ? "Expired" : "Active";
                const stateTone = key.isActive === false ? "" : key.isExpired ? styles.badgeError : styles.badgeOn;
                const restricted = (key.allowedModels?.length || 0) + (key.blockedModels?.length || 0) > 0;
                return (
                  <li
                    key={key.id}
                    className={`${styles.keyRow} ${key.isActive === false ? styles.keyRowOff : ""} ${freshKeyName === key.name ? styles.fresh : ""}`}
                  >
                    <span
                      className={styles.avatar}
                      style={{ background: AVATAR_TONES[index % AVATAR_TONES.length] }}
                      aria-hidden="true"
                    >
                      {(key.name || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className={styles.keyBody}>
                      <div className={styles.keyTitle}>
                        <b>{key.name}</b>
                        <span className={`${styles.badge} ${stateTone}`}>
                          <i className={styles.dot} aria-hidden="true" />
                          {keyState}
                        </span>
                        {key.role === "owner" && <span className={`${styles.badge} ${styles.badgeLav}`}>Owner</span>}
                        {restricted && <span className={styles.badge}>Restricted models</span>}
                      </div>
                      <div className={styles.keyCredential}>
                        <code className={`${styles.keyValue} font-mono`} data-i18n-skip>
                          {key.keyPrefix}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyKey(key.id)}
                          className={styles.iconButton}
                          aria-label={`Copy ${key.name} key`}
                        >
                          <Icon className="text-[16px]">
                            {copied === key.id ? "check" : "content_copy"}
                          </Icon>
                        </button>
                      </div>
                      <div className={styles.keyMeta}>
                        <span>Created {formatDate(key.createdAt)}</span>
                        <span>{key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : "Never used"}</span>
                        <span>{quotaLabel(key)}</span>
                        {key.rateLimitRpm != null && <span>{key.rateLimitRpm} RPM</span>}
                      </div>
                    </div>
                    <div className={styles.keyActions}>
                      <Button
                        className={styles.ctaSm}
                        variant="outline"
                        size="sm"
                        icon="settings"
                        onClick={() => setConfigureKeyId(key.id)}
                        aria-label={`Configure ${key.name}`}
                      >
                        Configure
                      </Button>
                      <Toggle
                        aria-label={`${key.isActive === false ? "Resume" : "Pause"} ${key.name}`}
                        size="sm"
                        checked={key.isActive ?? true}
                        onChange={(checked) => {
                          if (key.isActive && !checked) {
                            setConfirmState({
                              title: "Pause API Key",
                              message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                              onConfirm: async () => {
                                setConfirmState(null);
                                handleToggleKey(key.id, checked);
                              }
                            });
                          } else {
                            handleToggleKey(key.id, checked);
                          }
                        }}
                        title={key.isActive ? "Pause key" : "Resume key"}
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(key.id)}
                        className={`${styles.iconButton} ${styles.dangerButton}`}
                        aria-label={`Delete ${key.name}`}
                      >
                        <Icon className="text-[18px]">delete</Icon>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {configureKeyId && <ConfigureApiKeyDialog key={configureKeyId} keyId={configureKeyId} onClose={() => setConfigureKeyId(null)} onSaved={(updated) => setKeys((previous) => previous.map((key) => key.id === updated.id ? updated : key))} />}

      {/* Add Key Modal */}
      <Modal
        className={styles.dialog}
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
          setNewKeyRole("user");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            aria-label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Key role">
            {[
              { value: "user", label: "User", hint: "Published Custom Model-IDs only" },
              { value: "owner", label: "Owner", hint: "Full access to every model and combo" },
            ].map((option) => (
              <label key={option.value} className="flex items-start gap-3 cursor-pointer rounded-[var(--r2)] border border-[var(--line)] p-3 hover:bg-[var(--surface-2)]">
                <input
                  type="radio"
                  name="new-key-role"
                  value={option.value}
                  checked={newKeyRole === option.value}
                  onChange={() => setNewKeyRole(option.value)}
                  className="mt-0.5 size-4 accent-[var(--text)] shrink-0"
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block mt-1 text-xs text-[var(--text-2)]">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="contrast" onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
                setNewKeyRole("user");
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        className={styles.dialog}
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className={`${styles.warning} rounded-[var(--r2)] p-4`}>
            <p className="text-sm mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className={styles.field}
              inputClassName="font-mono"
              aria-label="Created API key"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button variant="contrast" onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        className={styles.dialog}
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Icon className="text-text-muted shrink-0">cloud_upload</Icon>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local JRouter to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-[var(--r2)] bg-surface-2">
                <Icon className="text-xl text-text-muted mb-1">{benefit.icon}</Icon>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button variant="contrast" onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        className={styles.dialog}
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button className={styles.dangerButton} onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        className={styles.dialog}
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <Icon className="animate-spin text-sm">progress_activity</Icon>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button variant="contrast" onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Icon className="animate-spin text-sm">progress_activity</Icon>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-surface-inset rounded-[var(--r1)] p-3 max-h-40 overflow-y-auto font-mono text-xs text-text-muted" data-i18n-skip>
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-[var(--pos)]">
                <Icon className="text-[16px]">check_circle</Icon>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  variant="contrast"
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        className={styles.dialog}
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button className={styles.dangerButton} onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        className={styles.dialog}
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


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};
