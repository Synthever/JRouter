"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import CapacityBadges from "@/shared/components/CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import styles from "./ModelPickerList.module.css";
import { CAPACITY_META } from "@/shared/constants/models";

function VirtualCapabilities({ caps }) {
  return Object.entries(CAPACITY_META).filter(([key]) => caps?.[key] === true).map(([key, metadata]) => (
    <span key={key} className={styles.capability}>{metadata.label}</span>
  ));
}

// Presentational half of the model picker: the search field, the combo row and the
// per-provider model chips. The catalog data itself comes from useModelCatalog, so
// every surface that renders this list (modal or inline popover) behaves identically.
export default function ModelPickerList({
  searchQuery,
  onSearchChange,
  aliases = [],
  combos = [],
  groups = {},
  loading = false,
  error = "",
  onRetry,
  selectedModel,
  addedModelValues = [],
  onSelect,
  showSearch = true,
  autoFocusSearch = false,
  groupLimit = 0,
  emptyLabel = "No models found",
}) {
  const groupEntries = Object.entries(groups);
  const { getCaps } = useModelCaps({ enabled: groupEntries.some(([, group]) => group.models?.length > 0) });
  const shownGroups = groupLimit > 0 ? groupEntries.slice(0, groupLimit) : groupEntries;
  const hasResults = aliases.length > 0 || combos.length > 0 || groupEntries.some(([, group]) => group.models?.length > 0);

  return (
    <>
      {showSearch ? (
        <div className={styles.search}>
          <Icon className={styles.searchIcon}>search</Icon>
          <input
            type="text"
            placeholder="Search models, aliases, combos, providers"
            aria-label="Search models"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className={styles.searchInput}
            autoFocus={autoFocusSearch}
          />
        </div>
      ) : null}

      <div className={styles.scroll} data-model-scroll aria-busy={loading}>
        {loading ? <p className={styles.status} role="status">Loading models...</p> : null}
        {error ? <div className={styles.status} role="alert">
          <p>{error}</p>
          {onRetry ? <button type="button" className={styles.retry} onClick={onRetry}>Retry</button> : null}
        </div> : null}
        {aliases.length > 0 ? (
          <div className={styles.group}>
            <p className={styles.groupHead} data-model-group>
              <span className={styles.groupName}>Models Aliases</span>
              <span className={styles.groupCount}>{aliases.length}</span>
            </p>
            <div className={styles.chips}>
              {aliases.map(alias => {
                const value = alias.value || alias.id;
                return <button key={value} type="button" data-model-option
                  aria-pressed={selectedModel === value || addedModelValues.includes(value)}
                  onClick={() => onSelect({ ...alias, value }, { providerId: "jrouter", name: "Models Aliases", isAlias: true, isCombo: false, targetType: "alias" })}
                  className={styles.chip}>
                  <span className={styles.chipLabel}>{alias.name}</span>
                  <VirtualCapabilities caps={alias.caps} />
                </button>;
              })}
            </div>
          </div>
        ) : null}
        {combos.length > 0 ? (
          <div className={styles.group}>
            <p className={styles.groupHead} data-model-group>
              <Icon className={styles.groupIcon}>layers</Icon>
              <span className={styles.groupName}>Combos</span>
              <span className={styles.groupCount}>{combos.length}</span>
            </p>
            <div className={styles.chips}>
              {combos.map((combo) => {
                const legacy = combo.isLegacyCombo || (!combo.targetType && !combo.value && !combo.id?.startsWith("jrouter/"));
                const value = legacy ? combo.value || combo.name : combo.value || combo.id;
                const isSelected = selectedModel === value;
                return (
                  <button
                    key={combo.id || combo.name}
                    type="button"
                    data-model-option
                    aria-pressed={isSelected || addedModelValues.includes(value)}
                    onClick={() => onSelect(
                      { ...combo, id: value, value },
                      { providerId: legacy ? "combo" : "jrouter", name: "Combos", isCombo: true, isAlias: false, targetType: "combo" }
                    )}
                    className={styles.chip}
                  >
                    <span className={styles.chipLabel}>{combo.name}</span>
                    {!legacy ? <VirtualCapabilities caps={combo.caps} /> : null}
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

        {!hasResults && !loading && !error ? (
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
  aliases: PropTypes.array,
  loading: PropTypes.bool,
  error: PropTypes.string,
  onRetry: PropTypes.func,
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
