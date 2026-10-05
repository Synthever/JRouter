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
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SegmentedControl, Skeleton } from "@/shared/components";
import styles from "../usage.module.css";
import {
  axisProps,
  gridProps,
  ChartTooltip,
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

  return (
    <section className={`ui-card ${styles.section}`} aria-labelledby="usage-chart-heading">
      <div className={styles.sectionHeader}>
        <div className="min-w-0">
          <h2 id="usage-chart-heading" className="ui-eyebrow flex items-center gap-2">
            <Icon name="show_chart" className="text-[16px]" /> Usage Over Time
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
          <Icon className="text-[20px] text-[var(--text-3)]">show_chart</Icon>
          <p>No usage recorded for this period</p>
          <p className={styles.insetHint}>
            Send requests to{" "}
            <code className={styles.insetCode}>/v1/chat/completions</code> to see volume here.
          </p>
        </div>
      ) : (
        <div className={styles.chartArea}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="usageAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--text)" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="var(--text)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} tickFormatter={cfg.formatter} width={56} />
              <Tooltip
                content={<ChartTooltip format={cfg.formatter} name={cfg.label} />}
                cursor={{ stroke: "var(--line-2)" }}
              />
              <Area
                type="monotone"
                dataKey={cfg.dataKey}
                stroke="var(--text)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#usageAreaGradient)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
