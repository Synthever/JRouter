"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { fmtTokens, fmtCost, fmt } from "./DashboardStatCards";

const VIEW_MODES = [
  { value: "all", label: "Combined" },
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
];

function CustomChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-[var(--r2)] bg-[var(--surface)] border border-[var(--line-2)] p-3 shadow-[var(--shadow-pop)] min-w-[170px] backdrop-blur-md">
      <div className="text-[11px] font-mono text-[var(--text-3)] border-b border-[var(--line)] pb-1.5 mb-2 flex items-center justify-between">
        <span>TIMESTAMP</span>
        <span className="text-[var(--text)] font-medium">{label}</span>
      </div>
      <div className="space-y-1.5">
        {payload.map((entry, idx) => {
          let formattedValue = entry.value;
          let labelText = entry.name;
          if (entry.dataKey === "tokens") formattedValue = fmtTokens(entry.value);
          else if (entry.dataKey === "requests") formattedValue = `${fmt(entry.value)} reqs`;
          else if (entry.dataKey === "cost") formattedValue = fmtCost(entry.value);

          return (
            <div key={idx} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-[var(--text-2)] capitalize">{labelText}</span>
              </div>
              <span className="font-mono font-medium u-tnum text-[var(--text)]">
                {formattedValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

CustomChartTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string,
};

export default function ActivityChart({ data = [], loading = false, period = "7d" }) {
  const [viewMode, setViewMode] = useState("all");

  const hasData = useMemo(() => {
    return Array.isArray(data) && data.some((d) => (d.requests || 0) > 0 || (d.tokens || 0) > 0 || (d.cost || 0) > 0);
  }, [data]);

  const summary = useMemo(() => {
    if (!Array.isArray(data)) return { totalReqs: 0, totalTokens: 0, totalCost: 0 };
    return data.reduce(
      (acc, d) => ({
        totalReqs: acc.totalReqs + (d.requests || 0),
        totalTokens: acc.totalTokens + (d.tokens || 0),
        totalCost: acc.totalCost + (d.cost || 0),
      }),
      { totalReqs: 0, totalTokens: 0, totalCost: 0 }
    );
  }, [data]);

  return (
    <div className="flex min-w-0 flex-col rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] p-4 sm:p-5">
      {/* Header with Title and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--pos)]" />
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Activity Over Time
            </h2>
          </div>
          <p className="text-xs text-[var(--text-3)] font-mono">
            {period === "today" || period === "24h"
              ? "Hourly timeline of requests, tokens, and billing"
              : "Daily trend of upstream AI traffic"}
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center p-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] self-start sm:self-auto">
          {VIEW_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setViewMode(m.value)}
              className={`px-2.5 py-1 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
                viewMode === m.value
                  ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mini summary strip */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 p-2.5 mb-3 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] text-xs">
        <div>
          <span className="block text-[10px] font-mono text-[var(--text-3)] uppercase tracking-wider">Period Reqs</span>
          <span className="font-mono font-medium u-tnum text-[var(--pos)]">{fmt(summary.totalReqs)}</span>
        </div>
        <div>
          <span className="block text-[10px] font-mono text-[var(--text-3)] uppercase tracking-wider">Period Tokens</span>
          <span className="font-mono font-medium u-tnum text-[var(--text)]">{fmtTokens(summary.totalTokens)}</span>
        </div>
        <div>
          <span className="block text-[10px] font-mono text-[var(--text-3)] uppercase tracking-wider">Period Cost</span>
          <span className="font-mono font-medium u-tnum text-[var(--warn)]">{fmtCost(summary.totalCost)}</span>
        </div>
      </div>

      {/* Chart Canvas */}
      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-2">
          <div className="w-5 h-5 border-2 border-[var(--line-2)] border-t-[var(--text)] rounded-full animate-spin" />
          <span className="font-mono">Loading activity timeline...</span>
        </div>
      ) : !hasData ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-1.5 border border-dashed border-[var(--line)] rounded-[var(--r2)]">
          <span className="material-symbols-outlined text-[28px] opacity-40">timeline</span>
          <span className="font-mono">No request activity recorded for this period</span>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="actGradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="actGradRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34D39A" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34D39A" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="actGradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F2B34B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F2B34B" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" vertical={false} />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255, 255, 255, 0.08)" }}
                interval="preserveStartEnd"
              />

              {viewMode === "all" ? (
                <>
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                    width={45}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtCost(v)}
                    width={45}
                  />
                </>
              ) : viewMode === "tokens" ? (
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtTokens}
                  width={55}
                />
              ) : viewMode === "cost" ? (
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtCost}
                  width={55}
                />
              ) : (
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmt}
                  width={45}
                />
              )}

              <Tooltip content={<CustomChartTooltip />} />

              {(viewMode === "all" || viewMode === "requests") && (
                <Area
                  yAxisId={viewMode === "all" ? "left" : undefined}
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke="#34D39A"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#actGradRequests)"
                />
              )}

              {(viewMode === "all" || viewMode === "tokens") && (
                <Area
                  yAxisId={viewMode === "all" ? "left" : undefined}
                  type="monotone"
                  dataKey="tokens"
                  name="Tokens"
                  stroke="#38BDF8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#actGradTokens)"
                />
              )}

              {(viewMode === "all" || viewMode === "cost") && (
                <Area
                  yAxisId={viewMode === "all" ? "right" : undefined}
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="#F2B34B"
                  strokeWidth={1.5}
                  fillOpacity={1}
                  fill="url(#actGradCost)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

ActivityChart.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      requests: PropTypes.number,
      tokens: PropTypes.number,
      cost: PropTypes.number,
    })
  ),
  loading: PropTypes.bool,
  period: PropTypes.string,
};
