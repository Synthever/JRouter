"use client";
import Icon from "@/shared/components/Icon";
import styles from "../cli-tools.module.css";

import { useState, useEffect, useRef } from "react";
import { Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import FieldGroup from "./ui/FieldGroup";
import FieldRow from "./ui/FieldRow";
import ActionBar from "./ui/ActionBar";

const ENDPOINT = "/api/cli-tools/deepseek-tui-settings";

export default function DeepSeekTuiToolCard({
  tool,
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
  const [deepseekStatus, setDeepseekStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const currentBaseUrl = deepseekStatus?.settings?.["providers.openai"]?.base_url || "";

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setDeepseekStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!deepseekStatus) checkStatus();
    fetchModelAliases();
  }, []);
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
    if (deepseekStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const openaiSection = deepseekStatus.settings?.["providers.openai"];
      if (openaiSection?.model) setSelectedModel(openaiSection.model);
    }
  }, [deepseekStatus]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setDeepseekStatus(data);
    } catch (error) {
      setDeepseekStatus({ installed: false, error: error.message });
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

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_jrouter" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        checkStatus();
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
    setSelectedModel(model.value);
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_jrouter" : "<API_KEY_FROM_DASHBOARD>");

    const tomlContent = `[providers.openai]
base_url = "${getEffectiveBaseUrl()}"
api_key = "${keyToUse}"
model = "${selectedModel || "provider/model-id"}"
`;

    return [
      { filename: "~/.deepseek/config.toml", content: tomlContent },
    ];
  };

  return (
    <div className={styles.panelBody}>
      {checking && (
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="animate-spin">progress_activity</Icon>
          <span>Checking DeepSeek TUI...</span>
        </div>
      )}

      {!checking && deepseekStatus && !deepseekStatus.installed && (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
            <div className="flex items-start gap-3">
              <Icon className="text-[var(--warn)]">warning</Icon>
              <div className="flex-1">
                <p className="font-medium text-[var(--warn)]">DeepSeek TUI not detected locally</p>
                <p className="text-sm text-text-muted mt-1">Install via npm:</p>
                <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">npm install -g deepseek-tui</code>
                <p className="text-sm text-text-muted mt-2">Manual configuration is still available if JRouter is deployed on a remote server.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pl-9">
              <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)}>
                <Icon className="text-[18px] mr-1">content_copy</Icon>
                Manual Config
              </Button>
            </div>
          </div>
        </div>
      )}

      {!checking && deepseekStatus?.installed && (
        <>
          {tool.notes && tool.notes.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {tool.notes.map((note, idx) => (
                <div key={idx} className={`flex items-start gap-2 p-2 rounded text-xs ${
                  note.type === "warning" ? styles.warning :
                  note.type === "error" ? styles.danger :
                  styles.neutral
                }`}>
                  <Icon className="text-[14px] mt-0.5">
                    {note.type === "warning" ? "warning" : note.type === "error" ? "error" : "info"}
                  </Icon>
                  <span>{note.text}</span>
                </div>
              ))}
            </div>
          )}

          <FieldGroup title="Endpoint">
            <FieldRow label="Select Endpoint">
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
            </FieldRow>
            {deepseekStatus?.settings?.["providers.openai"]?.base_url && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{deepseekStatus.settings["providers.openai"].base_url}</span>
              </FieldRow>
            )}
          </FieldGroup>

          <FieldGroup title="Credentials">
            <FieldRow label="API Key">
              <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
            </FieldRow>
          </FieldGroup>

          <FieldGroup title="Models">
            <FieldRow
              label="Default Model"
              aside={(
                <button onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}>Select</button>
              )}
            >
              <div className="relative w-full min-w-0">
                <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
              </div>
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
            <Button variant="secondary" size="sm" onClick={handleReset} disabled={!deepseekStatus?.hasJRouter} loading={restoring}>
              <Icon className="text-[14px] mr-1">restore</Icon>Reset
            </Button>
            <Button variant="primary" size="sm" onClick={handleApply} disabled={!selectedModel} loading={applying}>
              <Icon className="text-[14px] mr-1">save</Icon>Apply
            </Button>
          </ActionBar>
        </>
      )}

      {modalOpen && (
        <ModelSelectModal
          className={styles.modelPicker}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleModelSelect}
          selectedModel={selectedModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Model for DeepSeek TUI"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="DeepSeek TUI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </div>
  );
}
