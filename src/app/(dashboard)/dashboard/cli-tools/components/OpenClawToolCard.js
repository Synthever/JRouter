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

export default function OpenClawToolCard({
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
  const [openclawStatus, setOpenclawStatus] = useState(initialStatus || null);
  const [checkingOpenclaw, setCheckingOpenclaw] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentModels, setAgentModels] = useState({}); // { [agentId]: modelId }
  const [agentModalFor, setAgentModalFor] = useState(null); // agentId opening modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const currentBaseUrl = openclawStatus?.settings?.models?.providers?.["jrouter"]?.baseUrl || "";

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setOpenclawStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!openclawStatus) checkOpenclawStatus();
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
    if (openclawStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = openclawStatus.settings?.models?.providers?.["jrouter"];
      if (provider) {
        const primaryModel = openclawStatus.settings?.agents?.defaults?.model?.primary;
        if (primaryModel) setSelectedModel(primaryModel.replace("jrouter/", ""));
        if (provider.apiKey && apiKeys?.some(k => k.key === provider.apiKey)) {
          setSelectedApiKey(provider.apiKey);
        }
      }
      // Init per-agent models from enriched agents list
      const agentList = openclawStatus.agents || [];
      const initAgentModels = {};
      agentList.forEach((agent) => {
        if (agent.currentModel) initAgentModels[agent.id] = agent.currentModel;
      });
      setAgentModels(initAgentModels);
    }
  }, [openclawStatus, apiKeys]);

  const checkOpenclawStatus = async () => {
    setCheckingOpenclaw(true);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings");
      const data = await res.json();
      setOpenclawStatus(data);
    } catch (error) {
      setOpenclawStatus({ installed: false, error: error.message });
    } finally {
      setCheckingOpenclaw(false);
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

      const res = await fetch("/api/cli-tools/openclaw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          agentModels,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkOpenclawStatus();
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
      const res = await fetch("/api/cli-tools/openclaw-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkOpenclawStatus();
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
    if (agentModalFor) {
      setAgentModels(prev => ({ ...prev, [agentModalFor]: model.value }));
      setAgentModalFor(null);
    } else {
      setSelectedModel(model.value);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_jrouter" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      agents: {
        defaults: {
          model: {
            primary: `jrouter/${selectedModel || "provider/model-id"}`,
          },
        },
      },
      models: {
        providers: {
          "jrouter": {
            baseUrl: getEffectiveBaseUrl(),
            apiKey: keyToUse,
            api: "openai-completions",
            models: [
              {
                id: selectedModel || "provider/model-id",
                name: (selectedModel || "provider/model-id").split("/").pop(),
              },
            ],
          },
        },
      },
    };

    return [
      {
        filename: "~/.openclaw/openclaw.json",
        content: JSON.stringify(settingsContent, null, 2),
      },
    ];
  };

  return (
    <div className={styles.panelBody}>
      {checkingOpenclaw && (
        <div className="flex items-center gap-2 text-text-muted">
          <Icon className="animate-spin">progress_activity</Icon>
          <span>Checking Open Claw CLI...</span>
        </div>
      )}

      {!checkingOpenclaw && openclawStatus && !openclawStatus.installed && (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
            <div className="flex items-start gap-3">
              <Icon className="text-[var(--warn)]">warning</Icon>
              <div className="flex-1">
                <p className="font-medium text-[var(--warn)]">Open Claw CLI not detected locally</p>
                <p className="text-sm text-text-muted">Manual configuration is still available if JRouter is deployed on a remote server.</p>
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

      {!checkingOpenclaw && openclawStatus?.installed && (
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
            {openclawStatus?.settings?.models?.providers?.["jrouter"]?.baseUrl && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{openclawStatus.settings.models.providers["jrouter"].baseUrl}</span>
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
                <button onClick={() => { setAgentModalFor(null); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}>Select</button>
              )}
            >
              <div className="relative w-full min-w-0">
                <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
              </div>
            </FieldRow>
            {(openclawStatus.agents || []).filter(a => a.agentDir).map((agent) => (
              <FieldRow
                key={agent.id}
                label={<span title={agent.name || agent.id}>Agent {agent.name || agent.id}</span>}
                aside={(
                  <button onClick={() => { setAgentModalFor(agent.id); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer" : "opacity-50 cursor-not-allowed border-border"} ${styles.selectButton}`}>Select</button>
                )}
              >
                <div className="relative w-full min-w-0">
                  <input
                    type="text"
                    value={agentModels[agent.id] || ""}
                    onChange={(e) => setAgentModels(prev => ({ ...prev, [agent.id]: e.target.value }))}
                    placeholder={`default (${selectedModel || "provider/model-id"})`}
                    className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  {agentModels[agent.id] && <button onClick={() => setAgentModels(prev => ({ ...prev, [agent.id]: "" }))} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors" title="Clear"><Icon className="text-[14px]">close</Icon></button>}
                </div>
              </FieldRow>
            ))}
          </FieldGroup>

          <ActionBar
            message={message?.text}
            tone={message ? (message.type === "success" ? "success" : "danger") : "neutral"}
            busy={applying || restoring}
          >
            <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)}>
              <Icon className="text-[14px] mr-1">content_copy</Icon>Manual Config
            </Button>
            <Button variant="secondary" size="sm" onClick={handleResetSettings} disabled={!openclawStatus?.hasJRouter} loading={restoring}>
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
          title="Select Model for Open Claw"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Open Claw - Manual Configuration"
        configs={getManualConfigs()}
      />
    </div>
  );
}
