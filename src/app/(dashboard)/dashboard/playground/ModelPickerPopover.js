"use client";

import PropTypes from "prop-types";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import ModelPickerList from "@/shared/components/ModelPickerList";
import styles from "./ModelPickerPopover.module.css";

// Anchored model picker for the Playground toolbar. It is the exact catalog the
// Modal-based "Add Model to Combo" picker uses (same hook, same list), just rendered
// as a popover next to the trigger instead of a centered dialog.
export default function ModelPickerPopover({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  activeProviders = [],
  modelAliases = {},
  catalog: externalCatalog,
  role = "dialog",
}) {
  const ref = useRef(null);
  const internalCatalog = useModelCatalog({
    isOpen: isOpen && !externalCatalog,
    activeProviders,
    modelAliases,
    catalogContext: "invocation",
  });
  const catalog = externalCatalog || internalCatalog;
  const { visibleGroups = {}, filteredAliases = [], filteredCombos = [], searchQuery = "", setSearchQuery = () => {}, loading = false, error = "", reload } = catalog;

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const popover = ref.current;
    const updateHeight = () => {
      const top = popover.offsetParent.getBoundingClientRect().top + popover.offsetTop;
      popover.style.setProperty("--picker-max-height", `${Math.max(0, window.innerHeight - top - 12)}px`);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (ref.current?.contains(target)) return;
      // The trigger toggles the popover itself, so let it handle its own click.
      if (target?.closest?.("[data-model-trigger]")) return;
      setSearchQuery("");
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setSearchQuery("");
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, setSearchQuery]);

  if (!isOpen) return null;

  const handleSelect = (model, group) => {
    setSearchQuery("");
    onSelect({
      ...model,
      providerId: group?.providerId || "",
      providerName: group?.name || "",
      providerColor: group?.color || "",
      isCombo: group?.isCombo === true,
    });
  };

  const providerCount = Object.keys(visibleGroups).length;

  return (
    <div ref={ref} className={styles.popover} role={role} aria-label="Select a model">
      <ModelPickerList
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        aliases={filteredAliases}
        combos={filteredCombos}
        groups={visibleGroups}
        selectedModel={selectedModel}
        onSelect={handleSelect}
        autoFocusSearch
        emptyLabel="No model matches that search"
        loading={loading}
        error={error}
        onRetry={reload}
      />

      <p className={styles.footer}>
        <span className={styles.footerText}>
          {providerCount > 0
            ? `${providerCount} provider${providerCount === 1 ? "" : "s"} connected`
            : "No providers connected"}
        </span>
        <span className={styles.footerHint}>Esc</span>
      </p>
    </div>
  );
}

ModelPickerPopover.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedModel: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      value: PropTypes.string,
      providerId: PropTypes.string,
    }),
  ]),
  activeProviders: PropTypes.array,
  modelAliases: PropTypes.object,
  catalog: PropTypes.object,
  role: PropTypes.string,
};
