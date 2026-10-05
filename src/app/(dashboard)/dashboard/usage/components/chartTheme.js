"use client";

// Chart tokens shared with the Dashboard's ActivityTimelineCard: the curve and its
// gradient use the theme foreground, axes use --text-2, and the grid uses --line, so
// charts follow light/dark themes instead of carrying their own palette.
export const CHART_GRID_STROKE = "var(--line)";
export const CHART_AXIS_STROKE = "var(--text-2)";
export const CHART_SERIES_STROKE = "var(--text)";
export const CHART_BAR_FILL = "var(--text-2)";

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

export function ChartTooltip({ active, payload, label, format, name }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-[var(--r2)] border border-[var(--line-2)] bg-[var(--surface-2)]/95 px-3 py-2 text-xs font-mono shadow-[var(--shadow-pop)] backdrop-blur-md">
      {label !== undefined && label !== "" && (
        <div className="mb-1 text-[11px] text-[var(--text-3)]">{label}</div>
      )}
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-[var(--text)]" aria-hidden="true" />
        <span className="text-[var(--text-2)]">{name}:</span>
        <span className="font-semibold text-[var(--text)] u-tnum">{format(payload[0].value)}</span>
      </div>
    </div>
  );
}

export const formatTokenCount = (n) => {
  const value = Number(n) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
};

export const formatCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

export const formatCount = (n) => Number(n || 0).toLocaleString();
