"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import Modal from "./Modal";
import ModelPickerList from "./ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
  className = "p-4!",
  portal = false,
  notice = "Click to add, click again to remove. Changes are saved automatically.",
}) {
  const { visibleGroups, filteredCombos, searchQuery, setSearchQuery } = useModelCatalog({
    isOpen,
    activeProviders,
    modelAliases,
    kindFilter,
    capFilter,
    addedModelValues,
  });

  // Selection carries the owning provider so callers that need to show the choice
  // outside the modal (e.g. a model picker trigger) do not have to re-derive it.
  const handleSelect = (model, group) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);
    const selection = group
      ? { ...model, providerId: group.providerId, providerName: group.name, providerColor: group.color, isCombo: group.isCombo === true }
      : { ...model };

    if (isAdded && onDeselect) {
      onDeselect(selection);
    } else {
      onSelect(selection);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  const handleClose = () => {
    onClose();
    setSearchQuery("");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="md"
      className={className}
      portal={portal}
      footer={null}
    >
      {/* Info bar */}
      {notice ? (
        <div data-model-notice className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
          <Icon className="text-primary shrink-0" style={{ fontSize: "14px" }}>info</Icon>
          <span>{notice}</span>
        </div>
      ) : null}

      <ModelPickerList
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        combos={filteredCombos}
        groups={visibleGroups}
        selectedModel={selectedModel}
        addedModelValues={addedModelValues}
        onSelect={handleSelect}
      />
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  capFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
  className: PropTypes.string,
  portal: PropTypes.bool,
  notice: PropTypes.string,
};
