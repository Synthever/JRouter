"use client";
import Icon from "@/shared/components/Icon";
import styles from "../cli-tools.module.css";

import { useState } from "react";
import { ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ApiKeySelect from "./ApiKeySelect";
import ActionBar from "./ui/ActionBar";

export default function DefaultToolCard({ toolId, tool, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false, tunnelEnabled = false }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  // Initialize state directly with computed value - no need for useEffect
  const [selectedApiKey, setSelectedApiKey] = useState(() => 
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text) => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_jrouter" : "your-api-key");
    
    // Add /v1 suffix only if not already present (DRY - avoid duplicate)
    const normalizedBaseUrl = baseUrl || "http://localhost:20128";
    const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1") 
      ? normalizedBaseUrl 
      : `${normalizedBaseUrl}/v1`;
    
    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text, field) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderApiKeySelector = () => (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="flex-1" />
    </div>
  );

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          className="w-full min-w-0 sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className={`shrink-0 px-3 py-2 rounded-lg border text-sm transition-colors ${
            hasActiveProviders
              ? "bg-bg-secondary border-border text-text-main hover:border-[var(--text-2)] cursor-pointer"
              : "opacity-50 cursor-not-allowed border-border"
          } ${styles.selectButton}`}
        >
          Select Model
        </button>
        {modelValue && (
          <>
            <button
              onClick={() => handleCopy(modelValue, "model")}
              className={styles.iconButton}
              aria-label="Copy model"
            >
              <Icon className="text-lg">
                {copiedField === "model" ? "check" : "content_copy"}
              </Icon>
            </button>
            <button
              onClick={() => setModelValue("")}
              className="p-2 text-text-muted hover:text-[var(--danger)] rounded transition-colors"
              title="Clear"
            >
              <Icon className="text-lg">close</Icon>
            </button>
          </>
        )}
      </div>
    );
  };

  const renderNotes = () => {
    if (!tool.notes || tool.notes.length === 0) return null;
    
    return (
      <div className="flex flex-col gap-2 mb-4">
        {tool.notes.map((note, index) => {
          // Skip cloudCheck note if tunnel or cloud is enabled
          if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
          
          const isWarning = note.type === "warning";
          const isError = note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled;
          
          let bgClass = styles.neutral;
          let textClass = "text-text-muted";
          let iconClass = "text-text-muted";
          let icon = "info";
          
          if (isWarning) {
            bgClass = styles.warning;
            textClass = "text-[var(--warn)]";
            iconClass = "text-[var(--warn)]";
            icon = "warning";
          } else if (isError) {
            bgClass = styles.danger;
            textClass = "text-[var(--danger)]";
            iconClass = "text-[var(--danger)]";
            icon = "error";
          }
          
          return (
            <div key={index} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
              <Icon className={`text-lg ${iconClass}`}>{icon}</Icon>
              <p className={`text-xs ${textClass}`}>{note.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderGuideSteps = () => {
    if (!tool.guideSteps) return <p className="text-text-muted text-sm">Coming soon...</p>;

    return (
      <div className="flex flex-col gap-4">
        {renderNotes()}
        {canShowGuide() && tool.guideSteps.map((item) => (
          <div key={item.step} className="flex items-start gap-4">
            <div 
              className="size-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold text-white"
              style={{ backgroundColor: tool.color }}
            >
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-text">{item.title}</p>
              {item.desc && <p className="text-xs text-text-muted mt-0.5">{item.desc}</p>}
              {item.type === "apiKeySelector" && renderApiKeySelector()}
              {item.type === "modelSelector" && renderModelSelector()}
              {item.value && (
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <code className="w-full min-w-0 sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm font-mono border border-border truncate">
                    {replaceVars(item.value)}
                  </code>
                  {item.copyable && (
                    <button
                      onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
                      className={styles.iconButton}
                      aria-label="Copy value"
                    >
                      <Icon className="text-lg">
                        {copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}
                      </Icon>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {canShowGuide() && tool.codeBlock && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted uppercase tracking-wide">{tool.codeBlock.language}</span>
              <button
                onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded border border-border transition-colors"
              >
                <Icon className="text-sm">
                  {copiedField === "codeblock" ? "check" : "content_copy"}
                </Icon>
                {copiedField === "codeblock" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="p-4 bg-bg-secondary rounded-lg border border-border overflow-x-auto">
              <code className="whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.panelBody}>
      {renderGuideSteps()}

      <ActionBar message={null} />

      {showModelModal && (
        <ModelSelectModal
          className={styles.modelPicker}
          isOpen={showModelModal}
          onClose={() => setShowModelModal(false)}
          onSelect={handleSelectModel}
          selectedModel={modelValue}
          activeProviders={activeProviders}
          title="Select Model"
        />
      )}
    </div>
  );
}

