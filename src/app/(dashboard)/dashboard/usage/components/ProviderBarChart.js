"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import Icon from "@/shared/components/Icon";
import PillTabs from "./PillTabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/shared/components/ui/chart";
import styles from "../usage.module.css";
import {
  axisProps,
  gridProps,
  getBarColor,
  formatTokenCount,
  formatCount,
} from "./chartTheme";

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
];

export default function ProviderBarChart({ byProvider }) {
  const [viewMode, setViewMode] = useState("tokens");

  const chartData = useMemo(() => {
    if (!byProvider) return [];
    // Group by the resolved label: byProvider is keyed by provider id, and a
    // deleted custom node's id must never be the axis tick.
    const grouped = new Map();
    for (const [id, data] of Object.entries(byProvider)) {
      const name = data?.label || id;
      const entry = grouped.get(name) || { name, tokens: 0, requests: 0 };
      entry.tokens += (data?.promptTokens || 0) + (data?.completionTokens || 0);
      entry.requests += data?.requests || 0;
      grouped.set(name, entry);
    }
    return [...grouped.values()]
      .filter((d) => d[viewMode] > 0)
        .sort((a, b) => b[viewMode] - a[viewMode])
        .map((row, index) => ({ ...row, fill: getBarColor(index) }));
  }, [byProvider, viewMode]);

  const fmt = viewMode === "tokens" ? formatTokenCount : formatCount;
  const label = viewMode === "tokens" ? "Tokens" : "Requests";
      const chartConfig = { [viewMode]: { label, color: "var(--text)" } };

  return (
    <section className={`${styles.section}`} aria-labelledby="usage-provider-heading">
      <div className={styles.sectionHeader}>
        <h2 id="usage-provider-heading" className={styles.sectionTitle}>
          <Icon className={styles.sectionIcon}>bar_chart</Icon>
          By provider
        </h2>
        <PillTabs
          options={VIEW_MODES}
          value={viewMode}
          onChange={setViewMode}
          ariaLabel="Provider breakdown metric"
          compact
        />
      </div>

      {!chartData.length ? (
        <div className={styles.inset} style={{ height: 180 }}>No provider usage yet</div>
      ) : (
        <ChartContainer config={chartConfig} className={styles.chartArea} style={{ height: 180 }}>
          <BarChart accessibilityLayer data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis
              dataKey="name"
              {...axisProps}
              interval={0}
              tickFormatter={(v) => (v.length > 10 ? v.slice(0, 10) + "…" : v)}
            />
            <YAxis {...axisProps} tickFormatter={fmt} width={56} />
            <ChartTooltip
              content={<ChartTooltipContent />}
              cursor={{ fill: "color-mix(in srgb, var(--text) 4%, transparent)" }}
            />
            <Bar dataKey={viewMode} fill={`var(--color-${viewMode})`} maxBarSize={56} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
    </section>
  );
}

ProviderBarChart.propTypes = {
  byProvider: PropTypes.object,
};
