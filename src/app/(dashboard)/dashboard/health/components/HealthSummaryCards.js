import { percent, latency } from "./format";
import styles from "../health.module.css";

export default function HealthSummaryCards({ summary }) {
  const cards = [
    ["Overall Availability", percent(summary.availability), "Completed checks · 24 hours", ""],
    ["Healthy", summary.healthy, "Operating normally", "healthy"],
    ["Degraded", summary.degraded, "Needs attention", "degraded"],
    ["Down", summary.down, "Failure threshold reached", "down"],
    ["Average Latency", latency(summary.avgLatencyMs), "Successful checks · 24 hours", ""],
  ];
  return <div className={styles.summary}>{cards.map(([title, value, note, status]) => <div className={`ui-card ${styles.metric}`} key={title}>
    <div className={styles.metricLabel}>{status && <span className={`${styles.dot} ${styles[status]}`} aria-hidden="true" />}{title}</div>
    <div className={`${styles.metricValue} u-tnum`}>{value}</div><p className={styles.muted}>{note}</p>
  </div>)}</div>;
}
