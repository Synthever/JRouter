"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import Toggle from "@/shared/components/Toggle";
import styles from "../proxy-pools.module.css";

const RELAY_TYPES = new Set(["vercel", "cloudflare", "deno", "netlify"]);

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export default function ProxyPoolRow({
  pool,
  selected,
  testing,
  onSelect,
  onToggleActive,
  onTest,
  onEdit,
  onDelete,
}) {
  const relay = RELAY_TYPES.has(pool.type) ? pool.type : "";
  const status = pool.testStatus || "untested";

  return (
    <div className={styles.row} data-selected={selected ? "true" : "false"}>
      <input
        type="checkbox"
        className={styles.check}
        checked={selected}
        onChange={onSelect}
        aria-label={`Select ${pool.name}`}
      />

      <div className={styles.main}>
        <div className={styles.nameRow}>
          <span className={styles.name} title={pool.name}>{pool.name}</span>
          {relay ? <span className={styles.tag} data-kind="relay">{relay} relay</span> : null}
        </div>
        <span className={styles.url} title={pool.proxyUrl}>{pool.proxyUrl}</span>
        {pool.noProxy ? <span className={styles.meta} title={pool.noProxy}>Bypass: {pool.noProxy}</span> : null}
      </div>

      <div className={`${styles.statusCell} ${styles.colStatus}`}>
        <span className={styles.statusLine}>
          <i className={styles.statusDot} data-status={status} aria-hidden="true" />
          {status}
        </span>
        <span className={styles.activeLine} data-active={pool.isActive ? "true" : "false"}>
          <i className={styles.activeDot} aria-hidden="true" />
          {pool.isActive ? "active" : "inactive"}
        </span>
      </div>

      <div className={`${styles.countCell} ${styles.colCount}`}>
        {pool.boundConnectionCount || 0}
        <small> bound</small>
      </div>

      <div className={`${styles.meta} ${styles.colTested}`}>
        <span title={pool.lastError || ""}>{formatDateTime(pool.lastTestedAt)}</span>
        {pool.lastError ? <span className={styles.errorFlag} title={pool.lastError} aria-label="Last test failed">!</span> : null}
      </div>

      <div className={styles.actions}>
        <Toggle
          size="sm"
          checked={pool.isActive === true}
          onChange={onToggleActive}
          title={pool.isActive ? "Disable" : "Enable"}
        />
        <button
          type="button"
          className={styles.iconButton}
          onClick={onTest}
          disabled={testing}
          aria-label={`Test ${pool.name}`}
          title="Test proxy"
        >
          <Icon className={testing ? styles.spin : undefined}>{testing ? "progress_activity" : "science"}</Icon>
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onEdit}
          aria-label={`Edit ${pool.name}`}
          title="Edit"
        >
          <Icon>edit</Icon>
        </button>
        <button
          type="button"
          className={styles.iconButton}
          data-tone="danger"
          onClick={onDelete}
          aria-label={`Delete ${pool.name}`}
          title="Delete"
        >
          <Icon>delete</Icon>
        </button>
      </div>
    </div>
  );
}

ProxyPoolRow.propTypes = {
  pool: PropTypes.object.isRequired,
  selected: PropTypes.bool,
  testing: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onTest: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
