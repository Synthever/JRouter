"use client";

export const CHART_GRID_STROKE = "var(--line)";
export const CHART_AXIS_STROKE = "var(--text-2)";
export const CHART_SERIES_STROKE = "var(--text)";

// Entity identities keep one stable brand color each; status colors stay reserved.
export const CHART_BAR_COLORS = [
  "var(--brand-teal)",
  "var(--brand-pink)",
  "var(--brand-lavender)",
  "var(--brand-peach)",
  "var(--brand-ochre)",
];

export const getBarColor = (index) => CHART_BAR_COLORS[index % CHART_BAR_COLORS.length];

export const axisProps = {
  stroke: CHART_AXIS_STROKE,
  fontSize: 11,
  fontFamily: "var(--font-ui)",
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

// Stat-card token label: one decimal — 3,840,000,000 reads as "3.8B".
// (An integer "3B" hid the difference between 3.0B and 3.84B in the usage cards.)
export const formatCompactTokens = (n) => {
  const value = Number(n) || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.floor(value));
};

export const formatCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

export const formatCount = (n) => Number(n || 0).toLocaleString();
