"use client";

import { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { fmt, fmtTokens, fmtCost } from "./DashboardStatCards";

function formatTimestamp(ts) {
  if (!ts) return { time: "-", relative: "" };
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return { time: String(ts).slice(11, 19) || "-", relative: "" };
    const time = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    let relative = `${diffSec}s ago`;
    if (diffSec >= 86400) relative = `${Math.floor(diffSec / 86400)}d ago`;
    else if (diffSec >= 3600) relative = `${Math.floor(diffSec / 3600)}h ago`;
    else if (diffSec >= 60) relative = `${Math.floor(diffSec / 60)}m ago`;
    return { time, relative };
  } catch {
    return { time: "-", relative: "" };
  }
}

export default function LatestRequestsTable({
  requests = [],
  detailedRequests = [],
  loading = false,
  onRefresh,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Merge detailedRequests (richer with latency/ttft) with recentRequests
  const normalizedRequests = useMemo(() => {
    // If detailed requests are present, prefer them
    if (Array.isArray(detailedRequests) && detailedRequests.length > 0) {
      return detailedRequests.map((d) => {
        const promptTokens = d?.tokens?.prompt_tokens ?? d?.tokens?.input_tokens ?? 0;
        const completionTokens = d?.tokens?.completion_tokens ?? d?.tokens?.output_tokens ?? 0;
        const totalLatency = d?.latency?.total ?? d?.latency?.duration ?? null;
        const ttft = d?.latency?.ttft ?? null;
        const ok = !d?.status || d?.status === "ok" || d?.status === "success" || d?.status === 200;

        return {
          id: d?.id || `${d?.timestamp}-${d?.model}`,
          timestamp: d?.timestamp,
          model: d?.model || "unknown",
          provider: d?.provider || "unknown",
          promptTokens,
          completionTokens,
          totalLatency,
          ttft,
          cost: d?.cost || 0,
          status: ok ? "ok" : "error",
          rawStatus: d?.status || "ok",
        };
      });
    }

    // Fallback to stats.recentRequests
    if (Array.isArray(requests) && requests.length > 0) {
      return requests.map((r, i) => {
        const ok = !r?.status || r?.status === "ok" || r?.status === "success";
        return {
          id: `${r?.timestamp || ""}-${r?.model || ""}-${i}`,
          timestamp: r?.timestamp,
          model: r?.model || "unknown",
          provider: r?.provider || "unknown",
          promptTokens: r?.promptTokens || 0,
          completionTokens: r?.completionTokens || 0,
          totalLatency: null,
          ttft: null,
          cost: r?.cost || 0,
          status: ok ? "ok" : "error",
          rawStatus: r?.status || "ok",
        };
      });
    }

    return [];
  }, [detailedRequests, requests]);

  const filtered = useMemo(() => {
    return normalizedRequests.filter((r) => {
      if (statusFilter === "success" && r.status !== "ok") return false;
      if (statusFilter === "error" && r.status === "ok") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const m = (r.model || "").toLowerCase();
        const p = (r.provider || "").toLowerCase();
        return m.includes(q) || p.includes(q);
      }
      return true;
    });
  }, [normalizedRequests, statusFilter, searchQuery]);

  return (
    <div className="flex min-w-0 flex-col rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] p-4 sm:p-5">
      {/* Table Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="material-symbols-outlined text-[16px] text-[var(--text-3)]">swap_calls</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Latest Requests
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)]">
              {filtered.length} entries
            </span>
          </div>
          <p className="text-xs text-[var(--text-3)] font-mono">
            High-density event stream of routed completions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center p-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)]">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-2 py-1 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
                statusFilter === "all"
                  ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("success")}
              className={`px-2 py-1 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
                statusFilter === "success"
                  ? "bg-[var(--surface)] text-[var(--pos)] border border-[var(--line-2)] shadow-sm font-medium"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
              }`}
            >
              Success
            </button>
            <button
              onClick={() => setStatusFilter("error")}
              className={`px-2 py-1 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
                statusFilter === "error"
                  ? "bg-[var(--surface)] text-[var(--danger)] border border-[var(--line-2)] shadow-sm font-medium"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
              }`}
            >
              Error
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter model/provider..."
              className="h-7 w-36 sm:w-48 px-2.5 pl-7 text-xs font-mono rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text)] placeholder-[var(--text-3)] focus:border-[var(--accent-line)] focus:outline-none"
            />
            <span className="material-symbols-outlined absolute left-2 top-1.5 text-[14px] text-[var(--text-3)] pointer-events-none">
              search
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1.5 text-[13px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh requests"
              className="h-7 w-7 flex items-center justify-center rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[15px] ${loading ? "animate-spin" : ""}`}>
                refresh
              </span>
            </button>
          )}

          <Link
            href="/dashboard/usage"
            className="h-7 px-2.5 inline-flex items-center gap-1 text-xs font-mono rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <span>Full Logs</span>
            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
          </Link>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto custom-scrollbar border border-[var(--line)] rounded-[var(--r2)] bg-[var(--surface-inset)]">
        <table className="w-full text-left text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-[11px] font-mono tracking-wider text-[var(--text-3)] uppercase">
              <th className="py-2.5 px-3 w-16">Status</th>
              <th className="py-2.5 px-3 w-28">Timestamp</th>
              <th className="py-2.5 px-3">Model</th>
              <th className="py-2.5 px-3 w-32">Provider</th>
              <th className="py-2.5 px-3 w-36 text-right">Tokens In / Out</th>
              <th className="py-2.5 px-3 w-28 text-right">Latency / TTFT</th>
              <th className="py-2.5 px-3 w-20 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] font-mono">
            {loading && !filtered.length ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[var(--text-3)]">
                  <div className="inline-flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-[var(--line-2)] border-t-[var(--text)] rounded-full animate-spin" />
                    <span>Loading recent telemetry...</span>
                  </div>
                </td>
              </tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[var(--text-3)]">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-[24px] opacity-40">inbox</span>
                    <span>No requests matching filter criteria</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.slice(0, 15).map((r) => {
                const { time, relative } = formatTimestamp(r.timestamp);
                const isOk = r.status === "ok";

                return (
                  <tr
                    key={r.id}
                    className="hover:bg-[var(--surface-2)]/60 transition-colors group"
                  >
                    {/* Status */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      {isOk ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#14251D] text-[var(--pos)] border border-[#34D39A]/20 text-[10px] font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--pos)]" />
                          OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#281515] text-[var(--danger)] border border-[#FF6B6B]/20 text-[10px] font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" />
                          ERR
                        </span>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="py-2 px-3 whitespace-nowrap" title={r.timestamp}>
                      <span className="text-[var(--text)] u-tnum block">{time}</span>
                      <span className="text-[10px] text-[var(--text-3)] block">{relative}</span>
                    </td>

                    {/* Model */}
                    <td className="py-2 px-3 min-w-0">
                      <span
                        className="text-[var(--text)] font-medium truncate block max-w-[240px]"
                        title={r.model}
                      >
                        {r.model}
                      </span>
                    </td>

                    {/* Provider */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <ProviderIcon
                          providerId={r.provider}
                          size={16}
                          className="rounded-sm shrink-0"
                          fallbackText={r.provider?.charAt(0) || "?"}
                        />
                        <span className="text-[var(--text-2)] capitalize truncate max-w-[100px]">
                          {r.provider}
                        </span>
                      </div>
                    </td>

                    {/* Tokens */}
                    <td className="py-2 px-3 text-right whitespace-nowrap u-tnum">
                      <span className="text-[var(--text)]">{fmt(r.promptTokens)}</span>
                      <span className="text-[var(--text-3)] mx-1">/</span>
                      <span className="text-[var(--pos)]">{fmt(r.completionTokens)}</span>
                    </td>

                    {/* Latency / TTFT */}
                    <td className="py-2 px-3 text-right whitespace-nowrap u-tnum">
                      {r.totalLatency !== null ? (
                        <div>
                          <span className="text-[var(--text)]">{Math.round(r.totalLatency)}ms</span>
                          {r.ttft !== null && (
                            <span className="text-[10px] text-[var(--text-3)] block">
                              {Math.round(r.ttft)}ms ttft
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-3)]">-</span>
                      )}
                    </td>

                    {/* Cost */}
                    <td className="py-2 px-3 text-right whitespace-nowrap u-tnum text-[var(--warn)]">
                      {r.cost > 0 ? fmtCost(r.cost) : <span className="text-[var(--text-3)]">-</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

LatestRequestsTable.propTypes = {
  requests: PropTypes.array,
  detailedRequests: PropTypes.array,
  loading: PropTypes.bool,
  onRefresh: PropTypes.func,
};
