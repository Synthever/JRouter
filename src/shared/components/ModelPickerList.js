"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import CapacityBadges from "@/shared/components/CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import styles from "./ModelPickerList.module.css";

// Presentational half of the model picker: the search field, the combo row and the
// per-provider model chips. The catalog data itself comes from useModelCatalog, so
// every surface that renders this list (modal or inline popover) behaves identically.
export default function ModelPickerList({
  searchQuery,
  onSearchChange,
  combos,
  groups,
  selectedModel,
  addedModelValues = [],
  onSelect,
  showSearch = true,
  autoFocusSearch = false,
  groupLimit = 0,
  emptyLabel = "No models found",
}) {
  const { getCaps } = useModelCaps();
  const groupEntries = Object.entries(groups);
  const shownGroups = groupLimit > 0 ? groupEntries.slice(0, groupLimit) : groupEntries;
  const hasResults = combos.length > 0 || groupEntries.length > 0;

  return (
    <>
      {showSearch ? (
        <div className={styles.search}>
          <Icon className={styles.searchIcon}>search</Icon>
          <input
            type="text"
            placeholder="Search models, providers, combos"
            aria-label="Search models"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className={styles.searchInput}
            autoFocus={autoFocusSearch}
          />
        </div>
      ) : null}

      <div className={styles.scroll} data-model-scroll>
        {combos.length > 0 ? (
          <div className={styles.group}>
            <p className={styles.groupHead} data-model-group>
              <Icon className={styles.groupIcon}>layers</Icon>
              <span className={styles.groupName}>Combos</span>
              <span className={styles.groupCount}>{combos.length}</span>
            </p>
            <div className={styles.chips}>
              {combos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <button
                    key={combo.id || combo.name}
                    type="button"
                    data-model-option
                    aria-pressed={isSelected || addedModelValues.includes(combo.name)}
                    onClick={() => onSelect(
                      { id: combo.name, name: combo.name, value: combo.name },
                      { providerId: "combo", name: "Combos", isCombo: true }
                    )}
                    className={styles.chip}
                  >
                    <span className={styles.chipLabel}>{combo.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {shownGroups.map(([providerId, group]) => (
          <div key={providerId} className={styles.group}>
            <p className={styles.groupHead} data-model-group>
              <ProviderIcon
                providerId={providerId}
                src={`/providers/${providerId}.png`}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                fallbackColor={group.color}
              />
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.models.length}</span>
            </p>
            <div className={styles.chips}>
              {group.models.map((model) => {
                const isSelected = selectedModel === model.value;
                const isAdded = addedModelValues.includes(model.value);
                return (
                  <button
                    key={model.value}
                    type="button"
                    data-model-option
                    aria-pressed={isSelected || isAdded}
                    title={model.isPlaceholder ? "Select to pre-fill, then edit the model id" : undefined}
                    onClick={() => onSelect(model, { providerId, name: group.name, color: group.color })}
                    className={styles.chip}
                  >
                    {isAdded && !model.isPlaceholder ? <Icon className={styles.chipCheck}>check</Icon> : null}
                    {model.isPlaceholder ? <Icon className={styles.chipHint}>edit</Icon> : null}
                    <span className={styles.chipLabel}>{model.name}</span>
                    {model.isCustom ? <span className={styles.chipTag}>custom</span> : null}
                    <CapacityBadges caps={getCaps(model.value)} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {!hasResults ? (
          <div className={styles.empty}>
            <Icon className={styles.emptyIcon}>search_off</Icon>
            <p>{emptyLabel}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

ModelPickerList.propTypes = {
  searchQuery: PropTypes.string,
  onSearchChange: PropTypes.func,
  combos: PropTypes.array,
  groups: PropTypes.object,
  selectedModel: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  onSelect: PropTypes.func.isRequired,
  showSearch: PropTypes.bool,
  autoFocusSearch: PropTypes.bool,
  groupLimit: PropTypes.number,
  emptyLabel: PropTypes.string,
};
