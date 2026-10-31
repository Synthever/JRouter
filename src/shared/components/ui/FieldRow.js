"use client";

import Icon from "@/shared/components/Icon";
import { cn } from "@/shared/utils/cn";
import styles from "./field.module.css";

/**
 * One settings row: right-aligned label, arrow, control, optional trailing slot.
 * Below 900px the row stacks label-over-control.
 */
export default function FieldRow({ label, hint, aside, className, children }) {
  const withAside = Boolean(aside);
  return (
    <div className={cn(styles.field, withAside && styles.fieldWithAside, className)}>
      <span className={styles.fieldLabel}>{label}</span>
      <Icon className={styles.fieldArrow} aria-hidden="true">arrow_forward</Icon>
      <div className={styles.fieldControl}>{children}</div>
      {withAside ? <div className={styles.fieldAside}>{aside}</div> : null}
      {hint ? <p className={styles.fieldHint}>{hint}</p> : null}
    </div>
  );
}
