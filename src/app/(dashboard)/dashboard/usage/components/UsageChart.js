"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { SegmentedControl, Skeleton } from "@/shared/components";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/shared/components/ui/chart";
import styles from "../usage.module.css";
import {
  axisProps,
  gridProps,
  formatTokenCount,
  formatCost,
  formatCount,
} from "./chartTheme";

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "cost", label: "Cost" },
];

const VIEW_CONFIG = {
  tokens: { dataKey: "tokens", formatter: formatTokenCount, label: "Tokens" },
  requests: { dataKey: "requests", formatter: formatCount, label: "Requests" },
  cost: { dataKey: "cost", formatter: formatCost, label: "Cost" },
};

export default function UsageChart({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(Array.isArray(json) ? json : []);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cfg = VIEW_CONFIG[viewMode];
  const hasData = data.some((d) => (d[cfg.dataKey] || 0) > 0);
  const chartConfig = { volume: { label: cfg.label, color: "var(--text)" } };

  return (
    <section className={`ui-card ${styles.section}`} aria-labelledby="usage-chart-heading">
      <div className={styles.sectionHeader}>
        <div className="min-w-0">
          <h2 id="usage-chart-heading" className="ui-eyebrow flex items-center gap-2">
            <Icon className="text-[16px]">timeline</Icon> Usage Over Time
          </h2>
          <p className={styles.sectionDescription}>Volume trend for the selected period</p>
        </div>
        <SegmentedControl
          options={VIEW_MODES}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
          aria-label="Usage metric"
        />
      </div>

      {loading ? (
        <Skeleton className="h-[220px] w-full" />
      ) : !hasData ? (
        <div className={styles.inset} style={{ height: 220 }}>
          <Icon className="text-[20px] text-[var(--text-3)]">timeline</Icon>
          <p>No usage recorded for this period</p>
          <p className={styles.insetHint}>
            Send requests to{" "}
            <code className={styles.insetCode}>/v1/chat/completions</code> to see volume here.
          </p>
        </div>
      ) : (
        <ChartContainer config={chartConfig} className={styles.chartArea}>
          <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="usageAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-volume)" stopOpacity={0.14} />
                <stop offset="95%" stopColor="var(--color-volume)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
            <YAxis {...axisProps} tickFormatter={cfg.formatter} width={56} />
            <ChartTooltip
              content={
                <ChartTooltipContent nameKey="volume" formatter={(value) => (
                  <>
                    <span className="size-2.5 shrink-0 rounded-[2px] bg-[var(--color-volume)]" aria-hidden="true" />
                    <span className="text-[var(--text-2)]">{cfg.label}</span>
                    <span className="ml-auto font-mono font-medium tabular-nums">{cfg.formatter(value)}</span>
                  </>
                )} />
              }
              cursor={{ stroke: "var(--line-2)" }}
            />
            <Area
              type="monotone"
              dataKey={cfg.dataKey}
              stroke="var(--color-volume)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#usageAreaGradient)"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </section>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
