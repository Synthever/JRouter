"use client";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import styles from "../cli-tools.module.css";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint, readPresets } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { CLI_TOOLS } from "@/shared/constants/cliTools";

const ENDPOINT = "/api/cli-tools/hermes-settings";
const HERMES_ROLES = CLI_TOOLS.hermes?.roles || [];

export default function HermesToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [hermesStatus, setHermesStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [roleModels, setRoleModels] = useState({});
  const [modalTarget, setModalTarget] = useState("default");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState("default");
  const [applyingAll, setApplyingAll] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState("");
  const hasInitializedModel = useRef(false);

  const currentBaseUrl = hermesStatus?.settings?.model?.base_url || "";

  const getConfigStatus = () => {
    if (!hermesStatus?.installed) return null;
    const cfg = hermesStatus.settings?.model;
    if (!cfg?.base_url) return "not_configured";
    if (matchKnownEndpoint(cfg.base_url, { tunnelPublicUrl, tailscaleUrl })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  // Same three-state rule as the header badge, evaluated per profile from the list payload.
  const profileStatus = (p) => {
    if (p.has9Router || (p.baseUrl && matchKnownEndpoint(p.baseUrl, { tunnelPublicUrl, tailscaleUrl }))) return "configured";
    if (p.baseUrl) return "other";
    return "not_configured";
  };

  const STATUS_DOT = {
    configured: "bg-[var(--pos)]",
    other: "bg-[var(--text-2)]",
    not_configured: "bg-[var(--warn)]",
  };
  const STATUS_LABEL = {
    configured: "Connected",
    other: "Other endpoint",
    not_configured: "Not configured",
  };

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setHermesStatus(initialStatus);
  }, [initialStatus]);

  const fetchProfiles = async () => {
    try {
      const res = await fetch("/api/cli-tools/hermes-profiles");
      const data = await res.json();
      if (res.ok) setProfiles(data.profiles || []);
    } catch (error) {
      console.log("Error fetching hermes profiles:", error);
    }
  };

  useEffect(() => {
    if (isExpanded) {
      if (!hermesStatus) checkStatus();
      fetchModelAliases();
      fetchProfiles();
    }
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    if (hermesStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const cfg = hermesStatus.settings?.model;
      // Always reset both: stale values from the previously selected profile must not leak in.
      setSelectedModel(cfg?.default || "");
      const initial = {};
      if (hermesStatus.settings?.delegation?.model) initial.delegation = hermesStatus.settings.delegation.model;
      for (const [role, rcfg] of Object.entries(hermesStatus.settings?.auxiliary || {})) {
        if (rcfg?.model) initial[role] = rcfg.model;
      }
      setRoleModels(initial);
    }
  }, [hermesStatus]);

  const selectProfile = (name) => {
    if (name === activeProfile) return;
    setActiveProfile(name);
    hasInitializedModel.current = false;
    setMessage(null);
    setCustomBaseUrl("");
    checkStatus(name);
  };

  const copyCommand = async (cmd) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCommand(cmd);
      setTimeout(() => setCopiedCommand(""), 2000);
    } catch (error) {
      console.log("Copy failed", error);
    }
  };

  const checkStatus = async (profile = activeProfile) => {
    setChecking(true);
    try {
      const res = await fetch(`${ENDPOINT}?profile=${encodeURIComponent(profile)}`);
      const data = await res.json();
      if (res.ok) {
        setHermesStatus(data);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load Hermes settings" });
        if (res.status === 404 && profile !== "default") {
          fetchProfiles();
          setActiveProfile("default");
          hasInitializedModel.current = false;
          await checkStatus("default");
        }
      }
    } catch (error) {
      setHermesStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const normalizeLocalhost = (url) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") {
      return normalizeLocalhost(window.location.origin);
    }
    return "http://127.0.0.1:20128";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getKeyToUse = () =>
    selectedApiKey?.trim()
      || (apiKeys?.length > 0 ? apiKeys[0].key : null)
      || (!cloudEnabled ? "sk_9router" : null);

  const profileLabel = (name) => (name === "default" ? "default profile" : `profile "${name}"`);

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: activeProfile,
          baseUrl: getEffectiveBaseUrl(),
          apiKey: getKeyToUse(),
          selections: [
            { role: "default", model: selectedModel },
            ...Object.entries(roleModels)
              .filter(([, model]) => model?.trim())
              .map(([role, model]) => ({ role, model: model.trim() })),
          ],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: `Settings applied to ${profileLabel(activeProfile)}!` });
        checkStatus();
        fetchProfiles();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  // Keep per-profile models and reject foreign endpoints for bulk updates.
  const handleApplyAll = async () => {
    const endpoint = getEffectiveBaseUrl();
    const isKnown =
      matchKnownEndpoint(endpoint, { tunnelPublicUrl, tailscaleUrl })
      || readPresets().some((p) => (p.baseUrl || "").replace(/\/+$/, "") === endpoint.replace(/\/+$/, ""));
    if (!isKnown) {
      setMessage({
        type: "error",
        text: `"${endpoint}" is not a 9router endpoint. Select the local, tunnel, Tailscale or a saved 9router endpoint before applying to all profiles.`,
      });
      return;
    }

    setApplyingAll(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applyToAll: true,
          baseUrl: endpoint,
          apiKey: getKeyToUse(),
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (res.ok && data.bulk) {
        rememberEndpoint(endpoint, { tunnelPublicUrl, tailscaleUrl });
        const skipped = (data.results || []).filter((r) => r.status !== "updated");
        if (skipped.length === 0) {
          setMessage({ type: "success", text: `Endpoint and API key applied to ${data.updated} profile(s).` });
        } else {
          const detail = skipped.map((r) => `${r.profile} — ${r.reason || r.status}`).join("; ");
          setMessage({
            type: data.updated > 0 ? "success" : "error",
            text: `Updated ${data.updated} profile(s), skipped ${skipped.length}: ${detail}`,
          });
        }
        fetchProfiles();
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplyingAll(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: activeProfile }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Settings reset for ${profileLabel(activeProfile)}!` });
        setSelectedModel("");
        setRoleModels({});
        checkStatus();
        fetchProfiles();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model) => {
    if (modalTarget === "default") {
      setSelectedModel(model.value);
    } else {
      setRoleModels((prev) => ({ ...prev, [modalTarget]: model.value }));
    }
    setModalOpen(false);
  };

  const openModelModal = (target) => {
    setModalTarget(target);
    setModalOpen(true);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const base = getEffectiveBaseUrl();
    const homeDir = activeProfile === "default" ? "~/.hermes" : `~/.hermes/profiles/${activeProfile}`;
    const runHint = profiles.find((p) => p.name === activeProfile)?.command || "hermes";
    let yamlContent = `# Run this profile: ${runHint}\nmodel:\n  default: "${selectedModel || "provider/model-id"}"\n  provider: "custom"\n  base_url: "${base}"\n  api_key: \${OPENAI_API_KEY}\n`;
    if (roleModels.delegation?.trim()) {
      yamlContent += `delegation:\n  model: "${roleModels.delegation.trim()}"\n  provider: "custom"\n  base_url: "${base}"\n  api_key: \${OPENAI_API_KEY}\n`;
    }
    const auxRoles = Object.entries(roleModels).filter(([role, model]) => role !== "delegation" && model?.trim());
    if (auxRoles.length > 0) {
      yamlContent += `auxiliary:\n${auxRoles.map(([role, model]) =>
        `  ${role}:\n    provider: "custom"\n    model: "${model.trim()}"\n    base_url: "${base}"\n    api_key: \${OPENAI_API_KEY}\n`
      ).join("")}`;
    }
    const envContent = `OPENAI_API_KEY=${keyToUse}\n`;

    return [
      { filename: `${homeDir}/config.yaml`, content: yamlContent },
      { filename: `${homeDir}/.env`, content: envContent },
    ];
  };

  return (
    <Card padding="none" className={styles.panel}>
      <div className={styles.panelHeader} onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/hermes.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <StatusBadge variant="success" className={styles.status}>Connected</StatusBadge>}
              {configStatus === "not_configured" && <StatusBadge variant="warning" className={styles.status}>Not configured</StatusBadge>}
              {configStatus === "other" && <StatusBadge variant="default" dot={false} className={styles.status}>Other</StatusBadge>}
              {activeProfile !== "default" && (
                <StatusBadge variant="default" dot={false} className={`${styles.status} font-mono`} title="Hermes profile shown below">{activeProfile}</StatusBadge>
              )}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <Icon className={`text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</Icon>
      </div>

      {isExpanded && (
        <div className={styles.body}>
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <Icon className="animate-spin">progress_activity</Icon>
              <span>Checking Hermes Agent...</span>
            </div>
          )}

          {!checking && hermesStatus && !hermesStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
                <div className="flex items-start gap-3">
                  <Icon className="text-[var(--warn)]">warning</Icon>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--warn)]">Hermes Agent not detected locally</p>
                    <p className="text-sm text-text-muted">Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pl-0 sm:pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                    <Icon className="text-[18px] mr-1">content_copy</Icon>
                    Manual Config
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!checking && hermesStatus?.installed && (
            <>
              {profiles.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`${styles.fieldLabel} mr-1`}>Profile</span>
                    {profiles.map((p) => {
                      const active = p.name === activeProfile;
                      const status = profileStatus(p);
                      return (
                        <button
                          key={p.name}
                          onClick={() => selectProfile(p.name)}
                          aria-pressed={active}
                          title={p.isDefault ? `Default profile: ${STATUS_LABEL[status]}` : `${p.command}: ${STATUS_LABEL[status]}`}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${styles.selectButton} ${
                            active
                              ? "border-[var(--accent-line)] bg-surface-2 text-text-main cursor-pointer"
                              : "bg-surface border-border text-text-muted hover:text-text-main hover:border-border-hover cursor-pointer"
                          }`}
                        >
                          <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
                          <span className="font-medium">{p.displayName || p.name}</span>
                          {p.displayName && !p.isDefault && <span className="font-mono text-[10px] opacity-60">{p.name}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Icon className="text-[14px] shrink-0">terminal</Icon>
                    <code className="px-1.5 py-0.5 bg-surface/60 rounded font-mono text-[11px]">
                      {profiles.find((p) => p.name === activeProfile)?.command || "hermes"}
                    </code>
                    <button
                      onClick={() => copyCommand(profiles.find((p) => p.name === activeProfile)?.command || "hermes")}
                      className={`p-0.5 rounded transition-colors ${
                        copiedCommand === (profiles.find((p) => p.name === activeProfile)?.command || "hermes")
                          ? "text-[var(--pos)]"
                          : "text-text-muted hover:text-text-main"
                      }`}
                      title="Copy command"
                    >
                      <Icon className="text-[14px]">
                        {copiedCommand === (profiles.find((p) => p.name === activeProfile)?.command || "hermes") ? "check" : "content_copy"}
                      </Icon>
                    </button>
                    <span className="hidden sm:inline">Every profile runs as its own agent with its own model.</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className={`sm:text-right ${styles.fieldLabel}`}>Select Endpoint</span>
                  <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
                  <BaseUrlSelect
                    value={customBaseUrl || getEffectiveBaseUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    currentUrl={currentBaseUrl}
                  />
                </div>

                {hermesStatus?.settings?.model?.base_url && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className={`sm:text-right ${styles.fieldLabel}`}>Current</span>
                    <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {hermesStatus.settings.model.base_url}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className={`sm:text-right ${styles.fieldLabel}`}>API Key</span>
                  <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className={`sm:text-right ${styles.fieldLabel}`}>Default Model</span>
                  <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                    {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
                  </div>
                  <button onClick={() => openModelModal("default")} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}>Select</button>
                </div>

                <details className="group">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-text-main hover:text-text-main transition-colors">
                    <Icon className="align-middle text-[16px] text-text-muted group-open:rotate-90 transition-transform">chevron_right</Icon>
                    Model Roles (optional)
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {HERMES_ROLES.map((role) => (
                      <div key={role.id} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                        <span className={`truncate sm:text-right ${styles.fieldLabel}`} title={role.label}>{role.label}</span>
                        <Icon className="hidden text-text-muted text-[14px] sm:inline">arrow_forward</Icon>
                        <div className="relative w-full min-w-0">
                          <input
                            type="text"
                            value={roleModels[role.id] || ""}
                            onChange={(e) => setRoleModels((prev) => ({ ...prev, [role.id]: e.target.value }))}
                            placeholder="inherit default"
                            className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                          />
                          {roleModels[role.id] && (
                            <button
                              onClick={() => setRoleModels((prev) => ({ ...prev, [role.id]: "" }))}
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors"
                              title="Clear"
                            >
                              <Icon className="text-[14px]">close</Icon>
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => openModelModal(role.id)}
                          disabled={!hasActiveProviders}
                          className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}
                        >
                          Select
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-text-muted">Empty roles inherit the default model.</p>
                  </div>
                </details>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? styles.positive : styles.danger}`}>
                  <Icon className="text-[14px]">{message.type === "success" ? "check_circle" : "error"}</Icon>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={!selectedModel} loading={applying} className="w-full sm:w-auto">
                  <Icon className="text-[14px] mr-1">save</Icon>Apply
                </Button>
                {profiles.length > 1 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleApplyAll}
                    loading={applyingAll}
                    title="Set the endpoint and API key on every profile that routes through 9router. Each profile keeps its own model."
                    className="w-full sm:w-auto"
                  >
                    <Icon className="text-[14px] mr-1">groups</Icon>Apply to All Profiles
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!hermesStatus?.has9Router} loading={restoring} className="w-full sm:w-auto">
                  <Icon className="text-[14px] mr-1">restore</Icon>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                  <Icon className="text-[14px] mr-1">content_copy</Icon>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          className={styles.modelPicker}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleModelSelect}
          selectedModel={modalTarget === "default" ? selectedModel : roleModels[modalTarget] || ""}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Select Model for Hermes Agent${modalTarget !== "default" ? ` — ${HERMES_ROLES.find((r) => r.id === modalTarget)?.label || modalTarget}` : ""}`}
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Hermes Agent - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
