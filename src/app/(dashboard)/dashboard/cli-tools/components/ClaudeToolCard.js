"use client";
import Icon from "@/shared/components/Icon";
import styles from "../cli-tools.module.css";

import { useState, useEffect, useRef } from "react";
import { Button, ModelSelectModal, ManualConfigModal, Tooltip } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import FieldGroup from "./ui/FieldGroup";
import FieldRow from "./ui/FieldRow";
import ActionBar from "./ui/ActionBar";


// Auto-compact window presets (CLAUDE_CODE_AUTO_COMPACT_WINDOW, valid 100K–1M).
// UI shows the round number; the value written is nudged down 2K to stay safely
// under the upstream hard cap.
const CONTEXT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "200K", value: "198000" },
  { label: "300K", value: "298000" },
  { label: "500K", value: "498000" },
  { label: "700K", value: "698000" },
];

// Claude Code assumes a model's window is 200K unless the name carries the `[1m]`
// marker, which is why the 1M auto-compact preset only takes effect once the
// marker is applied.

export default function ClaudeToolCard({
  tool,
  activeProviders,
  modelMappings,
  onModelMappingChange,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [claudeStatus, setClaudeStatus] = useState(initialStatus || null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [ccFilterNaming, setCcFilterNaming] = useState(false);
  const [exaMcpEnabled, setExaMcpEnabled] = useState(false);
  const [autoCompactWindow, setAutoCompactWindow] = useState("");
  const [oneMContext, setOneMContext] = useState(false);
  const hasInitializedModels = useRef(false);

  // Claude Code only string-matches the marker against the model name, so it
  // applies to any id — the user decides which models are worth declaring as 1M.
  // Stripping first keeps repeated toggles from stacking `[1m][1m]`.
  const withContextMarker = (value, enabled) => {
    const { model } = stripModelContextMarker(value);
    return enabled ? `${model}[1m]` : model;
  };

  // Rewrite the mappings in place on toggle, so the inputs show what will be
  // written without waiting for Apply.
  const handleOneMContextToggle = (enabled) => {
    setOneMContext(enabled);
    tool.defaultModels.forEach((model) => {
      const current = modelMappings[model.alias];
      if (current) onModelMappingChange(model.alias, withContextMarker(current, enabled));
    });
  };

  const currentBaseUrl = claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL || "";

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) {
      setClaudeStatus(initialStatus);
      setExaMcpEnabled(!!initialStatus.exaMcpEnabled);
    }
  }, [initialStatus]);

  useEffect(() => {
    const v = claudeStatus?.settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    setAutoCompactWindow(v || "");
  }, [claudeStatus?.settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW]);

  useEffect(() => {
    const env = claudeStatus?.settings?.env;
    if (!env) return;
    setOneMContext(tool.defaultModels.some((model) => env[model.envKey]?.endsWith("[1m]")));
  }, [claudeStatus?.settings?.env, tool.defaultModels]);

  useEffect(() => {
    if (!claudeStatus) checkClaudeStatus();
    fetchModelAliases();
  }, []);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setCcFilterNaming(!!data.ccFilterNaming);
    }).catch(() => {});
  }, []);

  const handleCcFilterNamingToggle = async (e) => {
    const value = e.target.checked;
    setCcFilterNaming(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccFilterNaming: value }),
    }).catch(() => {});
  };

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
    if (claudeStatus?.installed && !hasInitializedModels.current) {
      hasInitializedModels.current = true;
      const env = claudeStatus.settings?.env || {};

      tool.defaultModels.forEach((model) => {
        if (model.envKey) {
          // Kept verbatim (marker included) so the input matches what is on disk;
          // withContextMarker strips before appending, so re-applying cannot double it.
          const value = env[model.envKey] || model.defaultValue || "";
          // Only sync initial values from file once
          if (value) {
            onModelMappingChange(model.alias, value);
          }
        }
      });
      // Restore key from settings.json; ApiKeySelect matches it against saved presets
      const tokenFromFile = env.ANTHROPIC_AUTH_TOKEN;
      if (tokenFromFile) {
        setSelectedApiKey(tokenFromFile);
      }
    }
  }, [claudeStatus, apiKeys, tool.defaultModels, onModelMappingChange]);

  const checkClaudeStatus = async () => {
    setCheckingClaude(true);
    try {
      const res = await fetch("/api/cli-tools/claude-settings");
      const data = await res.json();
      setClaudeStatus(data);
      setExaMcpEnabled(!!data.exaMcpEnabled);
    } catch (error) {
      setClaudeStatus({ installed: false, error: error.message });
    } finally {
      setCheckingClaude(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl() };

      // Get key from dropdown, fallback to first key or sk_jrouter for localhost
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_jrouter" : null);

      if (keyToUse) {
        env.ANTHROPIC_AUTH_TOKEN = keyToUse;
      }

      tool.defaultModels.forEach((model) => {
        const targetModel = modelMappings[model.alias];
        // Written verbatim — the input may hold a marker typed by hand, and the
        // toggle already decided the marker when it was flipped.
        if (targetModel && model.envKey) env[model.envKey] = targetModel;
      });
      if (autoCompactWindow) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
      }
      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, exaMcpEnabled, autoCompactWindow }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied successfully!" });
        setClaudeStatus(prev => ({ ...prev, hasBackup: true, settings: { ...prev?.settings, env }, exaMcpEnabled }));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        tool.defaultModels.forEach((model) => onModelMappingChange(model.alias, model.defaultValue || ""));
        setSelectedApiKey("");
        setExaMcpEnabled(false);
        setAutoCompactWindow("");
        setOneMContext(false);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) onModelMappingChange(currentEditingAlias, model.value);
  };

  // Generate settings.json content for manual copy
  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_jrouter" : "<API_KEY_FROM_DASHBOARD>");
    const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl(), ANTHROPIC_AUTH_TOKEN: keyToUse };
    tool.defaultModels.forEach((model) => {
      const targetModel = modelMappings[model.alias];
      if (targetModel && model.envKey) env[model.envKey] = targetModel;
    });
    if (autoCompactWindow) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
    }

    return [
      {
        filename: "~/.claude/settings.json",
        content: JSON.stringify({ hasCompletedOnboarding: true, env }, null, 2),
      },
    ];
  };

  return (
    <div className={styles.panelBody}>
      {checkingClaude && (
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="animate-spin">progress_activity</Icon>
          <span>Checking Claude CLI...</span>
        </div>
      )}

      {!checkingClaude && claudeStatus && !claudeStatus.installed && (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
            <div className="flex items-start gap-3">
              <Icon className="text-[var(--warn)]">warning</Icon>
              <div className="flex-1">
                <p className="font-medium text-[var(--warn)]">Claude CLI not detected locally</p>
                <p className="text-sm text-text-muted">Manual configuration is still available if JRouter is deployed on a remote server.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pl-9">
              <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)}>
                <Icon className="text-[18px] mr-1">content_copy</Icon>
                Manual Config
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                <Icon className="text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</Icon>
                {showInstallGuide ? "Hide" : "How to Install"}
              </Button>
            </div>
          </div>
          {showInstallGuide && (
            <div className="p-4 bg-surface border border-border rounded-lg">
              <h4 className="font-medium mb-3">Installation Guide</h4>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                  <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @anthropic-ai/claude-code</code>
                </div>
                <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">claude</code> to verify.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!checkingClaude && claudeStatus?.installed && (
        <>
          <FieldGroup title="Endpoint">
            <FieldRow label="Select Endpoint">
              <BaseUrlSelect
                value={customBaseUrl || getDisplayUrl()}
                onChange={setCustomBaseUrl}
                requiresExternalUrl={tool.requiresExternalUrl}
                tunnelEnabled={tunnelEnabled}
                tunnelPublicUrl={tunnelPublicUrl}
                tailscaleEnabled={tailscaleEnabled}
                tailscaleUrl={tailscaleUrl}
                currentUrl={currentBaseUrl}
              />
            </FieldRow>
            {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{claudeStatus.settings.env.ANTHROPIC_BASE_URL}</span>
              </FieldRow>
            )}
          </FieldGroup>

          <FieldGroup title="Credentials">
            <FieldRow label="API Key">
              <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
            </FieldRow>
          </FieldGroup>

          <FieldGroup title="Models">
            {tool.defaultModels.map((model) => (
              <FieldRow
                key={model.alias}
                label={model.name}
                aside={(
                  <button onClick={() => openModelSelector(model.alias)} disabled={!hasActiveProviders} className={`rounded border px-2.5 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}>Select</button>
                )}
              >
                <div className="relative w-full min-w-0">
                  <input type="text" value={modelMappings[model.alias] || ""} onChange={(e) => onModelMappingChange(model.alias, e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                  {modelMappings[model.alias] && <button onClick={() => onModelMappingChange(model.alias, "")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
                </div>
              </FieldRow>
            ))}
            <FieldRow label="Auto-compact">
              <select value={autoCompactWindow} onChange={(e) => setAutoCompactWindow(e.target.value)} className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5">
                {CONTEXT_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FieldRow>
          </FieldGroup>

          <FieldGroup title="Options">
            <FieldRow label="1M context">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={oneMContext} onChange={(e) => handleOneMContextToggle(e.target.checked)} className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0" />
                <span className="text-xs text-text-muted">Append [1m] to the model name</span>
                <Tooltip text="Claude Code otherwise assumes a 200K window, which clamps the auto-compact window above. Applied to every mapped model — only enable it for models that really accept 1M.">
                  <Icon className="text-text-muted text-[14px] cursor-help">info</Icon>
                </Tooltip>
              </label>
            </FieldRow>
            <FieldRow label="Filter naming">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={ccFilterNaming} onChange={handleCcFilterNamingToggle} className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0" />
                <span className="text-xs text-text-muted">Filter naming requests</span>
                <Tooltip text="Intercepts Claude Code's topic-naming requests and returns a fake response locally, saving API tokens.">
                  <Icon className="text-text-muted text-[14px] cursor-help">info</Icon>
                </Tooltip>
              </label>
            </FieldRow>
            <FieldRow label="Web Search">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={exaMcpEnabled} onChange={(e) => setExaMcpEnabled(e.target.checked)} className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0" />
                <span className="text-xs text-text-muted">Exa MCP</span>
                <Tooltip text="Injects Exa MCP into ~/.claude.json so non-Claude models gain web search. Restart Claude Code after Apply.">
                  <Icon className="text-text-muted text-[14px] cursor-help">info</Icon>
                </Tooltip>
              </label>
            </FieldRow>
          </FieldGroup>

          <ActionBar
            message={message?.text}
            tone={message ? (message.type === "success" ? "success" : "danger") : "neutral"}
            busy={applying || restoring}
          >
            <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)}>
              <Icon className="text-[14px] mr-1">content_copy</Icon>Manual Config
            </Button>
            <Button variant="secondary" size="sm" onClick={handleResetSettings} disabled={!claudeStatus?.hasJRouter} loading={restoring}>
              <Icon className="text-[14px] mr-1">restore</Icon>Reset
            </Button>
            <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!hasActiveProviders} loading={applying}>
              <Icon className="text-[14px] mr-1">save</Icon>Apply
            </Button>
          </ActionBar>
        </>
      )}

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null} activeProviders={activeProviders} modelAliases={modelAliases} title={`Select model for ${currentEditingAlias}`} />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </div>
  );
}
