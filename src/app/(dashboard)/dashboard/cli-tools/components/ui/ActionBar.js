"use client";

import { cn } from "@/shared/utils/cn";
import styles from "../../cli-tools.module.css";

/**
 * Sticky footer of a tool panel. The owning card passes its own handlers as
 * children so no state leaves the card.
 */
export default function ActionBar({ message, tone = "neutral", busy = false, children }) {
  return (
    <div className={styles.actionBar} aria-busy={busy ? "true" : "false"}>
      <p
        className={cn(
          styles.actionMessage,
          tone === "success" && styles.actionSuccess,
          tone === "danger" && styles.actionDanger,
        )}
      >
        {message || ""}
      </p>
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}
