"use client";

import React, { useState, useEffect, useMemo, useId } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Activity } from "lucide-react";
import { AnimatedBackground } from "@/components/core/animated-background";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";
import styles from "./DashboardAnalytics.module.css";

const VIEW_MODES = [
  { value: "requests", label: "Requests", color: "var(--brand-pink)" },
  { value: "tokens", label: "Tokens", color: "var(--brand-lavender)" },
  { value: "cost", label: "Cost", color: "var(--brand-peach)" },
];
const EMPTY_DATA = [];

function formatValue(value, mode) {
  if (mode === "cost") return fmtCost(value);
  if (mode === "tokens") return fmtTokens(value);
  return Math.round(value).toLocaleString();
}

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  const metric = VIEW_MODES.find((item) => item.value === mode);
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{label}</p>
      <div className={styles.tooltipValue}>
        <span className={styles.dot} style={{ backgroundColor: metric.color }} aria-hidden="true" />
        <span>{metric.label}:</span>
        <strong>{formatValue(payload[0].value, mode)}</strong>
      </div>
    </div>
  );
}

export default function ActivityTimelineCard({ period = "7d", refreshVersion = 0 }) {
  const [result, setResult] = useState(null);
  const [viewMode, setViewMode] = useState("requests");
  const headingId = useId();
  // A result belongs to its period and refresh. Hide stale totals while fetching.
  const loading = !result || result.period !== period || result.refreshVersion !== refreshVersion;
  const data = result?.data || EMPTY_DATA;
  const error = !loading && result.error;
  const metric = VIEW_MODES.find((item) => item.value === viewMode);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchData() {
      try {
        const res = await fetch(`/api/usage/chart?period=${period}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Activity request failed (${res.status})`);
        const json = await res.json();
        if (!controller.signal.aborted) {
          setResult({ period, refreshVersion, data: Array.isArray(json) ? json : [], error: false });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to fetch activity chart data:", error);
          setResult({ period, refreshVersion, data: [], error: true });
        }
      }
    }
    fetchData();
    return () => controller.abort();
  }, [period, refreshVersion]);

  const { total, peak, avg } = useMemo(() => {
    if (!data.length) return { total: 0, peak: 0, avg: 0 };
    const values = data.map((item) => Number(item[viewMode] || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    const peak = values.reduce((max, value) => Math.max(max, value), 0);
    return { total, peak, avg: total / values.length };
  }, [data, viewMode]);
  const hasData = data.some((item) => (item[viewMode] || 0) > 0);

  const formatYAxis = (value) => {
    if (viewMode === "cost") return fmtCost(value);
    if (viewMode === "tokens") return fmtTokens(value);
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
  };

  return (
    <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby={headingId} aria-busy={loading}>
      <div className={styles.header}>
        <div>
          <h2 id={headingId} className={styles.title}>Activity</h2>
          <p className={styles.subtitle}>Throughput over time</p>
        </div>
        <AnimatedBackground
          value={viewMode}
          onValueChange={setViewMode}
          aria-label="Activity metric"
          containerClassName={styles.metricControl}
          className={styles.metricHighlight}
        >
          {VIEW_MODES.map((item) => (
            <button
              key={item.value}
              data-id={item.value}
              type="button"
              aria-label={`${item.label} view`}
              className={styles.metricButton}
            >
              <span className={styles.dot} style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </AnimatedBackground>
      </div>

      <dl className={styles.summary} aria-label={`${metric.label} summary`}>
        {[["Total", total], ["Peak", peak], ["Average", avg]].map(([label, value]) => (
          <div key={label} className={styles.summaryItem}>
            <dt>{label}</dt>
            <dd title={loading || error ? undefined : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}>
              {loading || error ? "—" : formatValue(value, viewMode)}
            </dd>
          </div>
        ))}
      </dl>

      <div className={styles.chart}>
        {loading ? (
          <div className={styles.chartState} role="status">Loading timeline telemetry...</div>
        ) : error ? (
          <div className={styles.chartState} role="status">
            <p>Activity could not be loaded</p>
            <p className={styles.stateHint}>Refresh the dashboard to try again.</p>
          </div>
        ) : !hasData ? (
          <div className={styles.chartState} role="status">
            <Activity size={24} aria-hidden="true" />
            <p>No activity recorded for this period</p>
            <p className={styles.stateHint}>
              Send requests to <code>/v1/chat/completions</code> to see real-time volume.
            </p>
          </div>
        ) : (
          <div className={styles.chartPlot}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={data}
                margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                accessibilityLayer
                aria-label={`${metric.label} over time`}
              >
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--text-3)"
                  fontSize={12}
                  fontFamily="var(--font-ui)"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickMargin={10}
                />
                <YAxis
                  stroke="var(--text-3)"
                  fontSize={12}
                  fontFamily="var(--font-ui)"
                  width={viewMode === "cost" ? 72 : 52}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatYAxis}
                  allowDecimals={viewMode !== "requests"}
                />
                <Tooltip cursor={{ fill: "var(--surface-inset)", fillOpacity: 0.45 }} content={<CustomTooltip mode={viewMode} />} />
                <Bar dataKey={viewMode} name={metric.label} fill={metric.color} radius={[8, 8, 0, 0]} maxBarSize={60} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
