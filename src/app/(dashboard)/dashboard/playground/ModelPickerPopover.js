"use client";

import PropTypes from "prop-types";
import { useEffect, useLayoutEffect, useRef } from "react";
import ModelPickerList from "@/shared/components/ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import styles from "./ModelPickerPopover.module.css";

// Anchored above the composer trigger. The catalog is the same hook the Combos
// dialogs use, so rail counts, aliases and custom models cannot drift.
export default function ModelPickerPopover({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  activeProviders = [],
  modelAliases = {},
  favorites = [],
  onToggleFavorite,
}) {
  const ref = useRef(null);
  const { visibleGroups, filteredCombos, searchQuery, setSearchQuery } = useModelCatalog({
    isOpen,
    activeProviders,
    modelAliases,
  });

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const popover = ref.current;
    if (!popover) return undefined;
    const updateHeight = () => {
      popover.style.setProperty("--picker-max-height", `${Math.max(240, window.innerHeight - 260)}px`);
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

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-label="Select a model">
      <ModelPickerList
        variant="rail"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        combos={filteredCombos}
        groups={visibleGroups}
        selectedModel={selectedModel}
        onSelect={handleSelect}
        autoFocusSearch
        emptyLabel="No model matches that search"
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

ModelPickerPopover.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.array,
  modelAliases: PropTypes.object,
  favorites: PropTypes.arrayOf(PropTypes.string),
  onToggleFavorite: PropTypes.func,
};
