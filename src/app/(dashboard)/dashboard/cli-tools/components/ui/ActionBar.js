"use client";

import { Children, cloneElement, isValidElement } from "react";
import { cn } from "@/shared/utils/cn";
import styles from "../../cli-tools.module.css";

/**
 * Sticky footer of a tool panel. The owning card passes its own handlers as
 * children so no state leaves the card.
 *
 * Children are cloned only to append the pill's button class — the cards keep
 * owning their own markup, variants and handlers.
 */
export default function ActionBar({ message, tone = "neutral", busy = false, children }) {
  return (
    <div className={styles.actionBar} aria-busy={busy || undefined}>
      <p
        role="status"
        className={cn(
          styles.actionMessage,
          tone === "success" && styles.actionSuccess,
          tone === "danger" && styles.actionDanger,
        )}
      >
        {message || ""}
      </p>
      <div className={styles.actionButtons}>
        {Children.map(children, (child) =>
          isValidElement(child) ? cloneElement(child, { className: cn(child.props.className, styles.actionButton) }) : child,
        )}
      </div>
    </div>
  );
}
