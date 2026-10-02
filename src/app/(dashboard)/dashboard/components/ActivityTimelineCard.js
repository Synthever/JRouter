"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Activity, Zap, DollarSign, Layers } from "lucide-react";
import { AnimatedBackground } from "@/components/core/animated-background";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";

const VIEW_MODES = [
  { value: "requests", label: "Requests", icon: Layers },
  { value: "tokens", label: "Tokens", icon: Zap },
  { value: "cost", label: "Cost", icon: DollarSign },
];

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload || !payload.length) return null;
  const val = payload[0].value;
  return (
    <div className="rounded-[var(--r2)] border border-[var(--line-2)] bg-[var(--surface-2)]/95 backdrop-blur-md px-3 py-2 shadow-[var(--shadow-pop)] text-xs font-mono">
      <div className="text-[var(--text-3)] mb-1 text-[11px]">{label}</div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-[var(--text)]" />
        <span className="text-[var(--text-2)] capitalize">{mode}:</span>
        <span className="text-[var(--text)] font-semibold u-tnum">
          {mode === "cost" ? fmtCost(val) : mode === "tokens" ? fmtTokens(val) : Number(val).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export default function ActivityTimelineCard({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("requests");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(Array.isArray(json) ? json : []);
      }
    } catch (e) {
      console.error("Failed to fetch activity chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate stats
  const { total, peak, avg } = useMemo(() => {
    if (!data.length) return { total: 0, peak: 0, avg: 0 };
    const values = data.map((d) => Number(d[viewMode] || 0));
    const sum = values.reduce((a, b) => a + b, 0);
    const max = Math.max(...values, 0);
    const mean = sum / values.length;
    return { total: sum, peak: max, avg: mean };
  }, [data, viewMode]);

  const hasData = data.some((d) => (d[viewMode] || 0) > 0);

  const formatYAxis = (val) => {
    if (viewMode === "cost") return `$${Number(val).toFixed(2)}`;
    if (viewMode === "tokens") return fmtTokens(val);
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return String(val);
  };

  return (
    <div className="ui-card p-5 flex flex-col justify-between">
      {/* Card Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              ACTIVITY TIMELINE
            </span>
            <span className="text-[var(--text-3)]">·</span>
            <span className="text-xs text-[var(--text-3)]">Throughput over time</span>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs font-mono text-[var(--text-2)]">
            <span>
              Total:{" "}
              <strong className="text-[var(--text)] font-semibold u-tnum">
                {viewMode === "cost" ? fmtCost(total) : viewMode === "tokens" ? fmtTokens(total) : total.toLocaleString()}
              </strong>
            </span>
            <span className="text-[var(--text-3)]">·</span>
            <span>
              Peak:{" "}
              <strong className="text-[var(--text)] font-semibold u-tnum">
                {viewMode === "cost" ? fmtCost(peak) : viewMode === "tokens" ? fmtTokens(peak) : Math.round(peak).toLocaleString()}
              </strong>
            </span>
            <span className="text-[var(--text-3)]">·</span>
            <span>
              Avg:{" "}
              <strong className="text-[var(--text)] font-semibold u-tnum">
                {viewMode === "cost" ? fmtCost(avg) : viewMode === "tokens" ? fmtTokens(avg) : Math.round(avg).toLocaleString()}
              </strong>
            </span>
          </div>
        </div>

        {/* View Mode Toggle */}
        <AnimatedBackground
          value={viewMode}
          onValueChange={setViewMode}
          aria-label="Activity metric"
          containerClassName="dashboard-segmented-control self-start sm:self-auto"
          className="dashboard-segment-highlight"
        >
          {VIEW_MODES.map((m) => {
            const IconComp = m.icon;
            return (
              <button
                key={m.value}
                data-id={m.value}
                type="button"
                aria-label={`${m.label} view`}
                className="dashboard-segment"
              >
                <IconComp className="size-3" />
                {m.label}
              </button>
            );
          })}
        </AnimatedBackground>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[220px] sm:h-[240px]">
        {!mounted || loading ? (
          <div className="w-full h-full flex items-center justify-center text-xs font-mono text-[var(--text-3)] animate-pulse">
            Loading timeline telemetry...
          </div>
        ) : !hasData ? (
          <div className="dashboard-card-inset w-full h-full flex flex-col items-center justify-center border border-dashed border-[var(--line)] rounded-[var(--r2)] bg-[var(--surface-inset)] p-6 text-center">
            <Activity className="size-6 text-[var(--text-3)] mb-2" />
            <p className="text-xs font-mono text-[var(--text-2)]">No activity recorded for this period</p>
            <p className="text-[11px] text-[var(--text-3)] mt-1">
              Send requests to <code className="text-[var(--text-2)] bg-[var(--surface-2)] px-1 py-0.5 rounded-[var(--r1)] border border-[var(--line)]">/v1/chat/completions</code> to see real-time volume.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FFFFFF" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="#FFFFFF" stopOpacity={0.00} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255, 255, 255, 0.065)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#6B6B70"
                fontSize={11}
                fontFamily="var(--font-mono)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#6B6B70"
                fontSize={11}
                fontFamily="var(--font-mono)"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatYAxis}
              />
              <Tooltip content={<CustomTooltip mode={viewMode} />} />
              <Area
                type="monotone"
                dataKey={viewMode}
                stroke="#EDEDEE"
                strokeWidth={1.5}
                fillOpacity={1}
                fill="url(#areaGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
