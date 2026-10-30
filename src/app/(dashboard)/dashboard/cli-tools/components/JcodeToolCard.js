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

export default function JcodeToolCard({
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
  const [jcodeStatus, setJcodeStatus] = useState(initialStatus || null);
  const [checkingJcode, setCheckingJcode] = useState(false);
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

  const currentBaseUrl = jcodeStatus?.config?.providers?.["jrouter"]?.base_url || "";

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setJcodeStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!jcodeStatus) checkJcodeStatus();
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
    if (jcodeStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = jcodeStatus.config?.providers?.["jrouter"];
      if (provider) {
        if (provider.default_model) {
          setSelectedModel(provider.default_model);
        }
        // Try to match API key from env file
        const envApiKey = jcodeStatus.envApiKey;
        if (envApiKey && apiKeys?.some(k => k.key === envApiKey)) {
          setSelectedApiKey(envApiKey);
        }
      }
    }
  }, [jcodeStatus, apiKeys]);

  const checkJcodeStatus = async () => {
    setCheckingJcode(true);
    try {
      const res = await fetch("/api/cli-tools/jcode-settings");
      const data = await res.json();
      setJcodeStatus(data);
    } catch (error) {
      setJcodeStatus({ installed: false, error: error.message });
    } finally {
      setCheckingJcode(false);
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

  const getDisplayUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_jrouter" : null);

      const res = await fetch("/api/cli-tools/jcode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModel ? [selectedModel] : [],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkJcodeStatus();
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
      const res = await fetch("/api/cli-tools/jcode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkJcodeStatus();
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

    const configToml = `[providers.jrouter]
type = "openai-compatible"
base_url = "${getEffectiveBaseUrl()}"
auth = "bearer"
api_key_env = "JCODE_9ROUTER_API_KEY"
env_file = "provider-jrouter.env"
default_model = "${selectedModel || "cc/claude-opus-4-7"}"
requires_api_key = true

[[providers.jrouter.models]]
id = "${selectedModel || "cc/claude-opus-4-7"}"`;

    const envContent = `JCODE_9ROUTER_API_KEY="${keyToUse}"`;

    return [
      {
        filename: "~/.jcode/config.toml",
        content: configToml,
      },
      {
        filename: "~/.config/jcode/provider-jrouter.env",
        content: envContent,
      },
    ];
  };

  return (
    <div className={styles.panelBody}>
      {checkingJcode && (
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="animate-spin">progress_activity</Icon>
          <span>Checking jcode CLI...</span>
        </div>
      )}

      {!checkingJcode && jcodeStatus && !jcodeStatus.installed && (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
            <div className="flex items-start gap-3">
              <Icon className="text-[var(--warn)]">warning</Icon>
              <div className="flex-1">
                <p className="font-medium text-[var(--warn)]">jcode CLI not detected locally</p>
                <p className="text-sm text-text-muted mt-1">Install jcode to enable automatic configuration:</p>
                <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">
                  curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.sh | bash
                </code>
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

      {!checkingJcode && jcodeStatus?.installed && (
        <>
          {tool.notes && tool.notes.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {tool.notes.map((note, idx) => (
                <div key={idx} className={`flex items-start gap-2 p-2 rounded text-xs ${
                  note.type === "info" ? styles.neutral :
                  note.type === "warning" ? styles.warning :
                  styles.neutral
                }`}>
                  <Icon className="text-[14px] mt-0.5">
                    {note.type === "info" ? "info" : note.type === "warning" ? "warning" : "help"}
                  </Icon>
                  <span>{note.text}</span>
                </div>
              ))}
            </div>
          )}

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
            {jcodeStatus?.config?.providers?.["jrouter"]?.base_url && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{jcodeStatus.config.providers["jrouter"].base_url}</span>
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
                <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="cc/claude-opus-4-7" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
              </div>
            </FieldRow>
          </FieldGroup>

          <div className={`flex flex-col gap-1 p-3 border ${styles.notice} ${styles.neutral}`}>
            <p className="text-xs font-medium text-text-muted">Usage:</p>
            <code className="text-xs font-mono text-text-muted">jcode --provider-profile jrouter</code>
            <code className="text-xs font-mono text-text-muted">jcode --provider-profile jrouter --model {selectedModel || "cc/claude-opus-4-7"}</code>
          </div>

          <ActionBar
            message={message?.text}
            tone={message ? (message.type === "success" ? "success" : "danger") : "neutral"}
            busy={applying || restoring}
          >
            <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)}>
              <Icon className="text-[14px] mr-1">content_copy</Icon>Manual Config
            </Button>
            <Button variant="secondary" size="sm" onClick={handleResetSettings} disabled={!jcodeStatus?.hasJRouter} loading={restoring}>
              <Icon className="text-[14px] mr-1">restore</Icon>Reset
            </Button>
            <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!selectedModel} loading={applying}>
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
          title="Select Model for jcode"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="jcode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </div>
  );
}
