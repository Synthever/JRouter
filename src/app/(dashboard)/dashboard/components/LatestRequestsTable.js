"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft, Search, RefreshCw, ExternalLink, Clock, Activity } from "lucide-react";
import { cn } from "@/shared/utils/cn";
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

export default function LatestRequestsTable({ initialRequests = [] }) {
  const [logs, setLogs] = useState(initialRequests);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
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
    <div className="rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-5 shadow-xs">
      {/* Table Header / Action Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              LATEST REQUESTS
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-xs text-zinc-400">Live operational stream</span>
          </div>
          <p className="text-xs text-zinc-500 font-mono mt-0.5">
            Real-time payload inspection & token throughput
          </p>
        </div>

        {/* Filter Input + Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter model / status..."
              className="h-8 pl-8 pr-3 text-xs font-mono bg-[#0A0B0D] border border-zinc-800/80 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-colors w-[180px] sm:w-[220px]"
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "px-2.5 h-8 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer",
              autoRefresh
                ? "bg-zinc-800/80 border-zinc-700 text-emerald-400"
                : "bg-[#0A0B0D] border-zinc-800 text-zinc-400 hover:text-zinc-200"
            )}
            title={autoRefresh ? "Live polling active (6s)" : "Polling paused"}
          >
            <span className={cn("size-1.5 rounded-full", autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-zinc-600")} />
            <span>{autoRefresh ? "Live" : "Paused"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchLogs().finally(() => setLoading(false));
            }}
            className="size-8 rounded-lg border border-zinc-800/80 bg-[#0A0B0D] flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin text-white")} />
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="border-b border-zinc-800/80 text-[11px] text-zinc-400 uppercase tracking-wider">
              <th className="py-2.5 px-3 font-medium w-8">Status</th>
              <th className="py-2.5 px-3 font-medium">Model</th>
              <th className="py-2.5 px-3 font-medium">Provider</th>
              <th className="py-2.5 px-3 font-medium text-right">Tokens In / Out</th>
              <th className="py-2.5 px-3 font-medium text-right">Latency</th>
              <th className="py-2.5 px-3 font-medium text-right">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {filtered.length > 0 ? (
              filtered.slice(0, 15).map((log, i) => {
                const isOk = !log.status || log.status === "ok" || log.status === "success" || log.status === 200 || log.status === "200";
                const isError = log.status && (String(log.status).startsWith("4") || String(log.status).startsWith("5") || log.status === "error");
                const promptTok = log.promptTokens || log.prompt_tokens || 0;
                const compTok = log.completionTokens || log.completion_tokens || 0;
                const duration = log.durationMs || log.duration || 0;

                return (
                  <tr key={log.id || `${log.timestamp}-${i}`} className="hover:bg-zinc-800/30 transition-colors group">
                    {/* Status */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            isOk ? "bg-emerald-400" : isError ? "bg-rose-400" : "bg-amber-400"
                          )}
                        />
                        <span className="text-[10px] text-zinc-400">
                          {isOk ? "200" : log.status || "ERR"}
                        </span>
                      </div>
                    </td>

                    {/* Model */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-semibold text-zinc-100 group-hover:text-white transition-colors" title={log.model}>
                        {log.model || "default"}
                      </span>
                    </td>

                    {/* Provider */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800/70 border border-zinc-700/50 text-[10px] text-zinc-400 uppercase tracking-wider">
                        {log.provider || "gateway"}
                      </span>
                    </td>

                    {/* Tokens */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-2 text-zinc-300">
                        <span className="text-zinc-400 flex items-center">
                          <ArrowUpRight className="size-3 text-zinc-500" />
                          {fmtTokens(promptTok)}
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-emerald-400/90 flex items-center">
                          <ArrowDownLeft className="size-3 text-emerald-500" />
                          {fmtTokens(compTok)}
                        </span>
                      </div>
                    </td>

                    {/* Latency */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-right text-zinc-400">
                      {duration > 0 ? (
                        duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${Math.round(duration)}ms`
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-right text-zinc-500 text-[11px]">
                      {timeAgo(log.timestamp)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-10 text-center text-zinc-400 text-xs">
                  {filter ? "No requests matching filter" : "No recent requests logged yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Navigation */}
      <div className="pt-3 mt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono text-zinc-400">
        <span>Showing {Math.min(filtered.length, 15)} most recent payloads</span>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/usage?tab=details"
            className="text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>Full Usage Logs</span>
            <ExternalLink className="size-3" />
          </Link>
          <span className="text-zinc-700">·</span>
          <Link
            href="/dashboard/console-log"
            className="text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>Console Raw Stream</span>
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
