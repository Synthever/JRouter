"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import PropTypes from "prop-types";
import Badge from "@/shared/components/Badge";
import styles from "../usage.module.css";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) return <span className="ml-1 opacity-30" aria-hidden="true">↕</span>;
  return <span className="ml-1" aria-hidden="true">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

/**
 * Render 4 token or cost cells based on viewMode
 */
function ValueCells({ item, viewMode, isSummary = false }) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className={`${styles.num} ${styles.muted}`}>
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className={`${styles.num} ${styles.muted}`}>
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </td>
        <td className={`${styles.num} ${styles.muted}`}>
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className={`${styles.num} ${styles.total}`}>
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className={`${styles.num} ${styles.muted}`}>
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className={`${styles.num} ${styles.muted}`}>
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </td>
      <td className={`${styles.num} ${styles.muted}`}>
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className={`${styles.num} ${styles.total}`}>
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

ValueCells.propTypes = {
  item: PropTypes.object.isRequired,
  viewMode: PropTypes.string.isRequired,
  isSummary: PropTypes.bool,
};

/**
 * Reusable sortable usage table with expandable group rows.
 *
 * @param {object} props
 * @param {string} props.title - Optional table title
 * @param {Array} props.columns - Column definitions [{field, label}]
 * @param {Array} props.groupedData - Grouped data from groupDataByKey
 * @param {string} props.tableType - Table type key for sort URL params
 * @param {string} props.sortBy - Current sort field
 * @param {string} props.sortOrder - Current sort order
 * @param {function} props.onToggleSort - Sort toggle handler
 * @param {string} props.viewMode - "tokens" or "costs"
 * @param {string} props.storageKey - localStorage key for expanded state
 * @param {function} props.renderGroupLabel - Render group summary first cell content
 * @param {function} props.renderDetailCells - Render detail row custom cells (before value cells)
 * @param {function} props.renderSummaryCells - Render summary row cells after group label (placeholder cols)
 * @param {string} props.emptyMessage - Empty state message
 */
export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(new Set());

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output" },
        { field: "totalTokens", label: "Total" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input" },
      { field: "cachedCost", label: "Cached" },
      { field: "completionTokens", label: "Output" },
      { field: "cost", label: "Total" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <div className="min-w-0">
      {title ? (
        <div className={styles.sectionHeader}>
          <h3 className="ui-eyebrow">{title}</h3>
        </div>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  scope="col"
                  aria-sort={sortBy === col.field ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  className={`${styles.sortable} ${col.align === "right" ? styles.num : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  scope="col"
                  aria-sort={sortBy === col.field ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  className={`${styles.num} ${styles.sortable}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedData.map((group) => {
              const isOpen = expanded.has(group.groupKey);
              return (
                <Fragment key={group.groupKey}>
                  {/* Group summary row */}
                  <tr
                    className="group-summary"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(group.groupKey)}
                  >
                    <td>
                      <div className={styles.panelRow}>
                        <Icon
                          className={`text-[16px] text-[var(--text-2)] transition-transform ${isOpen ? "rotate-90" : ""}`}
                        >
                          chevron_right
                        </Icon>
                        <span className={`${styles.total} ${group.summary.pending > 0 ? styles.pending : ""}`}>
                          {group.groupKey}
                        </span>
                      </div>
                    </td>
                    {renderSummaryCells(group)}
                    <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                  </tr>
                  {/* Detail rows */}
                  {isOpen && group.items.map((item) => (
                    <tr key={`detail-${item.key}`} className="group-detail">
                      {renderDetailCells(item)}
                      <ValueCells item={item} viewMode={viewMode} />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className={styles.empty}>
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string,
  columns: PropTypes.arrayOf(PropTypes.shape({
    field: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    align: PropTypes.string,
  })).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderDetailCells: PropTypes.func.isRequired,
  renderSummaryCells: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtCost, fmtTime };
