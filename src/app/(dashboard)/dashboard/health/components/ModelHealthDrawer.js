"use client";
import { useEffect, useRef, useState } from "react";
import Drawer from "@/shared/components/Drawer";
import Button from "@/shared/components/Button";
import { Skeleton } from "@/shared/components/Loading";
import ModelHealthStatusBadge from "./ModelHealthStatusBadge";
import HealthAvailabilityTimeline from "./HealthAvailabilityTimeline";
import HealthCheckHistory from "./HealthCheckHistory";
import HealthSettings from "./HealthSettings";
import { latency, percent, readJson, relativeTime } from "./format";
import styles from "../health.module.css";

export default function ModelHealthDrawer({ selected, onClose, onTest, testing, refreshVersion, onSaved }) {
  const [range, setRange] = useState("3d");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const root = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => root.current?.querySelector("button")?.focus());
    const trap = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...(root.current?.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex='0']") || [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [selected.id]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`/api/model-health/model?${new URLSearchParams({ modelId: selected.id, range, page: String(page) })}`, { signal: controller.signal, cache: "no-store" })
      .then(readJson).then((result) => { if (active) { setData(result); setError(""); } })
      .catch((err) => { if (active && err.name !== "AbortError") setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [selected.id, range, page, refreshVersion, retry]);
  const model = data?.model || selected;
  const metrics = [["Provider", model.providerName], ["24H Availability", percent(model.availability)], ["Average Latency", latency(model.avgLatencyMs)], ["P95 Latency", latency(model.p95LatencyMs)], ["Last Successful Check", relativeTime(model.lastSuccessAt)], ["Last Check", relativeTime(model.lastCheckAt)]];
  return <div ref={root} className={styles.drawerScope}><Drawer isOpen onClose={onClose} title={model.name} width="xl" className={styles.drawer}>
    <div className={styles.drawerBody}>
      <div className={styles.toolbar}><div><ModelHealthStatusBadge status={model.status} /><p className={styles.modelId}>{model.modelId}</p></div><Button variant="outline" size="sm" loading={testing} disabled={testing} onClick={() => onTest(model)}>{testing ? "Testing..." : "Test Model"}</Button></div>
      {error && <div role="alert" className={styles.error}>{error} <Button size="sm" variant="outline" onClick={() => { setLoading(true); setRetry((n) => n + 1); }}>Retry</Button></div>}
      {loading && !data ? <><Skeleton className="h-32 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></> : data && <>
        <dl className={styles.detailsGrid}>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className={styles.muted}>{model.failures > 0 ? `${model.failures} consecutive failures. Status changes at the configured failure threshold.` : model.successes > 0 && model.status !== "HEALTHY" ? `Recovering: ${model.successes} / ${model.config.recoveryThreshold} successful checks.` : "Metrics use completed active checks from the last 24 hours."}{model.stale ? " Scheduled results are stale; health is unknown." : ""}</p>
        <HealthAvailabilityTimeline history={data.history} range={range} loading={loading} onRangeChange={(value) => { setLoading(true); setRange(value); }} />
        <HealthCheckHistory recent={data.recent} loading={loading} onPageChange={(value) => { setLoading(true); setPage(value); }} />
        <HealthSettings key={model.id} model={model} onSaved={onSaved} />
      </>}
    </div>
  </Drawer></div>;
}
