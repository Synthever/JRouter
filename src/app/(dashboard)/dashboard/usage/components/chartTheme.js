"use client";

export const CHART_GRID_STROKE = "var(--line)";
export const CHART_AXIS_STROKE = "var(--text-2)";
export const CHART_SERIES_STROKE = "var(--text)";

// Category shades stay neutral; success, warning and danger remain reserved for status.
export const CHART_BAR_COLORS = [
  "var(--text)",
  "var(--text-2)",
  "color-mix(in srgb, var(--text) 80%, var(--surface))",
  "color-mix(in srgb, var(--text) 60%, var(--surface))",
  "color-mix(in srgb, var(--text) 45%, var(--surface))",
];

export const getBarColor = (index) => CHART_BAR_COLORS[index % CHART_BAR_COLORS.length];

export const axisProps = {
  stroke: CHART_AXIS_STROKE,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  tickLine: false,
  axisLine: false,
};

export const gridProps = {
  stroke: CHART_GRID_STROKE,
  strokeDasharray: "3 3",
};

export const formatTokenCount = (n) => {
  const value = Number(n) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
};

export const formatCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

export const formatCount = (n) => Number(n || 0).toLocaleString();
