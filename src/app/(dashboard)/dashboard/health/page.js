"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/shared/components/Button";
import Icon from "@/shared/components/Icon";
import Toggle from "@/shared/components/Toggle";
import { Skeleton } from "@/shared/components/Loading";
import HealthStats from "./components/HealthStats";
import HealthAvailabilityTimeline from "./components/HealthAvailabilityTimeline";
import ModelsHealthTable from "./components/ModelsHealthTable";
import ModelHealthDrawer from "./components/ModelHealthDrawer";
import { latency, readJson } from "./components/format";
import styles from "./health.module.css";

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [range, setRange] = useState("3d");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [testing, setTesting] = useState(new Set());
  const [busyAll, setBusyAll] = useState(false);
  const [progress, setProgress] = useState(null);
  const [selected, setSelected] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const sequence = useRef(0);
  const inFlight = useRef(new Set());
  const batchRunning = useRef(false);
  const abortBatch = useRef(null);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    const requestId = ++sequence.current;
    try {
      const result = await readJson(await fetch(`/api/model-health?range=${range}`, { cache: "no-store" }));
      if (mounted.current && requestId === sequence.current) { setData(result); setError(""); setRefreshVersion((n) => n + 1); }
    } catch (err) { if (mounted.current && requestId === sequence.current) setError(err.message); }
    finally { if (mounted.current && requestId === sequence.current) setLoading(false); }
  }, [range]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abortBatch.current?.abort(); }; }, []);
  useEffect(() => {
    const initial = setTimeout(reload, 0);
    const timer = autoRefresh ? setInterval(() => { if (document.visibilityState === "visible") reload(); }, 30000) : null;
    return () => { clearTimeout(initial); if (timer) clearInterval(timer); };
  }, [reload, autoRefresh]);
  const applyResult = (result) => {
    if (result.model) {
      sequence.current++;
      setData((previous) => previous ? { ...previous, models: previous.models.map((model) => model.id === result.modelId ? result.model : model) } : previous);
      setRefreshVersion((n) => n + 1);
    }
  };
  const testModel = async (model) => {
    if (batchRunning.current || inFlight.current.has(model.id)) return;
    inFlight.current.add(model.id); setTesting(new Set(inFlight.current)); setError(""); setFeedback("");
    try {
      const result = await readJson(await fetch("/api/model-health/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: model.id }) }));
      applyResult(result);
      if (!result.check.success) setError(`${model.name}: ${result.check.errorMessage}`);
      else setFeedback(`${model.name}: health check completed`);
      await reload();
    } catch (err) { setError(err.message); }
    finally { inFlight.current.delete(model.id); if (mounted.current) setTesting(new Set(inFlight.current)); }
  };
  const testAll = async () => {
    if (batchRunning.current || inFlight.current.size) return;
    batchRunning.current = true; setBusyAll(true); setFeedback(""); setError(""); setProgress({ completed: 0, total: data.models.length });
    const controller = new AbortController(); abortBatch.current = controller;
    try {
      const response = await fetch("/api/model-health/check-all", { method: "POST", signal: controller.signal });
      if (!response.ok) { await readJson(response); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", doneEvent = false;
      const consume = (line) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "start") setProgress({ completed: 0, total: event.total });
        if (event.type === "result") { applyResult(event); setProgress({ completed: event.completed, total: event.total }); }
        if (event.type === "done") {
          doneEvent = true;
          const summary = event.summary;
          setFeedback(`Health check completed: ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.down} down, ${summary.unknown} unknown${event.skipped ? `; ${event.skipped} skipped` : ""}`);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop(); lines.forEach(consume);
      }
      consume(buffer + decoder.decode());
      if (!doneEvent) throw new Error("Health check stream interrupted. Refresh to see completed results.");
      await reload();
    } catch (err) { if (err.name !== "AbortError" && mounted.current) setError(err.message); }
    finally { batchRunning.current = false; abortBatch.current = null; if (mounted.current) { setBusyAll(false); setProgress(null); } }
  };
  return <div className={`dashboard-surface ${styles.page}`}>
    <header className={styles.intro}>
      <div>
        <h1 className={styles.title}>Health</h1>
        <p className={styles.sub}>Monitor model availability, latency, and provider reliability.</p>
      </div>
      <div className={styles.actions}>
        <Button className={styles.cta} variant="contrast" loading={busyAll} disabled={!data?.models.length || busyAll || testing.size > 0} onClick={testAll}>{busyAll ? "Testing..." : "Test all models"}</Button>
      </div>
    </header>

    {error && <div role="alert" className={styles.errorBanner}>{error}<Button variant="outline" size="sm" onClick={reload}>Refresh</Button></div>}
    {feedback && <p role="status" className={styles.feedback}>{feedback}</p>}

    {loading && !data ? <div aria-busy="true" aria-label="Loading model health">
      <div className={styles.stats}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className={styles.statSkeleton} />)}</div>
      <Skeleton className="mt-4 h-48 w-full" />
      <Skeleton className="mt-4 h-64 w-full" />
    </div> : data && <>
      <HealthStats
        availabilityValue={data.summary.availability == null ? "No data" : data.summary.availability.toFixed(1)}
        availabilityUnit={data.summary.availability == null ? "" : "%"}
        availabilityNote="Completed checks · 24 hours"
        attentionCount={data.summary.degraded + data.summary.down}
        attentionNote={data.summary.degraded + data.summary.down > 0
          ? `${data.summary.healthy} healthy · ${data.summary.unknown ?? 0} unknown`
          : (data.summary.unknown ?? 0) === data.summary.total
            ? `No checks yet · ${data.summary.total} models`
            : `All ${data.summary.total} models healthy`}
        latencyValue={latency(data.summary.avgLatencyMs)}
        latencyNote="Successful checks · 24 hours"
      />

      <section className={styles.panel} aria-labelledby="availability-panel-title">
        <div className={styles.panelHead}>
          <div className={styles.panelHeadCopy}>
            <h2 className={styles.panelTitle} id="availability-panel-title">
              <Icon className={styles.panelIcon} size={18}>monitoring</Icon>
              Availability
            </h2>
            <p className={styles.panelDesc}>Completed checks over the selected window.</p>
          </div>
        </div>
        <div className={styles.settingsStrip}>
          <div className={styles.setting}>
            <div className={styles.settingCopy}>
              <p className={styles.settingLabel}>Auto refresh</p>
              <p className={styles.settingHint}>Reads stored results every 30 seconds while this tab is visible.</p>
            </div>
            <Toggle checked={autoRefresh} onChange={() => setAutoRefresh((value) => !value)} aria-label="Auto refresh" />
          </div>
          {progress && <div className={styles.setting}>
            <div className={styles.settingCopy}>
              <p className={styles.settingLabel}>Testing</p>
              <p className={styles.settingHint}>{progress.completed} / {progress.total} models checked</p>
            </div>
          </div>}
        </div>
        <HealthAvailabilityTimeline history={data.history} range={range} onRangeChange={(value) => { setLoading(true); setRange(value); }} loading={loading} />
        {(!data.scheduler.available || !data.scheduler.enabled) && <p className={`${styles.alert} ${styles.alertInfo}`}>
          {!data.scheduler.available ? "Scheduled probes require a native SQLite driver. Manual tests are available in this single-process runtime." : "The automatic scheduler is disabled on this server. An authenticated cron can trigger due checks."}
        </p>}
      </section>

      <ModelsHealthTable models={data.models} testing={testing} busyAll={busyAll} onTest={testModel} onSelect={setSelected} />
    </>}
    {selected && <ModelHealthDrawer key={selected.id} selected={selected} onClose={() => setSelected(null)} onTest={testModel} testing={busyAll || testing.has(selected.id)} refreshVersion={refreshVersion} onSaved={reload} modelCount={data?.models.length || 1} />}
  </div>;
}
