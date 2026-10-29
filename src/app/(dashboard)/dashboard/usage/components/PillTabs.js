"use client";

import PropTypes from "prop-types";
import styles from "../usage.module.css";

/** Pill tab group matching the Providers/Combos toolbar tabs. */
export default function PillTabs({ options, value = "", onChange, ariaLabel, compact = false, className = "" }) {
  return (
    <div
      className={`${styles.pillTabs} ${compact ? styles.pillTabsCompact : ""} ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.pillTab}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

PillTabs.propTypes = {
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  ariaLabel: PropTypes.string,
  compact: PropTypes.bool,
  className: PropTypes.string,
};
