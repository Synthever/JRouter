import Button from "@/shared/components/Button";
import { latency } from "./format";
import styles from "../health.module.css";

export default function HealthCheckHistory({ recent, onPageChange, loading }) {
  return <section aria-busy={loading}><h3 className={styles.sectionTitle}>Recent Checks</h3>
    {!recent?.checks.length ? <p className={styles.emptySmall}>No health history yet. Run a health check to get started.</p> : <>
      <div className={styles.tableScroll}><table className={styles.table}><thead><tr>{["Time", "Status", "HTTP", "Latency", "Error", "Key"].map((title) => <th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{recent.checks.map((check) => <tr key={check.id}>
          <td title={new Date(check.checkedAt).toLocaleString()}>{new Date(check.checkedAt).toLocaleTimeString()}<small className={styles.muted}>{new Date(check.checkedAt).toLocaleDateString()}</small></td>
          <td className={check.success ? styles.healthy : styles.down}>{check.success ? "Success" : "Failed"}</td><td>{check.httpStatus ?? "N/A"}</td><td>{latency(check.latencyMs)}</td><td title={check.errorType || ""}>{check.errorMessage || "None"}</td><td>{check.apiKeyId ? "Provider key" : "Public"}</td>
        </tr>)}</tbody></table></div>
      <div className={styles.pagination}><span className={styles.muted}>{(recent.page - 1) * recent.pageSize + 1}–{Math.min(recent.page * recent.pageSize, recent.total)} of {recent.total}</span><div className={styles.actions}>
        <Button size="sm" variant="outline" disabled={loading || recent.page === 1} onClick={() => onPageChange(recent.page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || recent.page * recent.pageSize >= recent.total} onClick={() => onPageChange(recent.page + 1)}>Next</Button>
      </div></div>
    </>}
  </section>;
}
