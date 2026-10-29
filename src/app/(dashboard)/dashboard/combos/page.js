"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import Icon from "@/shared/components/Icon";
import AppLogo from "@/shared/components/AppLogo";
import { Button, Modal, Input, Skeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Toggle } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import ComboSettingsModal from "@/shared/components/ComboSettingsModal";
import ComboLimitsModal from "@/shared/components/ComboLimitsModal";
import controls from "@/shared/components/DashboardControls.module.css";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { aggregateComboCapabilities } from "open-sse/providers/capabilities.js";
import ComboStats from "./components/ComboStats";
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

const STRATEGY_MENU = [
  { value: "fallback", label: "Fallback", hint: "Try members in order" },
  { value: "round-robin", label: "Round Robin", hint: "Rotate across members" },
  { value: "fusion", label: "Fusion", hint: "Panel answers + judge" },
];

const STRATEGY_LABEL = {
  fallback: "Fallback",
  "round-robin": "Round Robin",
  fusion: "Fusion",
};

const VISIBILITY_OPTIONS = [
  { value: "", label: "All" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];

const MEMBER_PREVIEW_COUNT = 2;

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
  const [bulkStrategyOpen, setBulkStrategyOpen] = useState(false);
  const bulkStrategyRef = useRef(null);
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

  // Close the bulk strategy menu on outside click or Escape.
  useEffect(() => {
    if (!bulkStrategyOpen) return;
    const close = (event) => {
      if (!bulkStrategyRef.current?.contains(event.target)) setBulkStrategyOpen(false);
    };
    const escape = (event) => { if (event.key === "Escape") setBulkStrategyOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [bulkStrategyOpen]);

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

  // Card grid resolves combo members' capabilities through this lookup so a
  // nested combo reports its aggregate limits instead of the raw model's.
  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo.models]));
  const memberCount = combos.reduce((total, combo) => total + combo.models.length, 0);
  const strategyCounts = { fallback: 0, "round-robin": 0, fusion: 0 };
  for (const combo of combos) {
    const key = comboStrategies[combo.name]?.fallbackStrategy || "fallback";
    if (strategyCounts[key] != null) strategyCounts[key] += 1;
  }
  const topStrategy = combos.length
    ? Object.keys(strategyCounts).sort((a, b) => strategyCounts[b] - strategyCounts[a])[0]
    : null;
  const strategyNote = combos.length
    ? `${strategyCounts.fallback} fallback · ${strategyCounts["round-robin"]} round robin · ${strategyCounts.fusion} fusion`
    : "No combos yet";
  const enabledAdapterCount = CAPACITY_ADAPTER_CAPS.filter((cap) => capacityAdapter[cap.key]?.enabled).length;

  const jumpToSection = (key) => {
    if (typeof document === "undefined") return;
    const target = document.getElementById(`s-${key}`);
    if (!target) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const toggleSelect = (id) => {
    setBulkStrategyOpen(false);
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleSelectAll = () => {
    setBulkStrategyOpen(false);
    setSelectedIds(allSelected ? [] : combos.map((c) => c.id));
  };

  const clearSelection = () => {
    setBulkStrategyOpen(false);
    setSelectedIds([]);
  };

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
        <div className={styles.stats}>
          {[0, 1, 2].map((card) => (
            <Skeleton key={card} className={styles.statSkeleton} />
          ))}
        </div>
        <div className={styles.section}>
          <Skeleton className="mb-5 h-4 w-40" />
          <div className={styles.grid}>
            {[0, 1, 2, 3].map((card) => (
              <Skeleton key={card} className={styles.cardSkeleton} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <div>
          <h1 className={styles.title}>Combos</h1>
          <p className={styles.sub}>Give one model id several upstreams, then choose how requests travel between them.</p>
        </div>
        {/* Preset generators stay dormant (hidden) — only the visible create
            CTA moved to the section header so there is a single Create button. */}
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
      </header>

      <ComboStats
        totalCombos={combos.length}
        publicCount={publicCount}
        privateCount={combos.length - publicCount}
        routedModelCount={routedModelCount}
        memberCount={memberCount}
        chainCount={combos.length}
        topStrategyLabel={topStrategy ? STRATEGY_LABEL[topStrategy] : "None"}
        strategyNote={strategyNote}
      />

      <div className={styles.toolbar}>
        <nav className={styles.chips} aria-label="Jump to a combos section">
          <button type="button" className={styles.chip} onClick={() => jumpToSection("combos")}>
            Combos
            <b>{combos.length}</b>
          </button>
          <button type="button" className={styles.chip} onClick={() => jumpToSection("adapter")}>
            Vision adapter
            <b>{enabledAdapterCount}</b>
          </button>
        </nav>
        <div className={styles.tabs} role="group" aria-label="Filter combos by visibility">
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              className={styles.tab}
              aria-pressed={visibilityFilter === option.value}
              onClick={() => setVisibilityFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section id="s-combos" className={styles.section} aria-labelledby="combo-list-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="combo-list-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>layers</Icon>
              Combos
              <small>{combos.length}</small>
            </h2>
            <p className={styles.description}>Each combo routes to its members in the order and strategy you set.</p>
          </div>
          <div className={styles.actions}>
            <Button variant="contrast" icon="add" onClick={() => setShowCreateModal(true)}>
              Create
            </Button>
          </div>
        </div>

        <div className={styles.listToolbar}>
          <Input
            aria-label="Search combos"
            placeholder="Search model id, combo name or member…"
            icon="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.toolbarSearch}
          />
          <label className={styles.selectAll}>
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
          {someSelected && (
            <div className={styles.bulkActions}>
              <div className={styles.bulkStrategy} ref={bulkStrategyRef}>
                <button
                  type="button"
                  className={styles.bulkStrategyButton}
                  aria-haspopup="menu"
                  aria-expanded={bulkStrategyOpen}
                  disabled={bulkBusy}
                  onClick={() => setBulkStrategyOpen((open) => !open)}
                >
                  <Icon className="text-[15px]">route</Icon>
                  <span>Set strategy</span>
                  <Icon className="text-[15px]">{bulkStrategyOpen ? "expand_less" : "expand_more"}</Icon>
                </button>
                {bulkStrategyOpen && (
                  <div className={styles.bulkStrategyMenu} role="menu" aria-label="Set strategy for selected combos">
                    {STRATEGY_MENU.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitem"
                        className={styles.bulkStrategyItem}
                        onClick={() => {
                          setBulkStrategyOpen(false);
                          handleBulkSetStrategy(option.value);
                        }}
                      >
                        <span className={styles.bulkStrategyItemLabel}>{option.label}</span>
                        <span className={styles.bulkStrategyItemHint}>{option.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="danger"
                icon="delete"
                disabled={bulkBusy}
                loading={bulkBusy}
                onClick={handleBulkDelete}
              >
                Delete ({selectedIds.length})
              </Button>
              <Button variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
                Clear
              </Button>
            </div>
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
          <ul className={styles.grid}>
            {visibleCombos.map((combo) => (
              <ComboCard
                key={combo.id}
                combo={combo}
                getCaps={getCaps}
                comboByName={comboByName}
                activeProviders={activeProviders}
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
            ))}
          </ul>
        )}
      </section>

      <section id="s-adapter" className={styles.section} aria-labelledby="capacity-adapter-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="capacity-adapter-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>visibility</Icon>
              Vision adapter
              <small>{enabledAdapterCount} active</small>
            </h2>
            <p className={styles.description}>
              When a model can&apos;t read images or audio, the request switches to a model in these pools instead of failing.
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

// One combo as a card in the combos grid: identity and routing order first,
// then the strategy and visibility controls, mirroring provider cards.
function ComboCard({
  combo, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onSettings,
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

  // The card grid scrolls with the page, so an absolutely positioned menu would
  // clip against the card. Render the menu in a portal anchored to the trigger;
  // the real height is measured after mount so the last cards flip above the
  // trigger instead of opening off-screen.
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

  // The menu lives in a portal with fixed coordinates, so it has to follow its
  // trigger while the page scrolls instead of staying where it was opened.
  useEffect(() => {
    if (!openMenu) return;
    let frame = 0;
    const reposition = () => {
      frame = 0;
      const anchor = (openMenu === "strategy" ? strategyRef.current : actionsRef.current)?.getBoundingClientRect();
      if (!anchor || anchor.bottom < 0 || anchor.top > window.innerHeight) {
        setOpenMenu(null);
        return;
      }
      const width = openMenu === "strategy" ? 180 : 176;
      const height = menuRef.current?.getBoundingClientRect().height || 0;
      const left = Math.max(8, Math.min(
        openMenu === "strategy" ? anchor.left : anchor.right - width,
        window.innerWidth - width - 8
      ));
      const fitsBelow = anchor.bottom + 4 + height <= window.innerHeight - 8;
      const top = fitsBelow ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - height);
      setMenuPos((previous) => (
        previous && previous.top === top && previous.left === left
          ? previous
          : { top, left, width, anchorTop: anchor.top, anchorBottom: anchor.bottom }
      ));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(reposition); };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [openMenu]);

  return (
    <li className={styles.cardItem}>
      <article
        className={`${styles.card} ${isPublic ? styles.cardPublic : ""} ${selected ? styles.cardSelected : ""}`}
        aria-label={publicId}
      >
        <div className={styles.cardHead}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${publicId}`}
          />
          <AppLogo size={32} className={styles.cardLogo} />
          <div className={styles.identity}>
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
          </div>
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

        <div className={styles.memberLine} aria-label="Model routing order">
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

        <div className={styles.cardMeta}>
          {comboCaps ? (
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
              <Icon className="text-[12px] opacity-60">edit</Icon>
            </button>
          ) : <span />}
          <span className={styles.updated}>
            {combo.updatedAt ? `Updated ${new Date(combo.updatedAt).toLocaleDateString()}` : "Never updated"}
          </span>
        </div>

        {/* Fusion: judge picker (Auto = first model) */}
        {isFusion && (
          <div className={styles.judgeRow}>
            <span className={styles.judgeLabel}>Judge</span>
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
                className={styles.iconAction}
                title="Reset judge to Auto"
                aria-label="Reset judge to automatic"
              >
                <Icon className="text-[13px]">close</Icon>
              </button>
            )}
          </div>
        )}

        <div className={styles.cardFoot}>
          <div className={styles.cardFootMeta}>
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
          </div>
          <div className={styles.cardActions}>
            <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${publicId}`}>Edit</Button>
          </div>
        </div>

        {isFusion && showJudgeSelect && (
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
      </article>
    </li>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  // The model picker is a portal modal; keeping the dialog out of the card grid
  // lets each pool card own its own expanded editor.
  const [pickerCap, setPickerCap] = useState(null);

  return (
    <>
      <ul className={styles.adapterGrid}>
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <AdapterCard
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            getCaps={getCaps}
            onOpenPicker={() => setPickerCap(cap)}
          />
        ))}
      </ul>

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

function AdapterCard({ cap, entry, onChange, getCaps, onOpenPicker }) {
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
    <li className={styles.cardItem}>
      <article className={`${styles.card} ${styles.adapterCard} ${enabled ? "" : styles.cardOff}`}>
        <div className={styles.cardHead}>
          <span className={styles.cardTile} data-cap={cap.key} aria-hidden="true">
            <Icon className="text-[20px]">{cap.icon}</Icon>
          </span>
          <div className={styles.identity}>
            <span className={styles.adapterLabel}>{cap.label}</span>
            <span className={styles.internalName}>{cap.desc}</span>
          </div>
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
        </div>

        <div className={styles.memberLine}>
          {models.length === 0 ? (
            <span className={styles.memberMore}>Empty — falls back to {DEFAULT_FALLBACK_MODEL}</span>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className={styles.adapterFoot}>
          <div className={styles.roundRobin}>
            <Toggle
              size="sm"
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round-robin</span>
          </div>
          <div className={styles.cardActions}>
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
        </div>

        {/* Pool editor: the routing order matters, so it stays an ordered list. */}
        {expanded && (
          <div className={styles.poolEditor}>
            {models.length === 0 ? (
              <p className={styles.memberMore}>
                No models in pool (will fallback to {DEFAULT_FALLBACK_MODEL})
              </p>
            ) : (
              <ol className={styles.poolList} aria-label={`${cap.label} model pool`}>
                {models.map((model, index) => (
                  <li key={`${model}-${index}`} className={styles.poolRow}>
                    <span className={styles.poolIndex}>#{index + 1}</span>
                    <div className={styles.poolModel}>
                      <span className={styles.modelValue} title={model}>{model}</span>
                      <CapacityBadges caps={getCaps?.(model)} colorOverride="text-text-muted" size={14} />
                      {model === DEFAULT_FALLBACK_MODEL && (
                        <StatusBadge dot={false}>Free default</StatusBadge>
                      )}
                    </div>
                    <div className={styles.poolOrder}>
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
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </article>
    </li>
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
