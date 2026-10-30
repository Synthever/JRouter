"use client";

import styles from "../../cli-tools.module.css";

/** A titled block of field rows inside a tool panel. */
export default function FieldGroup({ title, description, children }) {
  return (
    <section className={styles.fieldGroup}>
      {title ? (
        <header className={styles.fieldGroupHeader}>
          <h2 className={styles.fieldGroupTitle}>{title}</h2>
          {description ? <p className={styles.fieldGroupDescription}>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
