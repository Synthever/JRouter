"use client";

import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import { cn } from "@/shared/utils/cn";
import { KPI_ITEMS, KPI_LAYOUT_STORAGE_KEY, sanitizeKpiLayout } from "@/shared/constants/dashboardKpi";
import { AnimatedBackground } from "@/components/core/animated-background";
import styles from "./KpiBentoGrid.module.css";

export function fmtTokens(n) {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtCost(n) {
  if (!n || n <= 0) return "$0.0000";
  return `$${Number(n).toFixed(4)}`;
}

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

const LAYOUT_ENDPOINT = "/api/dashboard/layout";
const PERIOD_LABELS = {
  today: "Today", "24h": "Last 24 hours", "7d": "Last 7 days",
  "30d": "Last 30 days", "60d": "Last 60 days", all: "All time",
};
const DEFAULT_LAYOUT = normalizeLayout(null, KPI_ITEMS);

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Server sync is fire-and-forget: localStorage stays the instant cache, and a
// failed request must never block the grid or lose the user's accepted layout.
function persistLayout(method, layout) {
  if (typeof fetch !== "function") return;
  try {
    const init = { method, cache: "no-store" };
    if (layout) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify({ layout });
    }
    Promise.resolve(fetch(LAYOUT_ENDPOINT, init)).catch(() => {});
  } catch {
    // A throwing fetch (blocked network) is equivalent to an offline browser.
  }
}

function MetricValue({ children, loading, unavailable, lead, title }) {
  if (loading) return <span className={styles.loading} role="status">Loading metric...</span>;
  if (unavailable) return <span className={styles.note}>Unavailable</span>;
  return <p className={cn(styles.value, lead && styles.lead)} title={title}>{children}</p>;
}

