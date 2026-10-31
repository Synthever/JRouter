"use client";

import StatusLine from "./StatusLine";
import styles from "../profile.module.css";

export default function ActionRow({ message, tone = "neutral", children }) {
  return (
    <div className={styles.actionRow}>
      <StatusLine message={message} tone={tone} />
      <div className={styles.actionButtons}>{children}</div>
    </div>
  );
}
