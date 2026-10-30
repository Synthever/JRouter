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

export default function DroidToolCard({
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
  const [droidStatus, setDroidStatus] = useState(initialStatus || null);
  const [checkingDroid, setCheckingDroid] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelList, setModelList] = useState([]);
  const [modelInput, setModelInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const currentBaseUrl = droidStatus?.settings?.customModels?.find((m) => m.id?.startsWith("custom:9Router"))?.baseUrl || "";

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setDroidStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!droidStatus) checkDroidStatus();
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

  // Pre-fill model list from existing config (supports multi-model)
  useEffect(() => {
    if (droidStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const existingModels = (droidStatus.settings?.customModels || [])
        .filter(m => m.id?.startsWith("custom:9Router"))
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(m => m.model);
      if (existingModels.length > 0) {
        setModelList(existingModels);
      } else {
        // Legacy: single model stored as custom:JRouter-0
        const legacy = droidStatus.settings?.customModels?.find(m => m.id === "custom:JRouter-0");
        if (legacy?.model) {
          setModelList([legacy.model]);
        }
      }
    }
  }, [droidStatus]);

  const checkDroidStatus = async () => {
    setCheckingDroid(true);
    try {
      const res = await fetch("/api/cli-tools/droid-settings");
      const data = await res.json();
      setDroidStatus(data);
    } catch (error) {
      setDroidStatus({ installed: false, error: error.message });
    } finally {
      setCheckingDroid(false);
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

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || modelList.includes(val)) return;
    setModelList((prev) => [...prev, val]);
    setModelInput("");
  };

  const removeModel = (id) => setModelList((prev) => prev.filter((m) => m !== id));

  const handleModelSelect = (model) => {
    if (!model.value || modelList.includes(model.value)) return;
    setModelList((prev) => [...prev, model.value]);
    setModalOpen(false);
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_jrouter" : null);

      const res = await fetch("/api/cli-tools/droid-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: modelList,
          activeModel: modelList[0] || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkDroidStatus();
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
      const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelList([]);
        checkDroidStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_jrouter" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      customModels: modelList.map((m, i) => ({
        model: m,
        id: `custom:JRouter-${i}`,
        index: i,
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      })),
    };

    const platform = typeof navigator !== "undefined" && navigator.platform;
    const isWindows = platform?.toLowerCase().includes("win");
    const settingsPath = isWindows
      ? "%USERPROFILE%\\.factory\\settings.json"
      : "~/.factory/settings.json";

    return [
      {
        filename: settingsPath,
        content: JSON.stringify(settingsContent, null, 2),
      },
    ];
  };

  return (
    <div className={styles.panelBody}>
      {checkingDroid && (
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="animate-spin">progress_activity</Icon>
          <span>Checking Factory Droid CLI...</span>
        </div>
      )}

      {!checkingDroid && droidStatus && !droidStatus.installed && (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
            <div className="flex items-start gap-3">
              <Icon className="text-[var(--warn)]">warning</Icon>
              <div className="flex-1">
                <p className="font-medium text-[var(--warn)]">Factory Droid CLI not detected locally</p>
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
                  <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">curl -fsSL https://app.factory.ai/cli | sh</code>
                </div>
                <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">droid</code> to verify.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!checkingDroid && droidStatus?.installed && (
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
            {droidStatus?.settings?.customModels?.find(m => m.id?.startsWith("custom:9Router"))?.baseUrl && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{droidStatus.settings.customModels.find(m => m.id?.startsWith("custom:9Router")).baseUrl}</span>
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
              label={(
                <>
                  Models {modelList.length > 0 && <span className="text-text-main">({modelList.length})</span>}
                </>
              )}
            >
              <div className="flex-1 flex flex-col gap-1">
                {/* Model list */}
                {modelList.length > 0 && (
                  <div className="flex flex-col gap-0.5 mb-1">
                    {modelList.map((id) => (
                      <div key={id} className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary rounded border border-border">
                        <span className="flex-1 text-xs font-mono truncate">{id}</span>
                        <button onClick={() => removeModel(id)} className="text-text-muted hover:text-[var(--danger)] transition-colors shrink-0" title="Remove">
                          <Icon className="text-[12px]">close</Icon>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Model input row */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
                    placeholder="provider/model-id"
                    className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  <button
                    onClick={() => setModalOpen(true)}
                    disabled={!hasActiveProviders}
                    className={`px-2 py-1.5 rounded border text-xs shrink-0 ${hasActiveProviders ? "bg-surface border-border hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}
                  >
                    Select
                  </button>
                  <button onClick={addModel} disabled={!modelInput.trim()} className="px-2 py-1.5 rounded border bg-surface border-border hover:border-[var(--text-2)] text-xs shrink-0 disabled:opacity-50" title="Add model">
                    <Icon className="text-[14px]">add</Icon>
                  </button>
                </div>
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
            <Button variant="secondary" size="sm" onClick={handleResetSettings} disabled={!droidStatus?.hasJRouter} loading={restoring}>
              <Icon className="text-[14px] mr-1">restore</Icon>Reset
            </Button>
            <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={modelList.length === 0} loading={applying}>
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
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Model for Factory Droid"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Factory Droid - Manual Configuration"
        configs={getManualConfigs()}
      />
    </div>
  );
}
