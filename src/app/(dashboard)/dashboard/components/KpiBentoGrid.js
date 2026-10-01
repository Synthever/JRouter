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
        <div className="flex items-center gap-2">
          <div className="ui-eyebrow">
            <span className="lp-eyebrow__dot" />
            <span>Dashboard Telemetry</span>
          </div>
        </div>

        {/* Period filter + Refresh */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center bg-[var(--surface-2)] border border-[var(--line-2)] rounded-[var(--r1)] p-0.5">
            {PERIOD_OPTIONS.map((p) => {
              const active = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onPeriodChange?.(p.value)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded-[4px] transition-all cursor-pointer",
                    active
                      ? "bg-[var(--surface)] text-[var(--text)] font-medium border border-[var(--line-2)] shadow-[var(--shadow-card)]"
                      : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
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
              "h-8 px-2.5 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer disabled:opacity-50",
              fetching && "pointer-events-none"
            )}
          >
            <RefreshCw className={cn("size-3.5", fetching && "animate-spin text-[var(--text)]")} />
          </button>
        </div>
      </div>

      {/* 5 KPI Bento Cards (.grid-stats) */}
      <div className="grid-stats">
        {/* 1. Total Requests */}
        <div className="stat-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              TOTAL REQUESTS
            </span>
            <div className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)]">
              <Layers className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[var(--text)] tracking-tight u-tnum">
              {totalRequests.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-[var(--text-3)]">
              {activeInFlight > 0 ? (
                <>
                  <span className="size-1.5 rounded-full bg-[var(--pos)] animate-pulse" />
                  <span className="text-[var(--pos)] font-medium u-tnum">{activeInFlight} active in-flight</span>
                </>
              ) : (
                <span className="text-[var(--text-3)]">Pipeline idle · Ready</span>
              )}
            </div>
          </div>
        </div>

        {/* 2. Success Rate */}
        <div className="stat-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              SUCCESS RATE
            </span>
            <div className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--pos)]">
              <CheckCircle2 className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[var(--text)] tracking-tight u-tnum flex items-baseline gap-1">
              <span>{successRate}%</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
              {errorCount === 0 ? (
                <>
                  <span className="text-[var(--pos)] font-medium">0 failure signals</span>
                  <span className="text-[var(--text-3)]">·</span>
                  <span className="text-[var(--pos)]">200 OK</span>
                </>
              ) : (
                <span className="text-[var(--warn)] font-medium u-tnum">{errorCount} failure signals</span>
              )}
            </div>
          </div>
        </div>

        {/* 3. Total Tokens */}
        <div className="stat-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              TOTAL TOKENS
            </span>
            <div className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)]">
              <Cpu className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[var(--text)] tracking-tight u-tnum">
              {fmtTokens(totalTokens)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-[var(--text-2)]">
              <span className="flex items-center gap-0.5 text-[var(--text-2)] u-tnum">
                <ArrowUpRight className="size-3 text-[var(--text-3)]" />
                {fmtTokens(promptTokens)} in
              </span>
              <span className="flex items-center gap-0.5 text-[var(--text-2)] u-tnum">
                <ArrowDownLeft className="size-3 text-[var(--pos)]" />
                {fmtTokens(completionTokens)} out
              </span>
            </div>
            {/* Visual ratio bar */}
            <div className="mt-1.5 h-1 w-full bg-[var(--surface-inset)] border border-[var(--line)] rounded-full overflow-hidden flex">
              <div style={{ width: `${promptPct}%` }} className="bg-[var(--text-3)] h-full" title={`Prompt: ${promptPct}%`} />
              <div style={{ width: `${completionPct}%` }} className="bg-[var(--pos)] h-full" title={`Completion: ${completionPct}%`} />
            </div>
          </div>
        </div>

        {/* 4. Estimated Cost */}
        <div className="stat-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              ESTIMATED COST
            </span>
            <div className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)]">
              <DollarSign className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[var(--text)] tracking-tight u-tnum">
              {fmtCost(totalCost)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-[var(--text-3)]">
              <span className="u-tnum">Avg {fmtCost(avgCostPer1k)}/1k req</span>
            </div>
          </div>
        </div>

        {/* 5. Connections & Nodes */}
        <div className="stat-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              CONNECTIONS & NODES
            </span>
            <div className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)]">
              <Server className="size-3.5" />
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold text-[var(--text)] tracking-tight u-tnum">
              {connectionsCount} Active
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-[var(--text-3)]">
              <span className="u-tnum">{nodesCount} routing nodes</span>
              <span className="text-[var(--text-3)]">·</span>
              <span className="text-[var(--pos)] font-medium">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
