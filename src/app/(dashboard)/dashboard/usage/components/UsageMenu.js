"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import styles from "../usage.module.css";

/** Themed dropdown: replaces native selects in the Usage controls. */
export default function UsageMenu({
  options = [],
  value = "",
  onChange,
  ariaLabel,
  variant = "control",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      className={`${variant === "pill" ? styles.menuPill : styles.menuControl} ${className}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={styles.menuButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.menuValue}>{current?.label || "—"}</span>
        <Icon className="text-[16px]">{open ? "expand_less" : "expand_more"}</Icon>
      </button>
      {open && (
        <div className={styles.menuList} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={styles.menuOption}
              onClick={() => {
                setOpen(false);
                onChange(option.value);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon className="text-[14px]">check</Icon>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

UsageMenu.propTypes = {
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  ariaLabel: PropTypes.string,
  variant: PropTypes.oneOf(["control", "pill"]),
  className: PropTypes.string,
};
