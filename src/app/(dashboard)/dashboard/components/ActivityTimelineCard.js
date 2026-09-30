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
import { cn } from "@/shared/utils/cn";
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
    <div className="rounded-lg border border-zinc-800 bg-[#0C0D10]/95 backdrop-blur-md px-3 py-2 shadow-xl text-xs font-mono">
      <div className="text-zinc-500 mb-1 text-[11px]">{label}</div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-white" />
        <span className="text-zinc-400 capitalize">{mode}:</span>
        <span className="text-white font-semibold">
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
    <div className="rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-5 flex flex-col justify-between shadow-xs">
      {/* Card Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              ACTIVITY TIMELINE
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-xs text-zinc-400">Throughput over time</span>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs font-mono">
            <span className="text-zinc-400">
              Total:{" "}
              <strong className="text-white font-semibold">
                {viewMode === "cost" ? fmtCost(total) : viewMode === "tokens" ? fmtTokens(total) : total.toLocaleString()}
              </strong>
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">
              Peak:{" "}
              <strong className="text-zinc-200">
                {viewMode === "cost" ? fmtCost(peak) : viewMode === "tokens" ? fmtTokens(peak) : Math.round(peak).toLocaleString()}
              </strong>
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">
              Avg:{" "}
              <strong className="text-zinc-300">
                {viewMode === "cost" ? fmtCost(avg) : viewMode === "tokens" ? fmtTokens(avg) : Math.round(avg).toLocaleString()}
              </strong>
            </span>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="inline-flex items-center bg-[#101114] border border-zinc-800/80 rounded-lg p-0.5 self-start sm:self-auto shadow-xs">
          {VIEW_MODES.map((m) => {
            const active = viewMode === m.value;
            const IconComp = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setViewMode(m.value)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-[6px] transition-all cursor-pointer",
                  active
                    ? "bg-zinc-800 text-white font-medium border border-zinc-700/60 shadow-xs"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                )}
              >
                <IconComp className="size-3" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[220px] sm:h-[240px]">
        {!mounted || loading ? (
          <div className="w-full h-full flex items-center justify-center text-xs font-mono text-zinc-500 animate-pulse">
            Loading timeline telemetry...
          </div>
        ) : !hasData ? (
          <div className="w-full h-full flex flex-col items-center justify-center border border-dashed border-zinc-800/80 rounded-lg bg-[#0A0B0D] p-6 text-center">
            <Activity className="size-6 text-zinc-600 mb-2" />
            <p className="text-xs font-mono text-zinc-400">No activity recorded for this period</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Send requests to <code className="text-zinc-400 bg-zinc-900 px-1 py-0.5 rounded">/v1/chat/completions</code> to see real-time volume.
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
              <CartesianGrid stroke="#27272A" strokeDasharray="3 3" vertical={false} opacity={0.35} />
              <XAxis
                dataKey="label"
                stroke="#52525B"
                fontSize={10}
                fontFamily="var(--font-geist-mono)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#52525B"
                fontSize={10}
                fontFamily="var(--font-geist-mono)"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatYAxis}
              />
              <Tooltip content={<CustomTooltip mode={viewMode} />} />
              <Area
                type="monotone"
                dataKey={viewMode}
                stroke="#E4E4E7"
                strokeWidth={1.75}
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
