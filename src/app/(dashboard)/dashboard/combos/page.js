"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Card, Button, Modal, Input, Skeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle, SegmentedControl } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import ComboSettingsModal from "@/shared/components/ComboSettingsModal";
import ComboLimitsModal from "@/shared/components/ComboLimitsModal";
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
  const [settingsCombo, setSettingsCombo] = useState(null);
  const [limitsCombo, setLimitsCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const [presetLoading, setPresetLoading] = useState(null); // "cursor" | "claude" | null
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("models");
  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
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

  const publicIdOf = (combo) => combo.publicName || combo.name;
  const publicCount = combos.filter((combo) => combo.visibility === "public").length;
  const routedModelCount = new Set(combos.flatMap((combo) => combo.models)).size;
  const visibleCombos = combos.filter((combo) => {
    if (visibilityFilter && combo.visibility !== visibilityFilter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      publicIdOf(combo).toLowerCase().includes(needle) ||
      combo.name.toLowerCase().includes(needle) ||
      combo.models.some((model) => model.toLowerCase().includes(needle))
    );
  });

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
        setActiveProviders((providersData.connections || []).filter((c) => c.isActive !== false));
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

  // Publication flip: a PUT with only `visibility` keeps every other field,
  // since the API validates against the combo's stored state for partial bodies.
  const handleToggleVisibility = async (combo) => {
    const nextVisibility = combo.visibility === "public" ? "private" : "public";
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const updated = await res.json();
      if (!res.ok) {
        alert(updated.error || "Failed to update visibility");
        return;
      }
      setCombos((previous) => previous.map((c) => (c.id === updated.id ? updated : c)));
    } catch (error) {
      console.log("Error updating visibility:", error);
    }
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

      <SegmentedControl
        options={[
          { value: "models", label: "Models" },
          { value: "adapter", label: "Vision Adapter" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        aria-label="Combos view"
      />

      {activeTab === "adapter" ? (
        <section className={`ui-card ${styles.panel}`} aria-labelledby="capacity-adapter-heading">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="capacity-adapter-heading" className="ui-eyebrow flex items-center gap-2">
                <Icon className="text-[16px]">visibility</Icon> Vision Adapter
              </h2>
              <p className={styles.sectionDescription}>
                Your model doesn&apos;t read image/audio? It switches to a model in the pool below.
              </p>
            </div>
          </div>
          <CapacityAdapterSection
            capacityAdapter={capacityAdapter}
            onChange={handleSetCapacityAdapter}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        </section>
      ) : (
      <section className={`ui-card ${styles.panel}`} aria-labelledby="combo-list-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="combo-list-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">layers</Icon> Combos
            </h2>
          </div>
          <Button variant="contrast" size="sm" icon="add" onClick={() => setShowCreateModal(true)}>
            Create
          </Button>
        </div>

        <div className={styles.summaryStrip}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Combos</span>
            <span className={`${styles.summaryValue} u-tnum`}>{combos.length}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}><span className={`${styles.dot} ${styles.dotPublic}`} aria-hidden="true" />Public</span>
            <span className={`${styles.summaryValue} u-tnum`}>{publicCount}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}><span className={`${styles.dot} ${styles.dotPrivate}`} aria-hidden="true" />Private</span>
            <span className={`${styles.summaryValue} u-tnum`}>{combos.length - publicCount}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Models routed</span>
            <span className={`${styles.summaryValue} u-tnum`}>{routedModelCount}</span>
          </div>
        </div>

        <div className={styles.toolbar}>
          <Input
            aria-label="Search combos"
            placeholder="Search model id, combo name or member…"
            icon="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.toolbarSearch}
          />
          <Select
            aria-label="Visibility"
            value={visibilityFilter}
            options={[
              { value: "", label: "All visibility" },
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]}
            onChange={(event) => setVisibilityFilter(event.target.value)}
          />
          {someSelected && (
            <Button size="sm" variant="danger" icon="delete" loading={bulkBusy} onClick={handleBulkDelete}>
              Delete ({selectedIds.length})
            </Button>
          )}
        </div>

        {visibleCombos.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{combos.length ? "No matching combos" : "No combos yet"}</p>
            <p>
              {combos.length
                ? "Try another search or filter."
                : "Create a combo to route requests through your selected models."}
            </p>
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

          <div className={styles.modelTableWrap}>
            <table className={styles.modelTable} aria-label="Combos">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      aria-label="Select all combos"
                    />
                  </th>
                  <th scope="col">Model ID</th>
                  <th scope="col">Members</th>
                  <th scope="col">Strategy</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const comboByName = Object.fromEntries(combos.map((c) => [c.name, c.models]));
                  return visibleCombos.map((combo) => (
                    <ComboTableRow
                      key={combo.id}
                      combo={combo}
                      getCaps={getCaps}
                      comboByName={comboByName}
                      copied={copied}
                      onCopy={copy}
                      onEdit={() => setEditingCombo(combo)}
                      onSettings={() => setSettingsCombo(combo)}
                      onEditLimits={() => setLimitsCombo(combo)}
                      onDelete={() => handleDelete(combo.id)}
                      strategy={comboStrategies[combo.name] || {}}
                      onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                      selected={selectedIds.includes(combo.id)}
                      onToggleSelect={() => toggleSelect(combo.id)}
                      onToggleVisibility={handleToggleVisibility}
                    />
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </section>
      )}

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

      {settingsCombo && (
        <ComboSettingsModal
          key={settingsCombo.id}
          combo={settingsCombo}
          onClose={() => setSettingsCombo(null)}
          onSave={async (settings) => {
            const response = await fetch(`/api/combos/${settingsCombo.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(settings),
            });
            const updated = await response.json();
            if (!response.ok) throw new Error(updated.error || "Failed to save combo settings");
            setCombos((previous) => previous.map((combo) => combo.id === updated.id ? updated : combo));
          }}
        />
      )}

      {limitsCombo && (
        <ComboLimitsModal
          key={limitsCombo.id}
          combo={limitsCombo}
          onClose={() => setLimitsCombo(null)}
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

function ComboRow({ combo, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onSettings, onEditLimits, onDelete, strategy = {}, onSetStrategy, selected = false, onToggleSelect }) {
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
              {combo.promptInjectionEnabled && <span className="text-xs text-text-muted" title="Custom system prompt enabled">Prompt Injection</span>}
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
              // Clicking the summary opens the manual limits for these models;
              // the automatic numbers stay the default.
              <button
                type="button"
                className={`${styles.metadata} ${styles.metadataButton}`}
                onClick={() => onEditLimits?.()}
                title="Set the context window and max output by hand"
                aria-label={`Edit context and output limits for ${combo.name}`}
              >
                <span>ctx {fmtK(comboCaps.contextWindow)}</span>
                <span className="opacity-40">·</span>
                <span>max {fmtK(comboCaps.maxOutput)}</span>
                <Icon className="text-[12px] opacity-60">tune</Icon>
              </button>
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
              onClick={onSettings}
              className={styles.iconAction}
              title="Combo Settings"
              aria-label={`Combo Settings for ${combo.name}`}
            >
              <Icon className="text-[16px]">settings</Icon>
            </button>
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

// One row of the Custom Model-ID table. Renders table cells (not a div tree) so
// the mobile stacked-card CSS keeps a valid table underneath.
// One row of the Custom Model-ID table. Renders table cells (not a div tree) so
// the whole row stays scannable like the Health table: friendly identifier first,
// technical id beneath, one badge per concept, and a single actions menu.
const STRATEGY_LABEL = {
  fallback: "Fallback",
  "round-robin": "Round Robin",
  fusion: "Fusion",
};

const MEMBER_PREVIEW_COUNT = 2;

function ComboTableRow({
  combo, getCaps, comboByName = {}, copied, onCopy, onEdit, onSettings,
  onEditLimits, onDelete, strategy = {}, onSetStrategy, selected = false,
  onToggleSelect, onToggleVisibility,
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [openMenu, setOpenMenu] = useState(null); // "strategy" | "actions" | null
  const [menuPos, setMenuPos] = useState(null);
  const strategyRef = useRef(null);
  const actionsRef = useRef(null);
  const menuRef = useRef(null);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const comboCaps = aggregateComboCapabilities(combo.models, comboByName, getCaps);
  const publicId = combo.publicName || combo.name;
  const copyKey = `combo-${combo.id}`;
  const isPublic = combo.visibility === "public";
  const previewMembers = combo.models.slice(0, MEMBER_PREVIEW_COUNT);
  const hiddenMembers = Math.max(0, combo.models.length - MEMBER_PREVIEW_COUNT);

  useEffect(() => {
    if (!openMenu) return;
    const close = (event) => {
      const inside = [strategyRef.current, actionsRef.current, menuRef.current].some((node) => node?.contains(event.target));
      if (!inside) setOpenMenu(null);
    };
    const escape = (event) => { if (event.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenu]);

  // The table wrapper scrolls horizontally, which would clip an absolutely
  // positioned menu. Render the menu in a portal anchored to the trigger; the
  // real height is measured after mount so the last rows flip above instead of
  // opening off-screen.
  const openAnchoredMenu = (kind) => {
    if (openMenu === kind) { setOpenMenu(null); return; }
    const anchor = (kind === "strategy" ? strategyRef.current : actionsRef.current)?.getBoundingClientRect();
    if (!anchor) return;
    const width = kind === "strategy" ? 180 : 176;
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
    const left = Math.max(8, Math.min(
      kind === "strategy" ? anchor.left : anchor.right - width,
      viewportW - width - 8
    ));
    setMenuPos({ top: anchor.bottom + 4, left, width, anchorTop: anchor.top, anchorBottom: anchor.bottom });
    setOpenMenu(kind);
  };

  // Runs after the portal is in the DOM but before paint, so the measured
  // height can flip the menu above the trigger without a visible jump.
  useLayoutEffect(() => {
    if (!openMenu || !menuPos || !menuRef.current) return;
    const height = menuRef.current.getBoundingClientRect().height;
    const fitsBelow = menuPos.anchorBottom + 4 + height <= window.innerHeight - 8;
    const top = fitsBelow ? menuPos.anchorBottom + 4 : Math.max(8, menuPos.anchorTop - 4 - height);
    if (top !== menuPos.top) setMenuPos((previous) => (previous ? { ...previous, top } : previous));
  }, [openMenu, menuPos]);

  return (
    <tr className={selected ? styles.selected : undefined}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${publicId}`}
        />
      </td>
      <td>
        <button
          type="button"
          className={styles.modelName}
          onClick={() => onCopy(publicId, copyKey)}
          title={`Copy ${publicId}`}
        >
          <span className={styles.publicName}>{publicId}</span>
          {combo.publicName && combo.publicName !== combo.name ? (
            <span className={styles.internalName}>{combo.name}</span>
          ) : null}
        </button>
        {comboCaps && <CapacityBadges caps={comboCaps} colorOverride="text-text-muted" size={13} />}
      </td>
      <td>
        <div className={styles.memberLine}>
          {previewMembers.map((model, index) => (
            <code key={`${model}-${index}`} className={styles.modelChip} title={model}>
              {index > 0 && <span className={styles.chainSeparator} aria-hidden="true">{isFusion ? "+" : "→"}</span>}
              <span className={styles.modelChipText}>{model}</span>
            </code>
          ))}
          {hiddenMembers > 0 && (
            <span className={styles.memberMore} title={combo.models.slice(MEMBER_PREVIEW_COUNT).join("\n")}>
              +{hiddenMembers} more
            </span>
          )}
        </div>
      </td>
      <td>
        <div className={styles.strategyCell} ref={strategyRef}>
          <button
            type="button"
            className={styles.strategyBadge}
            aria-label={`Routing strategy for ${publicId}: ${STRATEGY_LABEL[current] || current}`}
            aria-expanded={openMenu === "strategy"}
            onClick={() => openAnchoredMenu("strategy")}
          >
            <span>{STRATEGY_LABEL[current] || current}</span>
            <Icon className="text-[14px]">expand_more</Icon>
          </button>
          {openMenu === "strategy" && menuPos && createPortal(
            <div
              ref={menuRef}
              className={styles.actionMenu}
              style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              role="menu"
            >
              {STRATEGY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current === option.value}
                  className={styles.actionMenuItem}
                  onClick={() => { onSetStrategy({ fallbackStrategy: option.value }); setOpenMenu(null); }}
                >
                  <span>{STRATEGY_LABEL[option.value]}</span>
                  {current === option.value && <Icon className="text-[14px]">check</Icon>}
                </button>
              ))}
              {isFusion && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.actionMenuItem}
                  onClick={() => { setOpenMenu(null); setShowJudgeSelect(true); }}
                >
                  <span>Judge: {judge || "Auto"}</span>
                  <Icon className="text-[14px]">gavel</Icon>
                </button>
              )}
            </div>,
            document.body
          )}
        </div>
      </td>
      <td>
        <div className={styles.visibilityCell}>
          <Toggle
            size="sm"
            checked={isPublic}
            onChange={() => onToggleVisibility(combo)}
            aria-label={`Visibility for ${publicId}`}
          />
          <span className={isPublic ? styles.visibilityPublic : styles.visibilityPrivate}>
            {isPublic ? "Public" : "Private"}
          </span>
        </div>
      </td>
      <td className={`u-tnum ${styles.updatedCell}`}>{combo.updatedAt ? new Date(combo.updatedAt).toLocaleDateString() : "—"}</td>
      <td className={styles.actionsCell}>
        <div className={styles.rowActions}>
          <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${publicId}`}>Edit</Button>
          <div className={styles.kebabWrap} ref={actionsRef}>
            <button
              type="button"
              className={styles.iconAction}
              title="More actions"
              aria-label={`More actions for ${publicId}`}
              aria-expanded={openMenu === "actions"}
              onClick={() => openAnchoredMenu("actions")}
            >
              <Icon className="text-[16px]">more_vert</Icon>
            </button>
            {openMenu === "actions" && menuPos && createPortal(
              <div
                ref={menuRef}
                className={styles.actionMenu}
                style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
                role="menu"
              >
                <button type="button" role="menuitem" className={styles.actionMenuItem} onClick={() => { setOpenMenu(null); onCopy(publicId, copyKey); }}>
                  <Icon className="text-[14px]">{copied === copyKey ? "check" : "content_copy"}</Icon>
                  <span>Copy model id</span>
                </button>
                <button type="button" role="menuitem" className={styles.actionMenuItem} onClick={() => { setOpenMenu(null); onSettings(); }} aria-label={`Settings ${publicId}`}>
                  <Icon className="text-[14px]">settings</Icon>
                  <span>Settings</span>
                </button>
                <button type="button" role="menuitem" className={styles.actionMenuItem} onClick={() => { setOpenMenu(null); onEditLimits?.(); }} aria-label={`Limits ${publicId}`}>
                  <Icon className="text-[14px]">data_usage</Icon>
                  <span>Limits</span>
                </button>
                <button type="button" role="menuitem" className={`${styles.actionMenuItem} ${styles.actionMenuItemDanger}`} onClick={() => { setOpenMenu(null); onDelete(); }} aria-label={`Delete ${publicId}`}>
                  <Icon className="text-[14px]">delete</Icon>
                  <span>Delete</span>
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </td>
      {/* A <tr> may only contain <td>: the judge modal rides in a hidden cell. */}
      {isFusion && showJudgeSelect && (
        <td hidden>
          <ModelSelectModal
            className={controls.modelPicker}
            portal
            isOpen={showJudgeSelect}
            onClose={() => setShowJudgeSelect(false)}
            onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
            activeProviders={[]}
            title="Select Judge Model"
            addedModelValues={judge ? [judge] : []}
            closeOnSelect={true}
          />
        </td>
      )}
    </tr>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  // The model picker is a portal modal; keeping it out of the <tbody> keeps the
  // table markup valid (a stray <tr> there leaks the pool rows into the outer
  // table body).
  const [pickerCap, setPickerCap] = useState(null);

  return (
    <>
      <div className={styles.modelTableWrap}>
        <table className={styles.modelTable} aria-label="Vision adapter pools">
          <thead>
            <tr>
              <th scope="col">Adapter</th>
              <th scope="col">Model pool</th>
              <th scope="col">Round-robin</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {CAPACITY_ADAPTER_CAPS.map((cap) => (
              <CapacityAdapterRow
                key={cap.key}
                cap={cap}
                entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
                onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
                getCaps={getCaps}
                onOpenPicker={() => setPickerCap(cap)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {pickerCap && (
        <ModelSelectModal
          className={controls.modelPicker}
          portal
          isOpen={!!pickerCap}
          onClose={() => setPickerCap(null)}
          onSelect={(model) => {
            const value = model?.value || model?.name || model;
            const entry = capacityAdapter[pickerCap.key] || EMPTY_CAP_ENTRY;
            if (value && !entry.models.includes(value)) {
              onChange({ ...capacityAdapter, [pickerCap.key]: { ...entry, models: [...entry.models, value] } });
            }
          }}
          onDeselect={(model) => {
            const value = model?.value || model?.name || model;
            const entry = capacityAdapter[pickerCap.key] || EMPTY_CAP_ENTRY;
            const next = entry.models.filter((m) => m !== value);
            onChange({
              ...capacityAdapter,
              [pickerCap.key]: { ...entry, models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next },
            });
          }}
          activeProviders={activeProviders}
          title={`Add ${pickerCap.label} Model`}
          addedModelValues={(capacityAdapter[pickerCap.key] || EMPTY_CAP_ENTRY).models}
          capFilter={pickerCap.key}
          closeOnSelect={false}
        />
      )}
    </>
  );
}

function CapacityAdapterRow({ cap, entry, onChange, getCaps, onOpenPicker }) {
  const [expanded, setExpanded] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

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

  const previewModels = models.slice(0, 2);
  const hiddenModels = Math.max(0, models.length - 2);

  return (
    <>
      <tr>
        <td>
          <div className={styles.adapterIdentity}>
            <Icon className="shrink-0 text-text-muted text-[16px]">{cap.icon}</Icon>
            <div className="min-w-0">
              <span className={styles.adapterLabel}>{cap.label}</span>
              <span className={styles.internalName}>{cap.desc}</span>
            </div>
          </div>
        </td>
        <td>
          {models.length === 0 ? (
            <span className={styles.memberMore}>Empty — falls back to {DEFAULT_FALLBACK_MODEL}</span>
          ) : (
            <div className={styles.memberLine}>
              {previewModels.map((model, index) => (
                <code key={`${model}-${index}`} className={styles.modelChip} title={model}>
                  {index > 0 && <span className={styles.chainSeparator} aria-hidden="true">→</span>}
                  <span className={styles.modelChipText}>{model}</span>
                </code>
              ))}
              {hiddenModels > 0 && (
                <span className={styles.memberMore} title={models.slice(2).join("\n")}>
                  +{hiddenModels} more
                </span>
              )}
            </div>
          )}
        </td>
        <td>
          <Toggle
            size="sm"
            checked={roundRobin}
            onChange={(v) => patch({ roundRobin: v })}
            disabled={!enabled}
            aria-label={`Round-robin ${cap.label} adapter`}
          />
        </td>
        <td>
          <div className={styles.visibilityCell}>
            <Toggle
              size="sm"
              checked={enabled}
              onChange={(v) => patch({ enabled: v })}
              aria-label={`${enabled ? "Disable" : "Enable"} ${cap.label} adapter`}
            />
            <span className={enabled ? styles.visibilityPublic : styles.visibilityPrivate}>
              {enabled ? "Active" : "Disabled"}
            </span>
          </div>
        </td>
        <td className={styles.actionsCell}>
          <div className={styles.rowActions}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={`Manage ${cap.label} pool`}
            >
              {expanded ? "Close" : "Manage"}
            </Button>
            <Button
              icon="add"
              variant="secondary"
              size="sm"
              onClick={onOpenPicker}
              disabled={!enabled}
              title={`Add ${cap.label} model`}
              aria-label={`Add ${cap.label} model`}
            >
              Add
            </Button>
          </div>
        </td>
      </tr>

      {/* Pool editor: the routing order matters, so it stays its own table. */}
      {expanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={5}>
            {models.length === 0 ? (
              <p className={styles.memberMore}>
                No models in pool (will fallback to {DEFAULT_FALLBACK_MODEL})
              </p>
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
          </td>
        </tr>
      )}
    </>
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
