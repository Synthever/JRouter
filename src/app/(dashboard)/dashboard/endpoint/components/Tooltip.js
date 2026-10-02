"use client";
import Icon from "@/shared/components/Icon";
import styles from "../endpoint.module.css";

/** Inline tooltip, Claude Code CLI style */
export default function Tooltip({ text }) {
  return (
    <span className="relative group inline-flex items-center rounded-[var(--r1)] focus-visible:outline-2 focus-visible:outline-text-muted" tabIndex={0} aria-label={text}>
      <Icon className="text-[14px] text-text-muted cursor-help">help</Icon>
      <span className={`${styles.tooltip} pointer-events-none invisible group-hover:visible group-focus:visible`}>
        {text}
      </span>
    </span>
  );
}
