"use client";

import styles from "./field.module.css";

/** A titled block of field rows inside a tool panel or settings section. */
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
