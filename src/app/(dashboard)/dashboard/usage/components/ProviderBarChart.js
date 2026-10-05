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
import { SegmentedControl } from "@/shared/components";
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
    return Object.entries(byProvider)
      .map(([id, data]) => ({
        name: id,
        tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
        requests: data.requests || 0,
      }))
      .filter((d) => d[viewMode] > 0)
        .sort((a, b) => b[viewMode] - a[viewMode])
        .map((row, index) => ({ ...row, fill: getBarColor(index) }));
  }, [byProvider, viewMode]);

  const fmt = viewMode === "tokens" ? formatTokenCount : formatCount;
  const label = viewMode === "tokens" ? "Tokens" : "Requests";
      const chartConfig = { [viewMode]: { label, color: "var(--text)" } };

  return (
    <section className={`ui-card ${styles.section}`} aria-labelledby="usage-provider-heading">
      <div className={styles.sectionHeader}>
        <h2 id="usage-provider-heading" className="ui-eyebrow">By Provider</h2>
        <SegmentedControl
          options={VIEW_MODES}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
          aria-label="Provider breakdown metric"
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
