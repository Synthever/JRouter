"use client";
import { useId, useState } from "react";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { dateTime, latency, percent, statusLabel } from "./format";
import styles from "../health.module.css";

const ranges = [{ value: "24h", label: "24H" }, { value: "3d", label: "3D" }, { value: "7d", label: "7D" }];
const rangeLabels = { "24h": "24 hours", "3d": "3 days", "7d": "7 days" };

export default function HealthAvailabilityTimeline({ history, range, onRangeChange, title = "Availability", loading = false }) {
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(0);
  const tooltipId = useId();
  const bucket = hovered != null ? history?.buckets[hovered] : null;
  return <section className={styles.timeline} aria-busy={loading}>
    <div className={styles.toolbar}>
      <div><h2 className={styles.sectionTitle}>{title} over the last {rangeLabels[range]}</h2>
        <p className={styles.muted}>{history ? `${dateTime(history.from)} – ${dateTime(history.to)}` : "Loading health history..."}</p></div>
      <div className={styles.actions}><span className={styles.timelineValue}>{percent(history?.availability)}</span><SegmentedControl options={ranges} value={range} onChange={onRangeChange} size="sm" aria-label={`${title} range`} /></div>
    </div>
    <div className={styles.track} onMouseLeave={() => setHovered(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}>
      {(history?.buckets || []).map((item, index) => <button key={item.start} type="button"
        className={`${styles.segment} ${styles[item.status.toLowerCase()]}`} tabIndex={index === focused ? 0 : -1}
        aria-label={`${dateTime(item.start)} to ${dateTime(item.end)}: ${statusLabel(item.status)}, availability ${percent(item.availability)}, average latency ${latency(item.avgLatencyMs)}, ${item.checks} checks, ${item.failures} failed`}
        aria-describedby={hovered === index ? tooltipId : undefined}
        onMouseEnter={() => setHovered(index)} onFocus={() => { setFocused(index); setHovered(index); }} onClick={() => setHovered(index)}
        onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? Math.min(index + 1, history.buckets.length - 1) : event.key === "ArrowLeft" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? history.buckets.length - 1 : null;
          if (next != null) { event.preventDefault(); event.currentTarget.parentElement.children[next]?.focus(); }
          if (event.key === "Escape") setHovered(null);
        }} />)}
    </div>
    <div className={styles.axis}>{history && [0, 1, 2, 3].map((index) => <span key={index}>{index === 3 ? "Now" : new Date(history.from + (history.to - history.from) * index / 3).toLocaleDateString(undefined, { weekday: "short", ...(range === "24h" ? { hour: "numeric" } : { month: "short", day: "numeric" }) })}</span>)}</div>
    <div className={styles.timelineFoot}>
      {bucket ? <div id={tooltipId} role="tooltip" className={styles.tooltip}>
        <strong>{dateTime(bucket.start)} – {dateTime(bucket.end)}</strong>
        <span>{statusLabel(bucket.status)} · Availability {percent(bucket.availability)} · Average latency {latency(bucket.avgLatencyMs)} · {bucket.checks} checks · {bucket.failures} failed</span>
      </div> : <div className={styles.legend}>{["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"].map((status) => <span key={status}><i className={`${styles.dot} ${styles[status.toLowerCase()]}`} />{status === "UNKNOWN" ? "No data" : statusLabel(status)}</span>)}</div>}
    </div>
    {history?.checks === 0 && <p className={styles.muted}>No health history yet. Run a health check to get started.</p>}
  </section>;
}
