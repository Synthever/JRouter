"use client";
import Icon from "@/shared/components/Icon";

import { Input } from "@/shared/components";
import styles from "../endpoint.module.css";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className={styles.row}>
      <span className={`${styles.label} ${
          (badge === "CF" || badge === "TS") ? styles.enabled : ""
        }`}>{label}</span>
      <Input value={url} readOnly className={styles.field} inputClassName="font-mono" aria-label={`${label} endpoint`} />
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
