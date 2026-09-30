"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal } from "@/shared/components";
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
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

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

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost] = useState(() => (
    typeof window !== "undefined"
      ? !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
      : false
  ));

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
  async function syncTunnelStatus() {
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
  }

  async function loadSettings() {
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
  }

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

  async function fetchData() {
    try {
      const fetchKeys = async () => {
        const res = await fetch("/api/keys");
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
  }

  // ─── Cloudflare Tunnel handlers
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

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
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
            setVisibleKeys(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
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

  const maskKey = (fullKey) => {
    if (!fullKey || fullKey.length <= 10) return fullKey || "";
    return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl] = useState(() => (
    typeof window !== "undefined"
      ? `${window.location.origin}/v1`
      : "/v1"
  ));

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = baseUrl;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Gateway Connection Ports (3-Column Hardware Dock) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--text-3)]">lan</span>
            <h2 className="text-sm sm:text-base font-semibold tracking-tight text-[var(--text)]">Gateway Ingress Ports</h2>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-3)] uppercase tracking-wider hidden sm:inline">
            3 Ports Active & Configurable
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Port 01: Local Loopback */}
          <div className="flex flex-col justify-between p-4 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] transition-colors min-h-[160px]">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[10px] font-mono font-medium text-[var(--text-3)] tracking-[0.2em] uppercase">
                  PORT 01 // LOCAL
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[#14251D] border border-[#34D39A]/30 text-[10px] font-mono font-medium text-[var(--pos)] uppercase">
                  <span className="size-1.5 rounded-full bg-[var(--pos)] shadow-[0_0_6px_rgba(52,211,154,0.6)]" />
                  ONLINE
                </span>
              </div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Local Host Loopback</h3>
              <p className="text-xs text-[var(--text-2)] mb-3 leading-relaxed">
                Direct loopback proxy on current machine with zero network overhead.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--line)]">
              <Input
                value={currentEndpoint}
                readOnly
                inputClassName="font-mono text-xs text-[var(--text)] u-tnum"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => copy(currentEndpoint, "local_url")}
                className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[var(--text)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                title={copied === "local_url" ? "Copied" : "Copy Local URL"}
              >
                <span className={`material-symbols-outlined text-[16px] ${copied === "local_url" ? "text-[var(--pos)]" : ""}`}>
                  {copied === "local_url" ? "check" : "content_copy"}
                </span>
              </button>
            </div>
          </div>

          {/* Port 02: Cloudflare WAN Tunnel */}
          <div className="flex flex-col justify-between p-4 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] transition-colors min-h-[160px]">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[10px] font-mono font-medium text-[var(--text-3)] tracking-[0.2em] uppercase">
                  PORT 02 // CLOUDFLARE WAN
                </span>
                {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[#14251D] border border-[#34D39A]/30 text-[10px] font-mono font-medium text-[var(--pos)] uppercase">
                    <span className="size-1.5 rounded-full bg-[var(--pos)] animate-pulse" />
                    WAN ACTIVE
                  </span>
                ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[#261F12] border border-[#F2B34B]/30 text-[10px] font-mono font-medium text-[var(--warn)] uppercase">
                    <span className="size-1.5 rounded-full bg-[var(--warn)] animate-ping" />
                    RECONNECTING
                  </span>
                ) : tunnelLoading || tunnelChecking ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono font-medium text-[var(--text-2)] uppercase">
                    <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span>
                    INIT
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono font-medium text-[var(--text-3)] uppercase">
                    STANDBY
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Cloudflare Edge Tunnel</h3>
              <p className="text-xs text-[var(--text-2)] mb-3 leading-relaxed">
                Expose your gateway publicly through Cloudflare global edge without port-forwarding.
              </p>
            </div>

            <div className="pt-2 border-t border-[var(--line)]">
              {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={`${tunnelPublicUrl || tunnelUrl}/v1`}
                    readOnly
                    inputClassName="font-mono text-xs text-[var(--text)] u-tnum"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                    className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[var(--text)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                    title={copied === "tunnel_url" ? "Copied" : "Copy URL"}
                  >
                    <span className={`material-symbols-outlined text-[16px] ${copied === "tunnel_url" ? "text-[var(--pos)]" : ""}`}>
                      {copied === "tunnel_url" ? "check" : "content_copy"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDisableTunnelModal(true)}
                    className="size-8 rounded-[var(--r1)] border border-[#FF6B6B]/30 bg-[#281515] hover:bg-[#381a1a] text-[#FF6B6B] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop Tunnel"
                  >
                    <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
                  </button>
                </div>
              ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--r1)] border border-[#F2B34B]/30 bg-[#261F12] text-xs font-mono text-[var(--warn)]">
                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    <span className="truncate">{tunnelEverReachable ? "Reconnecting..." : "Checking ingress..."}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDisableTunnelModal(true)}
                    className="size-8 rounded-[var(--r1)] border border-[#FF6B6B]/30 bg-[#281515] text-[#FF6B6B] flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop"
                  >
                    <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
                  </button>
                </div>
              ) : tunnelLoading || tunnelChecking ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] text-xs font-mono text-[var(--text-3)]">
                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    <span className="truncate">{tunnelProgress || "Starting tunnel..."}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setTunnelLoading(false); setTunnelChecking(false); setTunnelProgress(""); }}
                    className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[#FF6B6B] flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon="cloud_upload"
                  fullWidth
                  onClick={() => {
                    if (isLoginUnsafe) {
                      setTunnelStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                      return;
                    }
                    if (!requireApiKey) {
                      setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating tunnel." });
                      return;
                    }
                    setShowEnableTunnelModal(true);
                  }}
                >
                  Activate Tunnel
                </Button>
              )}
            </div>
          </div>

          {/* Port 03: Tailscale Mesh VPN */}
          <div className="flex flex-col justify-between p-4 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] transition-colors min-h-[160px]">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[10px] font-mono font-medium text-[var(--text-3)] tracking-[0.2em] uppercase">
                  PORT 03 // TAILSCALE MESH
                </span>
                {tsEnabled && !tsLoading && tsReachable ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[#14251D] border border-[#34D39A]/30 text-[10px] font-mono font-medium text-[var(--pos)] uppercase">
                    <span className="size-1.5 rounded-full bg-[var(--pos)] animate-pulse" />
                    MESH ACTIVE
                  </span>
                ) : tsEnabled && !tsLoading && !tsReachable ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[#261F12] border border-[#F2B34B]/30 text-[10px] font-mono font-medium text-[var(--warn)] uppercase">
                    <span className="size-1.5 rounded-full bg-[var(--warn)] animate-ping" />
                    CONNECTING
                  </span>
                ) : tsLoading || tsConnecting ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono font-medium text-[var(--text-2)] uppercase">
                    <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span>
                    AUTH
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--r-full)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono font-medium text-[var(--text-3)] uppercase">
                    STANDBY
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Tailscale Funnel Mesh</h3>
              <p className="text-xs text-[var(--text-2)] mb-3 leading-relaxed">
                Connect your mesh devices via Tailscale private network without public internet exposure.
              </p>
            </div>

            <div className="pt-2 border-t border-[var(--line)]">
              {tsEnabled && !tsLoading && tsReachable ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={`${tsUrl}/v1`}
                    readOnly
                    inputClassName="font-mono text-xs text-[var(--text)] u-tnum"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                    className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[var(--text)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                    title={copied === "ts_url" ? "Copied" : "Copy URL"}
                  >
                    <span className={`material-symbols-outlined text-[16px] ${copied === "ts_url" ? "text-[var(--pos)]" : ""}`}>
                      {copied === "ts_url" ? "check" : "content_copy"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDisableTsModal(true)}
                    className="size-8 rounded-[var(--r1)] border border-[#FF6B6B]/30 bg-[#281515] hover:bg-[#381a1a] text-[#FF6B6B] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop Tailscale"
                  >
                    <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
                  </button>
                </div>
              ) : tsEnabled && !tsLoading && !tsReachable ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--r1)] border border-[#F2B34B]/30 bg-[#261F12] text-xs font-mono text-[var(--warn)]">
                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    <span className="truncate">{tsEverReachable ? "Reconnecting mesh..." : "Checking mesh..."}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDisableTsModal(true)}
                    className="size-8 rounded-[var(--r1)] border border-[#FF6B6B]/30 bg-[#281515] text-[#FF6B6B] flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop"
                  >
                    <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
                  </button>
                </div>
              ) : tsLoading || tsConnecting ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] text-xs font-mono text-[var(--text-3)]">
                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    <span className="truncate">{tsProgress || "Connecting mesh..."}</span>
                  </div>
                  {tsAuthUrl && (
                    <Button
                      size="sm"
                      icon="open_in_new"
                      onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                    >
                      {tsAuthLabel || "Auth"}
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                    className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[#FF6B6B] flex items-center justify-center shrink-0 cursor-pointer"
                    title="Stop"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon="vpn_lock"
                  fullWidth
                  onClick={() => {
                    if (isLoginUnsafe) {
                      setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                      return;
                    }
                    handleOpenTsModal();
                  }}
                >
                  Activate Tailscale
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Status Alerts if any */}
        {(tunnelStatus?.message || tsStatus?.message) && (
          <div className="flex flex-col gap-2">
            {tunnelStatus?.message && <StatusAlert status={tunnelStatus} />}
            {tsStatus?.message && <StatusAlert status={tsStatus} />}
          </div>
        )}
      </div>

      {/* 2. Security & Policy Control Bar (Substrate Bay) */}
      <div className="p-4 sm:p-5 rounded-[var(--r3)] bg-[var(--surface-inset)] border border-[var(--line)] shadow-[var(--shadow-card)] flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[var(--text-3)]">shield</span>
          <h3 className="text-xs font-mono font-medium text-[var(--text-2)] uppercase tracking-wider">
            Ingress Policies & Access Control
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3.5 rounded-[var(--r2)] bg-[var(--surface)] border border-[var(--line)]">
            <div className="flex flex-col gap-0.5 pr-3">
              <span className="text-xs font-semibold text-[var(--text)] tracking-tight">Require API Key</span>
              <span className="text-[11px] text-[var(--text-3)] leading-relaxed">
                Rejects incoming requests without valid Authorization header
              </span>
            </div>
            <Toggle
              checked={requireApiKey}
              onChange={() => handleRequireApiKey(!requireApiKey)}
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-[var(--r2)] bg-[var(--surface)] border border-[var(--line)]">
            <div className="flex flex-col gap-0.5 pr-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[var(--text)] tracking-tight">Tunnel Dashboard Access</span>
                <Tooltip text="When enabled, the dashboard UI is reachable through public tunnel or Tailscale URL (login required)." />
              </div>
              <span className="text-[11px] text-[var(--text-3)] leading-relaxed">
                Allow dashboard web UI over WAN tunnel or Tailscale
              </span>
            </div>
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
          </div>
        </div>

        {/* Security warnings */}
        {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
          <SecurityWarning
            message={unsafeReason}
            action={{ label: "Open Profile Settings", href: "/dashboard/profile" }}
          />
        )}
        {(tunnelEnabled || tsEnabled) && !requireApiKey && (
          <SecurityWarning
            message="Require API key is currently disabled — your endpoint is publicly accessible without authentication."
          />
        )}
        {isRemoteHost && !requireApiKey && (
          <SecurityWarning message="Remote host detected: Endpoint is currently exposed without an API key." />
        )}
      </div>

      {/* 3. API Key Vault (Modular Hardware Key Bay) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[var(--text-3)]">vpn_key</span>
            <h2 className="text-sm sm:text-base font-semibold tracking-tight text-[var(--text)]">API Key Vault</h2>
            <span className="px-2 py-0.5 rounded-[var(--r-full)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] font-mono text-[var(--text-2)] uppercase u-tnum">
              {keys.length} Keys
            </span>
          </div>
          <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        {keys.length === 0 ? (
          <div className="p-8 text-center rounded-[var(--r3)] bg-[var(--surface)] border border-dashed border-[var(--line-2)] flex flex-col items-center gap-3">
            <div className="size-10 rounded-[var(--r2)] bg-[var(--surface-2)] border border-[var(--line-2)] flex items-center justify-center text-[var(--text-3)]">
              <span className="material-symbols-outlined text-[22px]">vpn_key</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">No API keys created</p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">Provision an API key to authorize your client requests</p>
            </div>
            <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {keys.map((key) => {
              const isCopied = copied === key.id;
              const isPaused = key.isActive === false;
              return (
                <div
                  key={key.id}
                  className={`p-4 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] flex flex-col justify-between gap-3 transition-colors ${
                    isPaused ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm text-[var(--text)] tracking-tight truncate" title={key.name}>
                        {key.name}
                      </span>
                      {isPaused ? (
                        <span className="text-[10px] font-mono font-medium px-2 py-0.2 rounded-[var(--r-full)] bg-[#261F12] text-[#F2B34B] border border-[#F2B34B]/30 uppercase">
                          Paused
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-medium px-2 py-0.2 rounded-[var(--r-full)] bg-[#14251D] text-[#34D39A] border border-[#34D39A]/30 uppercase">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Toggle
                        size="sm"
                        checked={!isPaused}
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
                        className="size-7 rounded-[var(--r1)] hover:bg-[#281515] text-[var(--text-3)] hover:text-[#FF6B6B] transition-colors flex items-center justify-center cursor-pointer"
                        title="Delete Key"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Copyfield with masked preview & actions */}
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] font-mono text-xs">
                    <code className="text-[var(--text)] u-tnum select-all truncate max-w-[220px] sm:max-w-none">
                      {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                    </code>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleKeyVisibility(key.id)}
                        className="p-1 text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
                        title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => copy(key.key, key.id)}
                        className="p-1 text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
                        title={isCopied ? "Copied" : "Copy key"}
                      >
                        <span className={`material-symbols-outlined text-[15px] ${isCopied ? "text-[var(--pos)]" : ""}`}>
                          {isCopied ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-3)] pt-1 border-t border-[var(--line)]">
                    <span>Provisioned</span>
                    <span className="u-tnum">{new Date(key.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
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
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local 9Router to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
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
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
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
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
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
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

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


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};
