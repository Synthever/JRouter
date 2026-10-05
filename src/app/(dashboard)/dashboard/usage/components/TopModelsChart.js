"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SegmentedControl } from "@/shared/components";
import styles from "../usage.module.css";
import {
  axisProps,
  gridProps,
  ChartTooltip,
  CHART_BAR_FILL,
  formatTokenCount,
  formatCount,
} from "./chartTheme";

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
];

const truncate = (s, max = 22) => (s && s.length > max ? s.slice(0, max) + "…" : s || "");

export default function TopModelsChart({ byModel }) {
  const [viewMode, setViewMode] = useState("tokens");

  const chartData = useMemo(() => {
    if (!byModel) return [];
    return Object.values(byModel)
      .map((data) => ({
        name: truncate(data.rawModel || "Unknown"),
        tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
        requests: data.requests || 0,
      }))
      .filter((d) => d[viewMode] > 0)
      .sort((a, b) => b[viewMode] - a[viewMode])
      .slice(0, 5);
  }, [byModel, viewMode]);

  const fmt = viewMode === "tokens" ? formatTokenCount : formatCount;
  const label = viewMode === "tokens" ? "Tokens" : "Requests";

  return (
    <section className={`ui-card ${styles.section}`} aria-labelledby="usage-model-heading">
      <div className={styles.sectionHeader}>
        <h2 id="usage-model-heading" className="ui-eyebrow">Top Models</h2>
        <SegmentedControl
          options={VIEW_MODES}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
          aria-label="Model breakdown metric"
        />
      </div>

      {!chartData.length ? (
        <div className={styles.inset} style={{ height: 180 }}>No model usage yet</div>
      ) : (
        <div className={styles.chartArea} style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
            >
              <CartesianGrid {...gridProps} horizontal={false} />
              <XAxis type="number" {...axisProps} tickFormatter={fmt} />
              <YAxis type="category" dataKey="name" {...axisProps} width={110} />
              <Tooltip
                content={<ChartTooltip format={fmt} name={label} />}
                cursor={{ fill: "color-mix(in srgb, var(--text) 4%, transparent)" }}
              />
              <Bar dataKey={viewMode} fill={CHART_BAR_FILL} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

TopModelsChart.propTypes = {
  byModel: PropTypes.object,
};