export default function KpiBentoGrid({
  stats,
  connectionsCount = 0,
  nodesCount = 0,
  period = "7d",
  onPeriodChange,
  fetching = false,
  loading = false,
  error = "",
  connectionsError = false,
  connectionsLoading = false,
  onRefresh,
}) {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const restored = useRef(false);
  // Snapshot of the local cache at mount, used for the one-time server migration.
  const localLayout = useRef(null);
  // Set as soon as the user commits or resets, so a slow GET cannot overwrite them.
  const layoutTouched = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = browserStorage()?.getItem(KPI_LAYOUT_STORAGE_KEY);
      // Browser-only restoration must follow the server's default-layout render.
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) localLayout.current = sanitizeKpiLayout(parsed);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLayout(normalizeLayout(parsed, KPI_ITEMS));
      }
    } catch {
      // A blocked store or malformed value must not disable the grid.
    }
  }, []);
  useEffect(() => {
    if (typeof fetch !== "function" || typeof AbortController !== "function") return undefined;
    const controller = new AbortController();
    let active = true;
    // The database is canonical across browsers; localStorage only renders instantly.
    fetch(LAYOUT_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then((response) => (response?.ok ? response.json() : null))
      .then((payload) => {
        if (!active || layoutTouched.current) return;
        if (Array.isArray(payload?.layout)) {
          const serverLayout = sanitizeKpiLayout(payload.layout);
          setLayout(serverLayout);
          try {
            browserStorage()?.setItem(KPI_LAYOUT_STORAGE_KEY, JSON.stringify(serverLayout));
          } catch {
            // The database stays authoritative even when the browser cache is blocked.
          }
          return;
        }
        // No server layout yet: push the browser's saved layout up exactly once.
        if (!Array.isArray(localLayout.current)) return;
        persistLayout("PUT", sanitizeKpiLayout(localLayout.current));
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  const saveLayout = (next) => {
    const canonical = normalizeLayout(next, KPI_ITEMS);
    layoutTouched.current = true;
    setLayout(canonical);
    try {
      browserStorage()?.setItem(KPI_LAYOUT_STORAGE_KEY, JSON.stringify(canonical));
    } catch {
      // Keep the accepted layout in memory when browser persistence is unavailable.
    }
    persistLayout("PUT", canonical);
  };
  const resetLayout = () => {
    restored.current = true;
    layoutTouched.current = true;
    localLayout.current = null;
    try {
      browserStorage()?.removeItem(KPI_LAYOUT_STORAGE_KEY);
    } catch {
      // Reset still takes effect for this mount if storage is blocked.
    }
    setLayout(DEFAULT_LAYOUT);
    setLayoutVersion((version) => version + 1);
    persistLayout("DELETE");
  };
  const totalRequests = stats?.totalRequests || 0;
  const promptTokens = stats?.totalPromptTokens || 0;
  const completionTokens = stats?.totalCompletionTokens || 0;
  const totalTokens = promptTokens + completionTokens;
  const totalCost = stats?.totalCost || 0;
  const activeInFlight = (stats?.activeRequests || []).reduce((acc, r) => acc + (r.count || 0), 0);
  const recent = stats?.recentRequests || [];
  const errorCount = recent.filter((r) => r.status && !["ok", "success", "200"].includes(String(r.status))).length;
  const successRate = recent.length ? (((recent.length - errorCount) / recent.length) * 100).toFixed(1) : null;
  const promptPct = totalTokens > 0 ? (promptTokens / totalTokens) * 100 : 0;
  const completionPct = totalTokens > 0 ? (completionTokens / totalTokens) * 100 : 0;
  const avgCostPer1k = totalRequests > 0 ? (totalCost / totalRequests) * 1000 : 0;
  const unavailable = !stats && Boolean(error);
  const ready = !loading && !unavailable;

  const items = [
    {
      ...KPI_ITEMS.find((item) => item.id === "requests"),
      render: (size) => (
        <div className={styles.metric}>
          <MetricValue loading={loading} unavailable={unavailable} lead={size !== "s"} title={totalRequests.toLocaleString()}>
            {totalRequests.toLocaleString()}
          </MetricValue>
          {ready && <div className={styles.note}>
            {activeInFlight > 0 ? <span className={styles.active}>{activeInFlight} in flight</span> : "No requests in flight"}
          </div>}
          {ready && size !== "s" && <p className={styles.context}>
            {totalRequests === 0 ? "Send a request through your endpoint to start tracking usage." : `${Object.keys(stats?.byModel || {}).length} models used in this period`}
          </p>}
        </div>
      ),
    },
    {
      ...KPI_ITEMS.find((item) => item.id === "success"),
      render: () => (
        <div className={styles.metric}>
          <MetricValue loading={loading} unavailable={unavailable}>
            {successRate === null ? <span className={styles.note}>No recent requests</span> : <>{successRate}<span className={styles.unit}>%</span></>}
          </MetricValue>
          {ready && recent.length > 0 && <p className={cn(styles.note, errorCount > 0 && styles.warning)}>{errorCount} failed / {recent.length} recent</p>}
          {ready && <p className={styles.context}>Latest logged requests, across periods</p>}
        </div>
      ),
    },
    {
      ...KPI_ITEMS.find((item) => item.id === "tokens"),
      render: () => (
        <div className={styles.metric}>
          <MetricValue loading={loading} unavailable={unavailable} title={totalTokens.toLocaleString()}>{fmtTokens(totalTokens)}</MetricValue>
          {ready && <>
            <div className={styles.tokenLabels}><span title={promptTokens.toLocaleString()}>In {fmtTokens(promptTokens)}</span><span title={completionTokens.toLocaleString()}>Out {fmtTokens(completionTokens)}</span></div>
            <div className={styles.tokenBar} role="img" aria-label={`${promptTokens.toLocaleString()} input tokens, ${completionTokens.toLocaleString()} output tokens`}>
              <span data-token-segment="input" style={{ width: `${promptPct}%` }} />
              <span data-token-segment="output" style={{ width: `${completionPct}%` }} />
            </div>
          </>}
        </div>
      ),
    },
    {
      ...KPI_ITEMS.find((item) => item.id === "cost"),
      render: () => (
        <div className={styles.metric}>
          <MetricValue loading={loading} unavailable={unavailable}>{fmtCost(totalCost)}</MetricValue>
          {ready && <p className={styles.note}>Avg {fmtCost(avgCostPer1k)} / 1k req</p>}
        </div>
      ),
    },
    {
      ...KPI_ITEMS.find((item) => item.id === "connections"),
      render: () => (
        <div className={styles.metric}>
          <MetricValue loading={connectionsLoading} unavailable={connectionsError}>{connectionsCount}<span className={styles.unit}>active</span></MetricValue>
          {!connectionsLoading && !connectionsError && <p className={styles.note}>{nodesCount} routing nodes</p>}
          {connectionsError && <p className={styles.context}>Could not load connections. Refresh to retry.</p>}
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Dashboard telemetry" aria-busy={fetching}>
      <div className={styles.toolbar}>
        <h2 className={styles.rangeHeading}>{PERIOD_LABELS[period]}</h2>
        <div className={styles.controls}>
          <AnimatedBackground value={period} onValueChange={onPeriodChange} aria-label="Telemetry period"
            containerClassName={cn("dashboard-segmented-control", styles.periods)} className="dashboard-segment-highlight">
            {PERIOD_OPTIONS.map((p) => (
              <button key={p.value} data-id={p.value} type="button" aria-label={`${p.label} telemetry`} className="dashboard-segment">{p.label}</button>
            ))}
          </AnimatedBackground>
          <button type="button" onClick={onRefresh} disabled={fetching} aria-label="Refresh telemetry" aria-busy={fetching} title="Refresh telemetry" className={cn("dashboard-refresh", styles.refresh)}>
            <RefreshCw aria-hidden="true" className={cn("size-4", fetching && "animate-spin motion-reduce:animate-none")} />
          </button>
        </div>
      </div>
      {error && <div className={styles.error} role="alert">{error}{stats ? " Showing the last loaded values." : " Use refresh to retry."}</div>}
      <WidgetGrid key={layoutVersion} items={items} layout={layout} onLayoutChange={setLayout} onLayoutCommit={saveLayout} rowHeight={208} narrowColumns={1} />
      <div className={styles.footer}>
        <p>Drag the grip to move a card. Drag its corner to resize.</p>
        <button type="button" onClick={resetLayout} aria-label="Reset layout" className={styles.reset}>
          <RotateCcw size={14} aria-hidden="true" /> Reset layout
        </button>
      </div>
    </section>
  );
}
