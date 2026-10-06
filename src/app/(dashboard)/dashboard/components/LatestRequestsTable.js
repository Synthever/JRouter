"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  RefreshCw,
  ExternalLink,
  Table,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/shared/utils/cn";
import { AnimatedBackground } from "@/components/core/animated-background";
import StatusBadge from "@/shared/components/StatusBadge";
import { fmtTokens } from "./KpiBentoGrid";

function timeAgo(timestamp) {
  if (!timestamp) return "just now";
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderStatusBadge(status) {
  const s = String(status || "ok").toLowerCase();
  if (s === "ok" || s === "success" || s === "200") {
    return (
      <StatusBadge variant="success">
        OK
      </StatusBadge>
    );
  }
  if (s === "partial" || s.startsWith("3") || s.includes("stream")) {
    return (
      <StatusBadge variant="warning">
        Partial
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="error">
      {s.startsWith("4") || s.startsWith("5") ? s : "Error"}
    </StatusBadge>
  );
}

export default function LatestRequestsTable({ initialRequests = [] }) {
  const [logs, setLogs] = useState(initialRequests);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [layout, setLayout] = useState("table");

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/request-logs?format=json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data.slice(0, 30));
        }
      }
    } catch (e) {
      console.error("Failed to fetch latest request logs:", e);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Live periodic poll (every 6 seconds if autoRefresh enabled)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Filter logs by model or provider
  const filtered = useMemo(() => {
    if (!filter.trim()) return logs;
    const q = filter.toLowerCase().trim();
    return logs.filter((l) =>
      (l.model && l.model.toLowerCase().includes(q)) ||
      (l.provider && l.provider.toLowerCase().includes(q)) ||
      (l.status && String(l.status).toLowerCase().includes(q))
    );
  }, [logs, filter]);

  return (
    <div className="ui-card p-5 logs-table">
      {/* Table Header / Action Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              LATEST REQUESTS
            </span>
            <span className="text-[var(--text-3)]">·</span>
            <span className="text-xs text-[var(--text-3)]">Live operational stream</span>
          </div>
          <p className="text-xs text-[var(--text-3)] font-mono mt-0.5">
            Real-time payload inspection & token throughput
          </p>
        </div>

        {/* Filter Input + Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap sm:flex-nowrap">
          {/* Dual Layout Toggle */}
          <AnimatedBackground
            value={layout}
            onValueChange={setLayout}
            aria-label="Request logs layout"
            containerClassName="dashboard-segmented-control"
            className="dashboard-segment-highlight"
          >
            <button
              data-id="table"
              type="button"
              aria-label="Table view"
              className="dashboard-segment"
              title="Table View (Desktop analysis)"
            >
              <Table className="size-3.5" />
            </button>
            <button
              data-id="cards"
              type="button"
              aria-label="Cards view"
              className="dashboard-segment"
              title="Cards View (Touch-friendly)"
            >
              <LayoutGrid className="size-3.5" />
            </button>
          </AnimatedBackground>

          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter model / status..."
              className="h-8 pl-8 pr-3 text-xs font-mono bg-[var(--surface-2)] border border-[var(--line-2)] rounded-[var(--r1)] text-[var(--text)] placeholder-[var(--text-3)] focus:outline-none focus:border-[var(--accent-line)] transition-colors w-[160px] sm:w-[200px]"
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "px-2.5 h-8 rounded-[var(--r1)] text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer",
              autoRefresh
                ? "text-[var(--pos)]"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            )}
            title={autoRefresh ? "Live polling active (6s)" : "Polling paused"}
          >
            <span className={cn("size-1.5 rounded-full", autoRefresh ? "bg-[var(--pos)] animate-pulse" : "bg-[var(--text-3)]")} />
            <span>{autoRefresh ? "Live" : "Paused"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchLogs().finally(() => setLoading(false));
            }}
            aria-label="Refresh logs"
            aria-busy={loading}
            className="dashboard-refresh"
            title="Refresh logs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none text-[var(--text)]")} />
          </button>
        </div>
      </div>

      {/* Content: Cards View vs Table View */}
      {layout === "cards" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.length > 0 ? (
            filtered.slice(0, 15).map((log, i) => {
              const promptTok = log.promptTokens || log.prompt_tokens || 0;
              const compTok = log.completionTokens || log.completion_tokens || 0;
              const duration = log.durationMs || log.duration || 0;
              const ttft = log.ttftMs || log.ttft || 0;

              return (
                <div
                  key={log.id || `${log.timestamp}-${i}`}
                  className="dashboard-card-inset p-3.5 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] flex flex-col justify-between gap-3 font-mono text-xs hover:border-[var(--line-2)] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    {renderStatusBadge(log.status)}
                    <span className="text-[var(--text-3)] text-[11px] u-tnum">{timeAgo(log.timestamp)}</span>
                  </div>

                  <div>
                    <div className="font-semibold text-[var(--text)] truncate text-[13px]" title={log.model}>
                      {log.model || "default"}
                    </div>
                    <div className="mt-1">
                      <span className="px-1.5 py-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[10px] text-[var(--text-3)] uppercase tracking-wider">
                        {log.provider || "gateway"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[var(--line)] grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <span className="text-[var(--text-3)] block text-[10px] uppercase">Tokens</span>
                      <span className="text-[var(--text-2)] u-tnum flex items-center gap-0.5 mt-0.5">
                        <span className="text-[var(--text-3)]">{fmtTokens(promptTok)}</span>
                        <span className="text-[var(--text-3)]">/</span>
                        <span className="text-[var(--pos)]">{fmtTokens(compTok)}</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--text-3)] block text-[10px] uppercase">TTFT (ms)</span>
                      <span className="text-[var(--text-2)] u-tnum block mt-0.5">
                        {ttft > 0 ? `${Math.round(ttft)}ms` : "—"}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[var(--text-3)] block text-[10px] uppercase">Latency</span>
                      <span className="text-[var(--text)] u-tnum font-medium block mt-0.5">
                        {duration > 0 ? (duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${Math.round(duration)}ms`) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="dashboard-card-inset col-span-full py-10 text-center text-[var(--text-3)] text-xs font-mono border border-dashed border-[var(--line)] rounded-[var(--r2)] bg-[var(--surface-inset)]">
              {filter ? "No requests matching filter" : "No recent requests logged yet."}
            </div>
          )}
        </div>
      ) : (
        /* High-density Table View */
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--line-2)] text-[11px] text-[var(--text-3)] uppercase tracking-wider">
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Model</th>
                <th className="py-2.5 px-3 font-medium">Provider</th>
                <th className="py-2.5 px-3 font-medium text-right">Tokens In / Out</th>
                <th className="py-2.5 px-3 font-medium text-right">TTFT (ms)</th>
                <th className="py-2.5 px-3 font-medium text-right">Latency (ms)</th>
                <th className="py-2.5 px-3 font-medium text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filtered.length > 0 ? (
                filtered.slice(0, 15).map((log, i) => {
                  const promptTok = log.promptTokens || log.prompt_tokens || 0;
                  const compTok = log.completionTokens || log.completion_tokens || 0;
                  const duration = log.durationMs || log.duration || 0;
                  const ttft = log.ttftMs || log.ttft || 0;

                  return (
                    <tr key={log.id || `${log.timestamp}-${i}`} className="hover:bg-[var(--surface-2)] transition-colors group">
                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {renderStatusBadge(log.status)}
                      </td>

                      {/* Model */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-semibold text-[var(--text)]" title={log.model}>
                          {log.model || "default"}
                        </span>
                      </td>

                      {/* Provider */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[10px] text-[var(--text-3)] uppercase tracking-wider">
                          {log.provider || "gateway"}
                        </span>
                      </td>

                      {/* Tokens */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2 text-[var(--text-2)]">
                          <span className="text-[var(--text-3)] flex items-center u-tnum">
                            <ArrowUpRight className="size-3 text-[var(--text-3)]" />
                            {fmtTokens(promptTok)}
                          </span>
                          <span className="text-[var(--text-3)]">·</span>
                          <span className="text-[var(--pos)] flex items-center u-tnum">
                            <ArrowDownLeft className="size-3 text-[var(--pos)]" />
                            {fmtTokens(compTok)}
                          </span>
                        </div>
                      </td>

                      {/* TTFT */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-right text-[var(--text-3)] u-tnum">
                        {ttft > 0 ? `${Math.round(ttft)}ms` : "—"}
                      </td>

                      {/* Latency */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-right text-[var(--text)] font-medium u-tnum">
                        {duration > 0 ? (
                          duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${Math.round(duration)}ms`
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Timestamp */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-right text-[var(--text-3)] text-[11px] u-tnum">
                        {timeAgo(log.timestamp)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-3)] text-xs">
                    {filter ? "No requests matching filter" : "No recent requests logged yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="pt-3 mt-3 border-t border-[var(--line)] flex items-center justify-between text-xs font-mono text-[var(--text-3)]">
        <span>Showing {Math.min(filtered.length, 15)} most recent payloads</span>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/usage?tab=details"
            className="text-[var(--text-2)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
          >
            <span>Full Usage Logs</span>
            <ExternalLink className="size-3" />
          </Link>
          <span className="text-[var(--text-3)]">·</span>
          <Link
            href="/dashboard/console-log"
            className="text-[var(--text-2)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
          >
            <span>Console Raw Stream</span>
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
