"use client";
import Icon from "@/shared/components/Icon";
import styles from "../cli-tools.module.css";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import FieldGroup from "./ui/FieldGroup";
import FieldRow from "./ui/FieldRow";
import ActionBar from "./ui/ActionBar";

const ENDPOINT = "/api/cli-tools/grok-build-settings";
const MODEL_SLOT = "jrouter";
const SUBAGENT_TYPES = [
  { id: "general-purpose", label: "General-purpose", help: "Implementation, testing, and full-capability delegated tasks" },
  { id: "explore", label: "Explore", help: "Read-only codebase research and investigation" },
  { id: "plan", label: "Plan", help: "Architecture and implementation planning" },
];

function ModelField({ label, value, placeholder, onChange, onSelect, disabled, help }) {
  return (
    <FieldRow
      label={label}
      hint={help}
      aside={(
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${
            !disabled
              ? "bg-surface border-border text-text-main hover:border-[var(--text-2)] cursor-pointer"
              : "opacity-50 cursor-not-allowed border-border"
          }`}
        >
          Select
        </button>
      )}
    >
      <div className="relative w-full min-w-0">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-[var(--danger)] rounded transition-colors"
            title="Clear (inherit main model for subagents)"
          >
            <Icon className="text-[14px]">close</Icon>
          </button>
        )}
      </div>
    </FieldRow>
  );
}

export default function GrokBuildToolCard({
  tool,
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
  const { getCaps } = useModelCaps();
  const getContextWindow = (model) => getCaps(model)?.contextWindow || null;
  const initialModel = initialStatus?.settings?.model?.model || "";
  const initialSubagents = Object.fromEntries(
    SUBAGENT_TYPES
      .map((type) => [type.id, initialStatus?.settings?.subagentModels?.[type.id]?.model])
      .filter(([, model]) => Boolean(model)),
  );
  const [grokStatus, setGrokStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState(apiKeys?.[0]?.key || "");
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [subagentModels, setSubagentModels] = useState(initialSubagents);
  const [modelTarget, setModelTarget] = useState(null); // "main" or subagent type
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasFetchedStatus = useRef(Boolean(initialStatus));

  const configuredModel = grokStatus?.settings?.model;
  const currentBaseUrl = configuredModel?.base_url || "";

  const hydrateForm = useCallback((status) => {
    const mainModel = status?.settings?.model?.model || "";
    const configuredSubagents = Object.fromEntries(
      SUBAGENT_TYPES
        .map((type) => [type.id, status?.settings?.subagentModels?.[type.id]?.model])
        .filter(([, model]) => Boolean(model)),
    );
    setSelectedModel(mainModel);
    setSubagentModels(configuredSubagents);
  }, []);

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  const checkStatus = useCallback(async ({ hydrate = false } = {}) => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const status = await res.json();
      setGrokStatus(status);
      hasFetchedStatus.current = true;
      if (hydrate) hydrateForm(status);
    } catch (error) {
      setGrokStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, [hydrateForm]);

  useEffect(() => {
    let cancelled = false;
    const synchronize = async () => {
      if (!hasFetchedStatus.current) await checkStatus({ hydrate: true });
      if (!cancelled) await fetchModelAliases();
    };
    synchronize();
    return () => { cancelled = true; };
  }, [checkStatus, fetchModelAliases]);

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || (typeof window !== "undefined"
      ? window.location.origin.replace("://localhost", "://127.0.0.1")
      : "http://127.0.0.1:20128");
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_jrouter" : null);
      const mappedSubagents = {};
      for (const type of SUBAGENT_TYPES) {
        const model = subagentModels[type.id]?.trim();
        if (model) mappedSubagents[type.id] = { model, contextWindow: getContextWindow(model) };
      }

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          contextWindow: getContextWindow(selectedModel),
          subagentModels: mappedSubagents,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Main and subagent models applied successfully!" });
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
        setSubagentModels({});
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
    if (modelTarget === "main") {
      setSelectedModel(model.value);
    } else if (modelTarget) {
      setSubagentModels((current) => ({ ...current, [modelTarget]: model.value }));
    }
    setModelTarget(null);
  };

  const getManualConfigs = () => {
    const keyToUse = selectedApiKey?.trim()
      || (!cloudEnabled ? "sk_jrouter" : "<API_KEY_FROM_DASHBOARD>");
    const baseUrl = getEffectiveBaseUrl();
    const mainModel = selectedModel || "provider/model-id";
    const blocks = [
      `[models]\ndefault = "${MODEL_SLOT}"`,
      `[model.${MODEL_SLOT}]\nmodel = "${mainModel}"\nbase_url = "${baseUrl}"\nname = "JRouter"\ndescription = "Routed via JRouter gateway"\napi_backend = "chat_completions"\napi_key = "${keyToUse}"\ncontext_window = ${getContextWindow(mainModel) || 200000}`,
    ];
    const mappings = [];
    for (const type of SUBAGENT_TYPES) {
      const model = subagentModels[type.id]?.trim();
      if (!model) continue;
      const slot = `${MODEL_SLOT}-${type.id}`;
      mappings.push(`${type.id} = "${slot}"`);
      blocks.push(`[model.${slot}]\nmodel = "${model}"\nbase_url = "${baseUrl}"\nname = "JRouter ${type.id}"\ndescription = "Routed via JRouter gateway"\napi_backend = "chat_completions"\napi_key = "${keyToUse}"\ncontext_window = ${getContextWindow(model) || 200000}`);
    }
    if (mappings.length) blocks.splice(1, 0, `[subagents.models]\n${mappings.join("\n")}`);
    return [{ filename: "~/.grok/config.toml", content: `${blocks.join("\n\n")}\n` }];
  };

  return (
    <div className={styles.panelBody}>
      {checking && <div className="flex items-center gap-2 text-text-muted"><Icon className="animate-spin">progress_activity</Icon><span>Checking Grok Build...</span></div>}

      {!checking && grokStatus && !grokStatus.installed && (
        <div className={`flex flex-col gap-3 p-4 border ${styles.notice} ${styles.warning}`}>
          <div className="flex items-start gap-3">
            <Icon className="text-[var(--warn)]">warning</Icon>
            <div className="flex-1">
              <p className="font-medium text-[var(--warn)]">Grok Build not detected locally</p>
              <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">curl -fsSL https://x.ai/cli/install.sh | bash</code>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto"><Icon className="text-[18px] mr-1">content_copy</Icon>Manual Config</Button>
        </div>
      )}

      {!checking && grokStatus?.installed && (
        <>
          {tool.notes?.length > 0 && (
            <div className="mb-2 flex flex-col gap-2">
              {tool.notes.map((note, index) => (
                <div key={index} className={`flex items-start gap-2 p-2 border ${styles.notice} ${note.type === "warning" ? styles.warning : styles.neutral}`}>
                  <Icon className="mt-0.5 text-[14px]">{note.type === "warning" ? "warning" : "info"}</Icon>
                  <span>{note.text}</span>
                </div>
              ))}
            </div>
          )}

          <FieldGroup title="Endpoint">
            <FieldRow label="Select Endpoint">
              <BaseUrlSelect value={customBaseUrl || getEffectiveBaseUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} currentUrl={currentBaseUrl} />
            </FieldRow>
            {configuredModel?.base_url && (
              <FieldRow label="Current">
                <span className={styles.currentValue}>{configuredModel.base_url} · {configuredModel.model}{configuredModel.context_window ? ` · ${(configuredModel.context_window / 1000).toLocaleString()}K ctx` : ""}</span>
              </FieldRow>
            )}
          </FieldGroup>

          <FieldGroup title="Credentials">
            <FieldRow label="API Key">
              <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
            </FieldRow>
          </FieldGroup>

          <FieldGroup title="Models">
            <ModelField label="Main Model" value={selectedModel} onChange={setSelectedModel} placeholder="provider/model-id" onSelect={() => setModelTarget("main")} disabled={!hasActiveProviders} />
          </FieldGroup>

          <FieldGroup title="Subagents" description="Leave blank to inherit Main Model. Each override keeps its own context window.">
            {SUBAGENT_TYPES.map((type) => (
              <ModelField
                key={type.id}
                label={type.label}
                help={type.help}
                value={subagentModels[type.id] || ""}
                onChange={(value) => setSubagentModels((current) => ({ ...current, [type.id]: value }))}
                placeholder={`${selectedModel || "Main Model"} (inherit)`}
                onSelect={() => setModelTarget(type.id)}
                disabled={!hasActiveProviders}
              />
            ))}
          </FieldGroup>

          <ActionBar
            message={message?.text}
            tone={message ? (message.type === "success" ? "success" : "danger") : "neutral"}
            busy={applying || restoring}
          >
            <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto"><Icon className="text-[14px] mr-1">content_copy</Icon>Manual Config</Button>
            <Button variant="secondary" size="sm" onClick={handleReset} disabled={!grokStatus?.hasJRouter} loading={restoring} className="w-full sm:w-auto"><Icon className="text-[14px] mr-1">restore</Icon>Reset</Button>
            <Button variant="primary" size="sm" onClick={handleApply} disabled={!selectedModel} loading={applying} className="w-full sm:w-auto"><Icon className="text-[14px] mr-1">save</Icon>Apply</Button>
          </ActionBar>
        </>
      )}

      {modelTarget && (
        <ModelSelectModal
          className={styles.modelPicker}
          isOpen={Boolean(modelTarget)}
          onClose={() => setModelTarget(null)}
          onSelect={handleModelSelect}
          selectedModel={modelTarget === "main" ? selectedModel : subagentModels[modelTarget] || ""}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={modelTarget === "main" ? "Select Main Model for Grok Build" : `Select ${SUBAGENT_TYPES.find((type) => type.id === modelTarget)?.label || "Subagent"} Model`}
        />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Grok Build - Manual Configuration" configs={getManualConfigs()} />
    </div>
  );
}
