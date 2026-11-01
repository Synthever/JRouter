"use client";

import StatusLine from "./StatusLine";
import styles from "../profile.module.css";

export default function ActionRow({ message, tone = "neutral", children }) {
  // A panel that ends on a bare status slot (nothing to say, no buttons) would
  // otherwise leave an empty bordered row behind.
  if (!message && !children) return null;
  return (
    <div className={styles.actionRow}>
      <StatusLine message={message} tone={tone} />
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}
