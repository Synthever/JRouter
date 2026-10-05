"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Card, Button, Modal, Input, Skeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import controls from "@/shared/components/DashboardControls.module.css";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { aggregateComboCapabilities } from "open-sse/providers/capabilities.js";
import styles from "./combos.module.css";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Capacity adapter: global fallback pools of models per input-modality capability.
// A request needing a capability the target model/combo lacks switches straight
// to the first enabled model here instead of erroring or dropping the data.
const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "images (png, jpg, webp, …)" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "audio input" },
];
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.6-flash-free";
const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
const upgradeLegacyModel = (m) => (m === "oc/mimo-v2.5-free" ? DEFAULT_FALLBACK_MODEL : m);

// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => upgradeLegacyModel(e?.model || e)).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.map(upgradeLegacyModel).filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback — try in order" },
  { value: "round-robin", label: "Round Robin — rotate" },
  { value: "fusion", label: "Fusion — panel + judge" },
];

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const [presetLoading, setPresetLoading] = useState(null); // "cursor" | "claude" | null
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop stale selection when the combo list changes (delete / refresh).
  useEffect(() => {
    const alive = new Set(combos.map((c) => c.id));
    setSelectedIds((prev) => prev.filter((id) => alive.has(id)));
  }, [combos]);

  const selectedCombos = combos.filter((c) => selectedIds.includes(c.id));
  const allSelected = combos.length > 0 && selectedIds.length === combos.length;
  const someSelected = selectedIds.length > 0;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : combos.map((c) => c.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const handleGeneratePresets = async (source) => {
    const label = source === "cursor" ? "Cursor Default" : "Claude Default";
    setPresetLoading(source);
    try {
      const previewRes = await fetch(`/api/combos/presets?source=${source}`);
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        alert(preview.error || `Failed to preview ${label}`);
        return;
      }

      const toCreate = preview.toCreate ?? (preview.items || []).filter((i) => !i.exists).length;
      const toSkip = preview.toSkip ?? (preview.items || []).filter((i) => i.exists).length;
      const total = (preview.items || []).length;

      if (total === 0) {
        alert(`No ${label} models available to generate.`);
        return;
      }

      if (toCreate === 0) {
        alert(`All ${total} ${label} combos already exist. Nothing to create.`);
        return;
      }

      setConfirmState({
        title: `Generate ${label}`,
        message: `Create ${toCreate} combo${toCreate === 1 ? "" : "s"} named like ${source === "cursor" ? "Cursor" : "Claude"} model IDs (seeded with cu/… or cc/…). ${toSkip} already exist and will be skipped. You can edit any combo afterward to add fallbacks.`,
        confirmText: "Generate",
        variant: "primary",
        onConfirm: async () => {
          setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
          try {
            const res = await fetch("/api/combos/presets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source }),
            });
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || `Failed to generate ${label}`);
              return;
            }
            await fetchData();
            setConfirmState(null);
          } catch (error) {
            console.log(`Error generating ${label}:`, error);
            alert(`Failed to generate ${label}`);
            setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
          }
        },
      });
    } catch (error) {
      console.log(`Error previewing ${label}:`, error);
      alert(`Failed to preview ${label}`);
    } finally {
      setPresetLoading(null);
    }
  };

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      // Only LLM combos here - webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) setCombos((combosData.combos || []).filter(c => !c.kind || c.kind === "llm"));
      if (providersRes.ok) {
        setActiveProviders(providersData.connections || []);
      }
      setComboStrategies(settingsData.comboStrategies || {});
      const rawAdapter = settingsData.capacityAdapter || {};
      const normalized = {};
      for (const cap of CAPACITY_ADAPTER_CAPS) {
        normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
      }
      setCapacityAdapter(normalized);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const pruneStrategiesForNames = (names, base = comboStrategies) => {
    const updated = { ...base };
    for (const name of names) delete updated[name];
    return updated;
  };

  const persistComboStrategies = async (updated) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated }),
    });
    setComboStrategies(updated);
  };

  const handleDelete = async (id) => {
    const combo = combos.find((c) => c.id === id);
    setConfirmState({
      title: "Delete Combo",
      message: combo ? `Delete combo "${combo.name}"?` : "Delete this combo?",
      onConfirm: async () => {
        setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            if (combo?.name) {
              await persistComboStrategies(pruneStrategiesForNames([combo.name]));
            }
            setCombos((prev) => prev.filter((c) => c.id !== id));
            setSelectedIds((prev) => prev.filter((x) => x !== id));
          }
          setConfirmState(null);
        } catch (error) {
          console.log("Error deleting combo:", error);
          setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    if (selectedCombos.length === 0) return;
    const count = selectedCombos.length;
    setConfirmState({
      title: "Delete Selected Combos",
      message: `Delete ${count} selected combo${count === 1 ? "" : "s"}? This cannot be undone.`,
      confirmText: "Delete",
      variant: "danger",
      onConfirm: async () => {
        setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
        setBulkBusy(true);
        try {
          const ids = selectedCombos.map((c) => c.id);
          const names = selectedCombos.map((c) => c.name);
          const results = await Promise.all(
            ids.map((id) => fetch(`/api/combos/${id}`, { method: "DELETE" }))
          );
          const failed = results.filter((r) => !r.ok).length;
          await persistComboStrategies(pruneStrategiesForNames(names));
          setCombos((prev) => prev.filter((c) => !ids.includes(c.id)));
          clearSelection();
          setConfirmState(null);
          if (failed > 0) alert(`Deleted with ${failed} failure${failed === 1 ? "" : "s"}.`);
        } catch (error) {
          console.log("Error bulk deleting combos:", error);
          alert("Failed to delete selected combos");
          setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }

      await persistComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  const handleBulkSetStrategy = async (strategy) => {
    if (selectedCombos.length === 0 || !strategy) return;
    setBulkBusy(true);
    try {
      const updated = { ...comboStrategies };
      for (const combo of selectedCombos) {
        if (!strategy || strategy === "fallback") {
          delete updated[combo.name];
        } else {
          updated[combo.name] = {
            ...(updated[combo.name] || {}),
            fallbackStrategy: strategy,
          };
        }
      }
      await persistComboStrategies(updated);
    } catch (error) {
      console.log("Error bulk updating combo strategy:", error);
      alert("Failed to update strategy for selected combos");
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return (
      <div className={`dashboard-surface ${styles.page}`} aria-busy="true" aria-label="Loading combos">
        {[0, 1].map((section) => (
          <Card key={section} className={`ui-card ${styles.panel}`}>
            <Skeleton className="mb-4 h-4 w-40" />
            <Skeleton className="h-20 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <div className="min-w-0">
          <p className={styles.description}>
            Group models under one name, then pick a strategy per combo
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-stretch">
          <Button variant="contrast" icon="add" onClick={() => setShowCreateModal(true)} className="w-full whitespace-nowrap sm:w-auto">
            Create Combo
          </Button>
          <div className="hidden">
            <Button
              variant="secondary"
              size="sm"
              icon="edit_note"
              loading={presetLoading === "cursor"}
              disabled={!!presetLoading}
              onClick={() => handleGeneratePresets("cursor")}
              className="w-full whitespace-nowrap"
            >
              Cursor Default
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="smart_toy"
              loading={presetLoading === "claude"}
              disabled={!!presetLoading}
              onClick={() => handleGeneratePresets("claude")}
              className="w-full whitespace-nowrap"
            >
              Claude Default
            </Button>
          </div>
        </div>
      </header>

      <section className={`ui-card ${styles.panel}`} aria-labelledby="combo-list-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="combo-list-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">layers</Icon> Combos
            </h2>
          </div>
        </div>
        {combos.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No combos yet</p>
            <p>Create a combo to route requests through your selected models.</p>
            <Button variant="contrast" icon="add" onClick={() => setShowCreateModal(true)} className="mt-4">Create Combo</Button>
          </div>
        ) : (
        <div>
          {/* Selection toolbar */}
          <div className={styles.selectionToolbar}>
            <label className={styles.selectionLabel}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleSelectAll}
                aria-label="Select all combos"
              />
              <span>
                {someSelected
                  ? `${selectedIds.length} selected`
                  : `Select all (${combos.length})`}
              </span>
            </label>

            <div className={styles.bulkActions}>
              {someSelected && (
                <>
                  <div className={styles.strategySelect}>
                    <Select
                      options={STRATEGY_OPTIONS}
                      value=""
                      placeholder="Set strategy…"
                      aria-label="Set strategy for selected combos"
                      disabled={bulkBusy}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) handleBulkSetStrategy(v);
                      }}
                      selectClassName="py-1.5 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="delete"
                    disabled={bulkBusy}
                    loading={bulkBusy}
                    onClick={handleBulkDelete}
                    className={`${styles.deleteButton} whitespace-nowrap`}
                  >
                    Delete ({selectedIds.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                    disabled={bulkBusy}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          <ul className={styles.rows}>
            {(() => {
              const comboByName = Object.fromEntries(combos.map((c) => [c.name, c.models]));
              return combos.map((combo) => (
                <ComboRow
                  key={combo.id}
                  combo={combo}
                  getCaps={getCaps}
                  comboByName={comboByName}
                  activeProviders={activeProviders}
                  copied={copied}
                  onCopy={copy}
                  onEdit={() => setEditingCombo(combo)}
                  onDelete={() => handleDelete(combo.id)}
                  strategy={comboStrategies[combo.name] || {}}
                  onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                  selected={selectedIds.includes(combo.id)}
                  onToggleSelect={() => toggleSelect(combo.id)}
                />
              ));
            })()}
          </ul>
        </div>
        )}
      </section>

      <section className={`ui-card ${styles.panel}`} aria-labelledby="capacity-adapter-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="capacity-adapter-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">visibility</Icon> Vision Adapter
            </h2>
            <p className={styles.sectionDescription}>Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.</p>
          </div>
        </div>
        <CapacityAdapterSection
          capacityAdapter={capacityAdapter}
          onChange={handleSetCapacityAdapter}
          activeProviders={activeProviders}
          getCaps={getCaps}
        />
      </section>

      {/* Create Modal - Use key to force remount and reset state */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          activeProviders={activeProviders}
        />
      )}

      {/* Confirm (delete / generate presets) */}
      <ConfirmModal
        className={styles.dialog}
        isOpen={!!confirmState}
        onClose={() => !confirmState?.loading && setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText || "Confirm"}
        variant={confirmState?.variant || "danger"}
        loading={!!confirmState?.loading}
      />
    </div>
  );
}

const fmtK = (n) => {
  if (!n) return "?";
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
};

function ComboRow({ combo, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy, selected = false, onToggleSelect }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  // The synced catalog is server-only, so resolving here would fall back to the
  // generic patterns and under-report the limits. getCaps carries the server's
  // answer for /api/models.
  const comboCaps = aggregateComboCapabilities(combo.models, comboByName, getCaps);

  return (
    <li className={`${styles.comboRow} ${selected ? styles.selected : ""}`}>
      <div className={styles.rowContent}>
        <div className={styles.identity}>
          <label className="flex shrink-0 items-center pt-1 sm:pt-0 cursor-pointer" title="Select combo">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Select ${combo.name}`}
            />
          </label>
          <Icon className="shrink-0 text-text-muted text-[16px]">layers</Icon>
          <div className="min-w-0 flex-1">
            <div className={styles.nameLine}>
              <code className={styles.comboName} title={combo.name}>{combo.name}</code>
              <StatusBadge dot={false}>{combo.models.length} {combo.models.length === 1 ? "model" : "models"}</StatusBadge>
            </div>
            <div className={styles.modelList} aria-label="Model routing order">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className={styles.modelChip} title={model}>
                    {index > 0 && <span className={styles.chainSeparator} aria-hidden="true">{isFusion ? "+" : "→"}</span>}
                    <span>{model}</span>
                    <CapacityBadges caps={
                      comboByName[model]
                        ? aggregateComboCapabilities(comboByName[model], comboByName, getCaps)
                        : getCaps?.(model)
                    } colorOverride="text-text-muted" size={14} />
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[11px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
            {comboCaps && (
              <div className={styles.metadata}>
                <span>ctx {fmtK(comboCaps.contextWindow)}</span>
                <span className="opacity-40">·</span>
                <span>max {fmtK(comboCaps.maxOutput)}</span>
              </div>
            )}
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-text-muted">Judge</span>
                <button
                  type="button"
                  onClick={() => setShowJudgeSelect(true)}
                  className={styles.judgeButton}
                  title="Pick the model that fuses panel answers"
                >
                  <Icon className="shrink-0 text-[14px]">gavel</Icon>
                  <span>{judge || `Auto - ${combo.models[0] || "first model"}`}</span>
                </button>
                {judge && (
                  <button
                    type="button"
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className={`${styles.resetJudge} rounded p-1 text-text-muted hover:bg-surface-2 transition-colors`}
                    title="Reset judge to Auto"
                    aria-label="Reset judge to automatic"
                  >
                    <Icon className="text-[13px]">close</Icon>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className={styles.rowControls}>
          {/* Strategy selector — always visible */}
          <div className={styles.strategySelect}>
            <Select
              options={STRATEGY_OPTIONS}
              value={current}
              aria-label={`Routing strategy for ${combo.name}`}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="py-1.5 text-xs"
            />
          </div>

          <div className={styles.comboActions}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className={styles.iconAction}
              title="Copy combo name"
              aria-label={`Copy ${combo.name}`}
            >
              <Icon className={`text-[16px] ${copied === `combo-${combo.id}` ? styles.success : ""}`}>
                {copied === `combo-${combo.id}` ? "check" : "content_copy"}
              </Icon>
            </button>
            <button
              type="button"
              onClick={onEdit}
              className={styles.iconAction}
              title="Edit"
              aria-label={`Edit ${combo.name}`}
            >
              <Icon className="text-[16px]">edit</Icon>
            </button>
            <button
              type="button"
              onClick={onDelete}
              className={`${styles.iconAction} ${styles.dangerAction}`}
              title="Delete"
              aria-label={`Delete ${combo.name}`}
            >
              <Icon className="text-[16px]">delete</Icon>
            </button>
          </div>
        </div>
      </div>

      {/* Judge model picker (single-select; combo members make natural judges too) */}
      {showJudgeSelect && (
        <ModelSelectModal
          className={controls.modelPicker}
          portal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </li>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className={styles.rows}>
      {CAPACITY_ADAPTER_CAPS.map((cap) => (
        <CapacityAdapterCap
          key={cap.key}
          cap={cap}
          entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
          onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
          activeProviders={activeProviders}
          getCaps={getCaps}
        />
      ))}
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    const value = model?.value || model?.name || model;
    if (!value || models.includes(value)) return;
    patch({ models: [...models, value] });
  };

  const handleDeselect = (model) => {
    const value = model?.value || model?.name || model;
    const next = models.filter((m) => m !== value);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <div className={styles.adapterRow}>
      <div className={styles.adapterHeader}>
        {/* Master toggle + icon + label */}
        <div className={styles.identity}>
          <Icon className="shrink-0 text-text-muted text-[16px]">{cap.icon}</Icon>
          <div className="min-w-0 flex-1">
            <div className={styles.nameLine}>
              <h3 className={styles.adapterName}>{cap.label}</h3>
              <StatusBadge variant={enabled ? "success" : "default"}>{enabled ? "Active" : "Disabled"}</StatusBadge>
            </div>
            <p className={styles.metadata}>{cap.desc}</p>
          </div>
        </div>

        {/* Actions: Round-robin toggle + Add Model */}
        <div className={styles.adapterActions}>
          <Toggle size="sm" checked={enabled} onChange={(v) => patch({ enabled: v })} aria-label={`${enabled ? "Disable" : "Enable"} ${cap.label} adapter`} />
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <Toggle
              size="sm"
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round-robin</span>
          </label>
          <Button
            icon="add"
            variant="secondary"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {/* Model pool list/table */}
      {models.length === 0 ? (
        <div className="mt-3 py-2 text-center text-xs text-text-muted italic">
          No models in pool (will fallback to {DEFAULT_FALLBACK_MODEL})
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={`${cap.label} model pool`}>
            <thead>
              <tr>
                <th scope="col" className="w-8 text-center">#</th>
                <th scope="col">Model</th>
                <th scope="col" className="w-24 text-center">Order</th>
                <th scope="col" className="w-9 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {models.map((model, index) => (
                <tr key={`${model}-${index}`}>
                  <td className="text-center text-text-muted text-[11px] font-sans">
                    #{index + 1}
                  </td>
                  <td className="text-text-main">
                    <div className={styles.poolModel}>
                      <span className={styles.modelValue} title={model}>{model}</span>
                      <CapacityBadges caps={getCaps?.(model)} colorOverride="text-text-muted" size={14} />
                      {model === DEFAULT_FALLBACK_MODEL && (
                        <StatusBadge dot={false}>Free default</StatusBadge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMove(index, -1)}
                        disabled={!enabled || index === 0}
                        className={styles.iconAction}
                        title="Move up"
                        aria-label={`Move ${model} up`}
                      >
                        <Icon className="text-[16px] leading-none">arrow_upward</Icon>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, 1)}
                        disabled={!enabled || index === models.length - 1}
                        className={styles.iconAction}
                        title="Move down"
                        aria-label={`Move ${model} down`}
                      >
                        <Icon className="text-[16px] leading-none">arrow_downward</Icon>
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(index)}
                      disabled={!enabled}
                      className={`${styles.iconAction} ${styles.dangerAction}`}
                      title="Remove model"
                      aria-label={`Remove ${model}`}
                    >
                      <Icon className="text-[16px] leading-none">close</Icon>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModelSelect && (
        <ModelSelectModal
          className={controls.modelPicker}
          portal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          onDeselect={handleDeselect}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}

function ModelItem({ id, index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    // no transition — prevents the CSS settle animation fighting React's re-render on drop
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.modelItem} ${isDragging ? "ring-1 ring-[var(--accent-line)]" : ""}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        className={`${styles.iconAction} ${styles.dragHandle}`}
        title="Drag to reorder"
        aria-label={`Reorder ${model}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
        </svg>
      </button>

      {/* Index badge */}
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className={styles.modelEditor}
          aria-label={`Model ${index + 1}`}
        />
      ) : (
        <div
          className={styles.inlineModel}
          onClick={() => setEditing(true)}
          title="Click to edit"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setEditing(true);
            }
          }}
          aria-label={`Edit model ${model}`}
        >
          {model}
        </div>
      )}

      {/* Priority arrows */}
      <div className={styles.priorityActions}>
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={styles.iconAction}
          title="Move up"
          aria-label={`Move ${model} up`}
        >
          <Icon className="text-[16px]">arrow_upward</Icon>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={styles.iconAction}
          title="Move down"
          aria-label={`Move ${model} down`}
        >
          <Icon className="text-[16px]">arrow_downward</Icon>
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className={`${styles.iconAction} ${styles.dangerAction}`}
        title="Remove"
        aria-label={`Remove ${model}`}
      >
        <Icon className="text-[16px]">close</Icon>
      </button>
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Use stable index-based IDs so duplicates and similar names are handled correctly
  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };

  useEffect(() => {
    if (isOpen) fetchModalData();
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model) => {
    setModels(models.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), models });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        className={styles.dialog}
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? "Edit Combo" : "Create Combo"}
      >
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          {/* Models */}
          <div>
            <p className={styles.fieldLabel}>Models</p>

            {models.length === 0 ? (
              <div className={styles.modalEmpty}>
                <p className="font-medium text-text-main">No models added yet</p>
                <p className="mt-1">Choose one or more models to include in this combo.</p>
              </div>
            ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
                  {modelItems.map(({ uid, model }, index) => (
                    <ModelItem
                      key={uid}
                      id={uid}
                      index={index}
                      model={model}
                      isFirst={index === 0}
                      isLast={index === modelItems.length - 1}
                      onEdit={(newVal) => {
                        const updated = [...models];
                        updated[index] = newVal;
                        setModels(updated);
                      }}
                      onMoveUp={() => handleMoveUp(index)}
                      onMoveDown={() => handleMoveDown(index)}
                      onRemove={() => handleRemoveModel(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            )}

            {/* Add Model button */}
            <Button
              variant="secondary"
              icon="add"
              fullWidth
              onClick={() => setShowModelSelect(true)}
              className="mt-2"
            >
              Add Model
            </Button>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              variant="contrast"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      {showModelSelect && (
        <ModelSelectModal
          className={controls.modelPicker}
          portal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Add Model to Combo"
          kindFilter={kindFilter}
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </>
  );
}
