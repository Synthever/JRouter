"use client";

import { cn } from "@/shared/utils/cn";
import styles from "../profile.module.css";

export default function SettingRow({ label, hint, stacked = false, children }) {
  return (
    <div className={cn(styles.settingRow, stacked && styles.settingRowStacked)}>
      <div className={styles.settingText}>
        <p className={styles.settingLabel}>{label}</p>
        {hint ? <p className={styles.settingHint}>{hint}</p> : null}
      </div>
      {children ? <div className={styles.settingControl}>{children}</div> : null}
    </div>
  );
}
