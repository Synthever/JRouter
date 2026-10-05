"use client";
import Icon from "@/shared/components/Icon";

import styles from "../endpoint.module.css";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, actions }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.field}>
        <output
          className={`${styles.endpointValue} font-mono`}
          aria-label={`${label} endpoint`}
          tabIndex={0}
        >
          {url}
        </output>
      </div>
      <button
        onClick={() => onCopy(url, copyId)}
        className={styles.iconButton}
        aria-label={`Copy ${label} endpoint`}
      >
        <Icon className="text-[18px]">{copied === copyId ? "check" : "content_copy"}</Icon>
      </button>
      {actions}
    </div>
  );
}
