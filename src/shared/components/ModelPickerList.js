"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import AppLogo from "@/shared/components/AppLogo";
import CapacityBadges from "@/shared/components/CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import styles from "./ModelPickerList.module.css";

// Presentational half of the model picker. `variant="chips"` is the compact
// multi-select list used by the endpoint allow-list and the CLI-tool dialogs.
// `variant="rail"` is the two-pane browser used by the Playground and Combos.
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
  variant = "chips",
  favorites = [],
  onToggleFavorite,
}) {
  const { getCaps } = useModelCaps();
  const groupEntries = Object.entries(groups);
  const shownGroups = groupLimit > 0 ? groupEntries.slice(0, groupLimit) : groupEntries;
  const hasResults = combos.length > 0 || groupEntries.length > 0;
  const [railKey, setRailKey] = useState("all");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef(null);
  const rowsRef = useRef(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cursor must restart at the top whenever the query or tab changes
    setCursor(0);
  }, [searchQuery, railKey]);

  const rail = useMemo(() => {
    const comboRows = combos.map((combo) => ({
      key: `combo:${combo.id || combo.name}`,
      kind: "combo",
      model: { id: combo.name, name: combo.name, value: combo.name },
      group: { providerId: "combo", name: "Combos", isCombo: true },
    }));
    const modelRows = shownGroups.flatMap(([providerId, group]) => group.models.map((model) => ({
      key: `${providerId}:${model.value}`,
      kind: "model",
      model,
      group: { providerId, name: group.name, color: group.color },
    })));
    const allRows = [...comboRows, ...modelRows];
    const favoritesSet = new Set(favorites);
    const count = (value) => value === "all"
      ? allRows.length
      : value === "combos"
        ? comboRows.length
        : value === "favorites"
          ? allRows.filter((row) => favoritesSet.has(row.model.value)).length
          : modelRows.filter((row) => row.group.providerId === value).length;

    const entries = [{ key: "all", name: "All models", icon: "layers", count: count("all") }];
    if (count("favorites") > 0) entries.push({ key: "favorites", name: "Favorites", icon: "star", count: count("favorites") });
    if (comboRows.length > 0) entries.push({ key: "combos", name: "Combos", icon: "layers", count: comboRows.length });
    for (const [providerId, group] of shownGroups) {
      entries.push({ key: providerId, name: group.name, count: count(providerId), providerId });
    }

    // Favorites and Combos are conditional entries, so the parked key can stop
    // existing under it (a new query filters it out, the last favourite is
    // un-starred, combos disappear). Resolve it against the computed entries
    // instead of a hard-coded key allow-list.
    const activeKey = entries.some((entry) => entry.key === railKey) ? railKey : "all";
    const rows = activeKey === "all"
      ? allRows
      : activeKey === "combos"
        ? comboRows
        : activeKey === "favorites"
          ? allRows.filter((row) => favoritesSet.has(row.model.value))
          : allRows.filter((row) => row.group.providerId === activeKey);

    return {
      entries,
      rows,
      favoritesSet,
      activeKey,
      // Favorites and Combos are tabs, not providers: only entries carrying a
      // providerId count towards the "Providers (n)" heading.
      providerCount: entries.filter((entry) => entry.providerId).length,
    };
  }, [combos, shownGroups, favorites, railKey]);

  // A tab can vanish (search filter, last favourite un-starred, combos gone).
  // Adjust the parked key during render — React's "adjust state when a prop
  // changes" pattern — so no committed paint ever shows a dead tab (nothing
  // aria-selected, "Models (0)") and a vanished tab cannot pop back later.
  if (rail.activeKey !== railKey) setRailKey(rail.activeKey);

  // Keep the keyboard cursor visible: ArrowDown can walk the highlight below the
  // fold, and Enter must never pick a row the user cannot see.
  useEffect(() => {
    const row = rowsRef.current?.querySelector('[data-cursor="true"]');
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (variant === "rail") {
    const chosen = (value) => selectedModel === value || addedModelValues.includes(value);
    const selectRow = (row) => onSelect(row.model, row.group);
    const activeEntry = rail.entries.find((entry) => entry.key === rail.activeKey);

    const onKeyDown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((index) => Math.max(0, Math.min(rail.rows.length - 1, index + 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const row = rail.rows[cursor];
        if (row) selectRow(row);
      }
    };

    return (
      <div className={styles.railWrap}>
        {showSearch ? (
          <div className={styles.search}>
            <Icon className={styles.searchIcon}>search</Icon>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search model, provider namespace, or variant…"
              aria-label="Search models"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={onKeyDown}
              className={styles.searchInput}
              autoFocus={autoFocusSearch}
            />
          </div>
        ) : null}

        <div className={styles.railBody}>
          <div className={styles.rail} data-picker-rail role="tablist" aria-label="Providers">
            <p className={styles.railHead}>Providers ({rail.providerCount})</p>
            {rail.entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={rail.activeKey === entry.key}
                className={styles.railItem}
                onClick={() => setRailKey(entry.key)}
              >
                <span className={styles.railGlyph}>
                  {entry.providerId ? (
                    <ProviderIcon
                      providerId={entry.providerId}
                      src={`/providers/${entry.providerId}.png`}
                      alt=""
                      size={16}
                      fallbackText={(entry.name || entry.key).slice(0, 2).toUpperCase()}
                    />
                  ) : entry.key === "favorites" ? (
                    <Icon>star</Icon>
                  ) : (
                    <AppLogo size={16} />
                  )}
                </span>
                <span className={styles.railName}>{entry.name}</span>
                <em className={styles.railCount}>{entry.count}</em>
              </button>
            ))}
          </div>

          <div className={styles.rows} role="listbox" aria-label="Models" ref={rowsRef}>
            <p className={styles.rowsHead}>
              {activeEntry ? activeEntry.name : "Models"} ({rail.rows.length})
            </p>
            {rail.rows.length ? rail.rows.map((row, index) => (
              <div
                key={row.key}
                role="option"
                aria-selected={chosen(row.model.value)}
                data-model-row
                data-cursor={index === cursor ? "true" : undefined}
                className={styles.row}
                onMouseEnter={() => setCursor(index)}
                onClick={() => selectRow(row)}
              >
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className={styles.star}
                    aria-pressed={rail.favoritesSet.has(row.model.value)}
                    aria-label={rail.favoritesSet.has(row.model.value) ? "Remove from favorites" : "Add to favorites"}
                    onClick={(event) => { event.stopPropagation(); onToggleFavorite(row.model.value); }}
                  >
                    <Icon>star</Icon>
                  </button>
                ) : null}
                <span className={styles.rowGlyph}>
                  {row.kind === "combo" ? (
                    <Icon>layers</Icon>
                  ) : (
                    <ProviderIcon
                      providerId={row.group.providerId}
                      src={`/providers/${row.group.providerId}.png`}
                      alt={row.group.name}
                      size={20}
                      fallbackText={(row.group.name || row.group.providerId).slice(0, 2).toUpperCase()}
                      fallbackColor={row.group.color}
                    />
                  )}
                </span>
                <b className={styles.rowName}>{row.model.name}</b>
                {row.model.isCustom ? <small className={styles.rowTag}>custom</small> : null}
                {row.model.isPlaceholder ? <Icon className={styles.rowHint}>edit</Icon> : null}
                <CapacityBadges caps={getCaps(row.model.value)} size={13} />
                {chosen(row.model.value) ? <Icon className={styles.rowCheck}>check</Icon> : null}
              </div>
            )) : <p className={styles.rowEmpty}>{emptyLabel}</p>}
          </div>
        </div>
      </div>
    );
  }

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
  variant: PropTypes.oneOf(["chips", "rail"]),
  favorites: PropTypes.arrayOf(PropTypes.string),
  onToggleFavorite: PropTypes.func,
};
