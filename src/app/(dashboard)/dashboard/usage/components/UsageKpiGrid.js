"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import { formatCompactTokens } from "./chartTheme";
import styles from "./UsageKpiGrid.module.css";

const LAYOUT_STORAGE_KEY = "jrouter.usage.kpiLayout.v1";

const ITEMS = [
  { id: "requests", title: "Requests", defaultSpan: 2 },
  { id: "tokens", title: "Tokens", defaultSpan: 2 },
  { id: "cost", title: "Cost", defaultSpan: 2 },
  { id: "throughput", title: "Throughput", defaultSpan: 2 },
  { id: "latency", title: "Latency", defaultSpan: 2 },
];

const DEFAULT_LAYOUT = normalizeLayout(null, ITEMS);

// Observed window in seconds, derived from the oldest→newest request in the
// selected period (floored to 1s). Falls back to the period length when the
// window is unreliable (e.g. a single old request).
const PERIOD_SECONDS = { today: 86400, "24h": 86400, "7d": 604800, "30d": 2592000, "60d": 5184000 };
function observedSeconds(stats) {
  const start = stats.periodStart ? new Date(stats.periodStart).getTime() : NaN;
  const end = stats.periodEnd ? new Date(stats.periodEnd).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    // Daily dateKeys are local midnights — include the partial day up to now.
    const now = Date.now();
    const windowEnd = end < now && now - end < 86400 * 1000 ? now : end;
    return Math.max(1, (windowEnd - start) / 1000);
  }
  return PERIOD_SECONDS[stats.period] || 86400;
}

const avgReqSec = (s) => (s.totalRequests > 0 ? s.totalRequests / observedSeconds(s) : 0);
const avgTokensSec = (s) => {
  const total = (s.totalPromptTokens || 0) + (s.totalCompletionTokens || 0);
  return total > 0 ? total / observedSeconds(s) : 0;
};
const avgLatencyMs = (s) => (s.latencySamples > 0 ? s.totalLatencyMs / s.latencySamples : 0);
const perMin = (perSec) => perSec * 60;
const fmtRate = (n) => (n >= 100 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1) : n > 0 ? n.toFixed(2) : "0");
const fmtLatency = (ms) => {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
};

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Usage KPIs as movable, resizable widgets persisted per browser. */
export default function UsageKpiGrid({ stats, period = "today", fetching = false, loading = false }) {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = browserStorage()?.getItem(LAYOUT_STORAGE_KEY);
      // Browser-only restoration must follow the server's default-layout render.
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLayout(normalizeLayout(JSON.parse(saved), ITEMS));
      }
    } catch {
      // A blocked store or malformed value must not disable the grid.
    }
  }, []);

  const saveLayout = (next) => {
    const canonical = normalizeLayout(next, ITEMS);
    setLayout(canonical);
    try {
      browserStorage()?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(canonical));
    } catch {
      // Keep the accepted layout in memory when browser persistence is unavailable.
    }
  };

  const resetLayout = () => {
    restored.current = true;
    try {
      browserStorage()?.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
      // Reset still takes effect for this mount if storage is blocked.
    }
    setLayout(DEFAULT_LAYOUT);
    setLayoutVersion((version) => version + 1);
  };

  const withPeriod = { ...stats, period };
  const totalRequests = stats?.totalRequests || 0;
  const promptTokens = stats?.totalPromptTokens || 0;
  const completionTokens = stats?.totalCompletionTokens || 0;
  const cachedTokens = stats?.totalCachedTokens || 0;
  const totalTokens = promptTokens + completionTokens;
  const totalCost = stats?.totalCost || 0;
  const activeInFlight = (stats?.activeRequests || []).reduce((total, request) => total + (request.count || 0), 0);
  const modelCount = Object.keys(stats?.byModel || {}).length;
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);
  const inputPct = totalTokens > 0 ? (nonCachedInput / totalTokens) * 100 : 0;
  const cachedPct = totalTokens > 0 ? (cachedTokens / totalTokens) * 100 : 0;
  const outputPct = totalTokens > 0 ? (completionTokens / totalTokens) * 100 : 0;

  const items = [
    {
      ...ITEMS.find((item) => item.id === "requests"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value} title={totalRequests.toLocaleString()}>{totalRequests.toLocaleString()}</p>
          <p className={styles.note}>
            {activeInFlight > 0 ? <span className={styles.active}>{activeInFlight} in flight</span> : "No requests in flight"}
          </p>
          <p className={styles.context}>{modelCount} models used in this period</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((item) => item.id === "tokens"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value} title={totalTokens.toLocaleString()}>{formatCompactTokens(totalTokens)}</p>
          <div className={styles.tokenLabels}>
            <span title={promptTokens.toLocaleString()}>In {formatCompactTokens(promptTokens)}</span>
            <span title={cachedTokens.toLocaleString()}>Cached {formatCompactTokens(cachedTokens)}</span>
            <span title={completionTokens.toLocaleString()}>Out {formatCompactTokens(completionTokens)}</span>
          </div>
          <div
            className={styles.tokenBar}
            role="img"
            aria-label={`${promptTokens.toLocaleString()} input (${cachedTokens.toLocaleString()} cached), ${completionTokens.toLocaleString()} output tokens`}
          >
            <span data-token-segment="input" style={{ width: `${inputPct}%` }} />
            <span data-token-segment="cached" style={{ width: `${cachedPct}%` }} />
            <span data-token-segment="output" style={{ width: `${outputPct}%` }} />
          </div>
        </div>
      ),
    },
    {
      ...ITEMS.find((item) => item.id === "cost"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>${totalCost.toFixed(2)}</p>
          <p className={styles.note}>Estimated billing</p>
          <p className={styles.context}>{totalRequests > 0 ? `$${((totalCost / totalRequests) * 1000).toFixed(2)} / 1k requests` : "No priced requests yet"}</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((item) => item.id === "throughput"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>
            {fmtRate(perMin(avgReqSec(withPeriod)))}
            <small className={styles.unit}>req/min</small>
          </p>
          <p className={styles.note}>{formatCompactTokens(perMin(avgTokensSec(withPeriod)))} tokens/min</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((item) => item.id === "latency"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{fmtLatency(avgLatencyMs(withPeriod))}</p>
          <p className={styles.note}>Average response time</p>
          <p className={styles.context}>{stats?.latencySamples ? `${stats.latencySamples.toLocaleString()} samples` : "No latency samples"}</p>
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Usage summary" aria-busy={fetching}>
      <WidgetGrid
        items={items}
        key={layoutVersion}
        layout={layout}
        narrowColumns={1}
        onLayoutChange={setLayout}
        onLayoutCommit={saveLayout}
        rowHeight={208}
      />
      <div className={styles.footer}>
        <p>{fetching && !loading ? <><span className={styles.refreshing} aria-hidden="true" /> Refreshing…</> : "Drag the grip to move a card. Drag its corner to resize."}</p>
        <button type="button" onClick={resetLayout} aria-label="Reset layout" className={styles.reset}>
          <RotateCcw size={14} aria-hidden="true" /> Reset layout
        </button>
      </div>
    </section>
  );
}

UsageKpiGrid.propTypes = {
  stats: PropTypes.object,
  period: PropTypes.string,
  fetching: PropTypes.bool,
  loading: PropTypes.bool,
};
