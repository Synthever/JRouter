"use client";
import Icon from "@/shared/components/Icon";

import { useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import styles from "../../media-providers/media-providers.module.css";

// ── ModelRow ───────────────────────────────────────────────────
// One model chip: status icon, `alias/model` code, optional name, copy/test actions.
export function ModelRow({ model, fullModel, selected, onClick, copied, onCopy, isSelected, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting }) {
  const chipState = testStatus === "ok" ? styles.modelChipOk : testStatus === "error" ? styles.modelChipError : "";
  const icon = testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy";

  return (
    <div className={`${styles.modelChip} ${chipState}`}>
      <Icon
        className={styles.modelIcon}
        style={testStatus === "ok" ? { color: "var(--pos)" } : testStatus === "error" ? { color: "var(--danger)" } : undefined}
      >
        {icon}
      </Icon>
      <div className={styles.modelBody}>
        <code className={styles.modelCode}>{fullModel}</code>
        {model.name && <span className={styles.modelName}>{model.name}</span>}
      </div>
      {onTest && (
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className={styles.iconBtn}
          title={isTesting ? "Testing…" : "Test model"}
          aria-label={`Test ${fullModel}`}
        >
          <Icon className="text-[15px]" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
            {isTesting ? "progress_activity" : "science"}
          </Icon>
        </button>
      )}
      <button
        type="button"
        onClick={() => onCopy(fullModel, `model-${model.id}`)}
        className={styles.iconBtn}
        title="Copy model id"
        aria-label={`Copy ${fullModel}`}
      >
        <Icon className="text-[15px]">{copied === `model-${model.id}` ? "check" : "content_copy"}</Icon>
      </button>
      {isFree && <span className={styles.modelFree}>FREE</span>}
      {isCustom && (
        <button
          type="button"
          onClick={onDeleteAlias}
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          title="Remove custom model"
          aria-label={`Remove ${fullModel}`}
        >
          <Icon className="text-[15px]">close</Icon>
        </button>
      )}
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  selected: PropTypes.bool,
  onClick: PropTypes.func,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  isSelected: PropTypes.bool,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
};

// ── AddCustomModelModal ────────────────────────────────────────
function AddCustomModelModal({ isOpen, onSave, onClose }) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className={styles.fieldList}>
        <div>
          <label className={styles.fieldLabel}>Model ID</label>
          <input
            className={styles.input}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className={styles.buttonRow}>
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>Add</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ModelsCard ─────────────────────────────────────────────────
// Models panel: chips for every model this provider exposes for `kindFilter`
// plus user-added custom models. Only mounted by the media-provider detail page.
export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModelId, setTestingModelId] = useState(null);
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, customRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/models/custom", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const customData = await customRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (customRes.ok) setCustomModels(customData.models || []);
    } catch (e) { console.log("ModelsCard fetch error:", e); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSetAlias = async (modelId, alias) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) { console.log("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) { console.log("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId);
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return getModelKind(m, "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) => m.providerAlias === providerAlias
      && getModelKind(m, "llm") === effectiveType
      && !builtInModels.some((b) => b.id === m.id)
  );

  const displayModels = builtInModels;
  const total = displayModels.length + myCustomModels.length;

  return (
    <>
      <section className={styles.panel} aria-labelledby="models-heading">
        <div className={styles.panelHead}>
          <div className="min-w-0">
            <h2 id="models-heading" className={styles.panelTitle}>
              <Icon className={styles.panelIcon}>smart_toy</Icon> Models
              <small>{total}</small>
            </h2>
            <p className={styles.panelDesc}>
              Client-side model ids after the provider alias. Test one, or copy it straight into a request.
            </p>
          </div>
          <div className={styles.panelActions}>
            <Button size="sm" variant="outline" icon="add" onClick={() => setShowAddCustomModel(true)}>
              Add Model
            </Button>
          </div>
        </div>

        {testError && <p className={styles.noticeError}>{testError}</p>}

        {total === 0 ? (
          <p className={styles.emptyText}>No models for this kind yet.</p>
        ) : (
          <div className={styles.modelGrid}>
            {displayModels.map((model) => {
              const fullModel = `${providerAlias}/${model.id}`;
              const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
              return (
                <ModelRow
                  key={model.id}
                  model={model}
                  fullModel={fullModel}
                  alias={existingAlias}
                  copied={copied}
                  onCopy={copy}
                  onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                  onDeleteAlias={() => handleDeleteAlias(existingAlias)}
                  testStatus={modelTestResults[model.id]}
                  onTest={() => handleTestModel(model.id)}
                  isTesting={testingModelId === model.id}
                  isFree={model.isFree}
                />
              );
            })}

            {myCustomModels.map((model) => (
              <ModelRow
                key={`${model.id}-${model.type}`}
                model={{ id: model.id, name: model.name }}
                fullModel={`${providerAlias}/${model.id}`}
                copied={copied}
                onCopy={copy}
                onSetAlias={() => {}}
                onDeleteAlias={() => handleDeleteCustomModel(model.id)}
                testStatus={modelTestResults[model.id]}
                onTest={() => handleTestModel(model.id)}
                isTesting={testingModelId === model.id}
                isCustom
              />
            ))}
          </div>
        )}
      </section>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />
    </>
  );
}

ModelsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  kindFilter: PropTypes.string, // e.g. "tts", "embedding" — filters models shown
  providerAliasOverride: PropTypes.string, // override alias (e.g. for custom-embedding nodes using prefix)
};
