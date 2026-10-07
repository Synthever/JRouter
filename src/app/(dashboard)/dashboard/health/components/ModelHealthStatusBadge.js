import { statusLabel } from "./format";
import styles from "../health.module.css";

export default function ModelHealthStatusBadge({ status = "UNKNOWN" }) {
  return <span className={`${styles.badge} ${styles[status.toLowerCase()] || styles.unknown}`}><span className={styles.dot} aria-hidden="true" />{statusLabel(status)}</span>;
}
