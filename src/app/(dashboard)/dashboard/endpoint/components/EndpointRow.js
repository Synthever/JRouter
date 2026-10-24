"use client";
import Icon from "@/shared/components/Icon";

import styles from "../endpoint.module.css";

/** Local endpoint row: label, state badge, URL field and copy control. */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge }) {
  return (
    <div className={styles.localBlock}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>{label}</span>
        {badge ? (
          <span className={`${styles.badge} ${styles.badgeOn}`}>
            <i className={styles.dot} aria-hidden="true" />
            {badge}
          </span>
        ) : null}
      </div>
      <div className={styles.urlBox}>
        <output
          className={`${styles.endpointValue} font-mono`}
          aria-label={`${label} endpoint`}
          tabIndex={0}
        >
          {url}
        </output>
        <button
          type="button"
          onClick={() => onCopy(url, copyId)}
          className={styles.iconButton}
          aria-label={`Copy ${label} endpoint`}
        >
          <Icon className="text-[18px]">{copied === copyId ? "check" : "content_copy"}</Icon>
        </button>
      </div>
    </div>
  );
}
