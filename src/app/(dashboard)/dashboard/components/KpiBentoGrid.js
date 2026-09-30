"use client";

import React from "react";
import {
  Layers,
  CheckCircle2,
  Cpu,
  DollarSign,
  Server,
  RefreshCw,
  TrendingUp,
  Activity,
  ArrowUpRight,
  ArrowDownLeft
} from "lucide-react";
import { cn } from "@/shared/utils/cn";

export function fmtTokens(n) {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtCost(n) {
  if (!n || n <= 0) return "$0.0000";
  return `$${Number(n).toFixed(4)}`;
}

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function KpiBentoGrid({
  stats,
  connectionsCount = 0,
  nodesCount = 0,
  period = "7d",
  onPeriodChange,
  fetching = false,
  onRefresh
}) {
  const totalRequests = stats?.totalRequests || 0;
  const promptTokens = stats?.totalPromptTokens || 0;
  const completionTokens = stats?.totalCompletionTokens || 0;
  const totalTokens = promptTokens + completionTokens;
  const totalCost = stats?.totalCost || 0;

  // Active in-flight requests
  const activeInFlight = (stats?.activeRequests || []).reduce((acc, r) => acc + (r.count || 0), 0);

  // Success rate estimation based on recent logs / requests
  const recent = stats?.recentRequests || [];
  const errorCount = recent.filter(r => r.status && r.status !== "ok" && r.status !== "success" && r.status !== "200").length;
  const sampleSize = recent.length || 1;
  const successRate = recent.length > 0
    ? (((sampleSize - errorCount) / sampleSize) * 100).toFixed(1)
    : "100.0";

  // Prompt / Completion ratio for visual bar
  const promptPct = totalTokens > 0 ? Math.round((promptTokens / totalTokens) * 100) : 50;
  const completionPct = 100 - promptPct;

  // Cost per 1k requests
  const avgCostPer1k = totalRequests > 0 ? (totalCost / totalRequests) * 1000 : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Top Header & Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-mono text-[11px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              GATEWAY // TELEMETRY
            </span>
          </div>
          <span className="hidden sm:inline-block text-zinc-700">·</span>
          <span className="hidden sm:inline-block font-mono text-[11px] text-zinc-500">
            PORT 20128
          </span>
        </div>

        {/* Period filter + Refresh */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center bg-[#101114] border border-zinc-800/80 rounded-lg p-0.5 shadow-xs">
            {PERIOD_OPTIONS.map((p) => {
              const active = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onPeriodChange?.(p.value)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded-[6px] transition-all cursor-pointer",
                    active
                      ? "bg-zinc-800 text-white font-medium shadow-xs border border-zinc-700/60"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={fetching}
            title="Refresh telemetry"
            className={cn(
              "size-8 rounded-lg border border-zinc-800/80 bg-[#101114] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors cursor-pointer disabled:opacity-50",
              fetching && "pointer-events-none"
            )}
          >
            <RefreshCw className={cn("size-3.5", fetching && "animate-spin text-zinc-200")} />
          </button>
        </div>
      </div>

      {/* 5 KPI Bento Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* 1. Total Requests */}
        <div className="relative rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-4 flex flex-col justify-between overflow-hidden shadow-xs hover:border-zinc-700/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              TOTAL REQUESTS
            </span>
            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
              <Layers className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-white tracking-tight tabular-nums">
              {totalRequests.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-zinc-400">
              {activeInFlight > 0 ? (
                <>
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-medium">{activeInFlight} active in-flight</span>
                </>
              ) : (
                <span className="text-zinc-500">Pipeline idle · Ready</span>
              )}
            </div>
          </div>
        </div>

        {/* 2. Success Rate */}
        <div className="relative rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-4 flex flex-col justify-between overflow-hidden shadow-xs hover:border-zinc-700/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              SUCCESS RATE
            </span>
            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 text-emerald-400">
              <CheckCircle2 className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-white tracking-tight tabular-nums flex items-baseline gap-1">
              <span>{successRate}%</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
              {errorCount === 0 ? (
                <span className="text-emerald-400/90 font-medium">0 failure signals</span>
              ) : (
                <span className="text-amber-400 font-medium">{errorCount} failure signals</span>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500">HTTP 200 OK</span>
            </div>
          </div>
        </div>

        {/* 3. Total Tokens */}
        <div className="relative rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-4 flex flex-col justify-between overflow-hidden shadow-xs hover:border-zinc-700/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              TOTAL TOKENS
            </span>
            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
              <Cpu className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-white tracking-tight tabular-nums">
              {fmtTokens(totalTokens)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span className="flex items-center gap-0.5 text-zinc-300">
                <ArrowUpRight className="size-3 text-zinc-400" />
                {fmtTokens(promptTokens)} in
              </span>
              <span className="flex items-center gap-0.5 text-zinc-300">
                <ArrowDownLeft className="size-3 text-emerald-400" />
                {fmtTokens(completionTokens)} out
              </span>
            </div>
            {/* Visual ratio bar */}
            <div className="mt-1.5 h-1 w-full bg-zinc-800 rounded-full overflow-hidden flex">
              <div style={{ width: `${promptPct}%` }} className="bg-zinc-500 h-full" title={`Prompt: ${promptPct}%`} />
              <div style={{ width: `${completionPct}%` }} className="bg-emerald-400 h-full" title={`Completion: ${completionPct}%`} />
            </div>
          </div>
        </div>

        {/* 4. Estimated Cost */}
        <div className="relative rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-4 flex flex-col justify-between overflow-hidden shadow-xs hover:border-zinc-700/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              ESTIMATED COST
            </span>
            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
              <DollarSign className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-white tracking-tight tabular-nums">
              {fmtCost(totalCost)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-zinc-400">
              <span className="text-zinc-400">Avg {fmtCost(avgCostPer1k)}/1k req</span>
            </div>
          </div>
        </div>

        {/* 5. Connections & Nodes */}
        <div className="relative rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-4 flex flex-col justify-between overflow-hidden shadow-xs hover:border-zinc-700/80 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              CONNECTIONS & NODES
            </span>
            <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
              <Server className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-white tracking-tight tabular-nums">
              {connectionsCount} Active
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-zinc-400">
              <span>{nodesCount} routing nodes</span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-400 font-medium">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
