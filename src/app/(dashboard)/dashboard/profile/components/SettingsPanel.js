"use client";

import Icon from "@/shared/components/Icon";
import styles from "../profile.module.css";

export default function SettingsPanel({ id, title, icon, description, children, actions }) {
  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <h2 id={`${id}-title`} className={styles.panelTitle}>
            <Icon className={styles.panelIcon} aria-hidden="true">{icon}</Icon>
            {title}
          </h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
