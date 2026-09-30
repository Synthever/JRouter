"use client";

import { useState, useEffect } from "react";

function getStatusBadge(statusStr = "") {
  const upper = statusStr.toUpperCase();
  if (upper.includes("OK") || upper.includes("SUCCESS")) {
    return {
      label: statusStr,
      badgeClass: "bg-[#14251D] text-[#34D39A] border-[#34D39A]/30",
    };
  }
  if (upper.includes("PARTIAL") || upper.includes("WARN")) {
    return {
      label: statusStr,
      badgeClass: "bg-[#261F12] text-[#F2B34B] border-[#F2B34B]/30",
    };
  }
  if (upper.includes("FAIL") || upper.includes("ERR")) {
    return {
      label: statusStr,
      badgeClass: "bg-[#281515] text-[#FF6B6B] border-[#FF6B6B]/30",
    };
  }
  return {
    label: statusStr,
    badgeClass: "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--line)]",
  };
}

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState("table"); // "table" | "cards"

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[var(--text-3)]">list_alt</span>
          <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[var(--text)]">Request Logs</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="inline-flex items-center rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-[calc(var(--r1)-2px)] text-xs font-mono transition-colors cursor-pointer ${
                viewMode === "table" ? "bg-[var(--surface)] text-[var(--text)] shadow-xs" : "text-[var(--text-3)] hover:text-[var(--text)]"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">table_rows</span>
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-[calc(var(--r1)-2px)] text-xs font-mono transition-colors cursor-pointer ${
                viewMode === "cards" ? "bg-[var(--surface)] text-[var(--text)] shadow-xs" : "text-[var(--text-3)] hover:text-[var(--text)]"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">grid_view</span>
              <span>Cards</span>
            </button>
          </div>

          {/* Auto-refresh toggle */}
          <label className="text-xs font-mono text-[var(--text-2)] flex items-center gap-2 cursor-pointer select-none">
            <span>Auto (3s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                autoRefresh ? "bg-[var(--pos)]" : "bg-[var(--surface-2)] border border-[var(--line-2)]"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </div>
          </label>
        </div>
      </div>

      <div className="rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[var(--text-3)]">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[var(--text-3)]">No logs recorded yet.</div>
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {logs.map((log, i) => {
              const parts = log.split(" | ");
              if (parts.length < 7) return null;
              const status = parts[6];
              const badge = getStatusBadge(status);
              return (
                <div
                  key={i}
                  className="flex flex-col justify-between p-3.5 rounded-[var(--r2)] bg-[var(--surface-2)]/60 border border-[var(--line)] shadow-xs font-mono text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] text-[var(--text-3)]">{parts[0]}</span>
                    <span className={`px-2 py-0.5 rounded-[var(--r-full)] border text-[10px] font-semibold uppercase ${badge.badgeClass}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 mb-2">
                    <span className="font-semibold text-[var(--text)] truncate" title={parts[1]}>
                      {parts[1]}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
                      <span className="px-1.5 py-0.2 rounded-[var(--r1)] bg-[var(--surface)] border border-[var(--line)] uppercase">
                        {parts[2]}
                      </span>
                      <span className="truncate" title={parts[3]}>{parts[3]}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px]">
                    <span className="text-[var(--text-3)]">In / Out:</span>
                    <span className="u-tnum text-[var(--text)]">
                      <span className="text-[var(--text)]">{parts[4]}</span> ↑ <span className="text-[var(--pos)]">{parts[5]}</span> ↓
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--line)] z-10 text-[var(--text-3)] text-[11px] uppercase tracking-[0.05em]">
                <tr>
                  <th className="px-3 py-2 border-r border-[var(--line)]">DateTime</th>
                  <th className="px-3 py-2 border-r border-[var(--line)]">Model</th>
                  <th className="px-3 py-2 border-r border-[var(--line)]">Provider</th>
                  <th className="px-3 py-2 border-r border-[var(--line)]">Account</th>
                  <th className="px-3 py-2 border-r border-[var(--line)] text-right">In</th>
                  <th className="px-3 py-2 border-r border-[var(--line)] text-right">Out</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]/50">
                {logs.map((log, i) => {
                  const parts = log.split(" | ");
                  if (parts.length < 7) return null;
                  const status = parts[6];
                  const badge = getStatusBadge(status);
                  return (
                    <tr key={i} className="hover:bg-[var(--surface-hover)]/40 transition-colors">
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-[var(--text-3)]">{parts[0]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] font-medium text-[var(--text)]">{parts[1]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)]">
                        <span className="px-1.5 py-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line)] text-[10px] uppercase font-semibold text-[var(--text-2)]">
                          {parts[2]}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] truncate max-w-[150px] text-[var(--text-2)]" title={parts[3]}>{parts[3]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-right u-tnum text-[var(--text)]">{parts[4]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-right u-tnum text-[var(--pos)]">{parts[5]}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block px-2 py-0.5 rounded-[var(--r-full)] border text-[10px] font-semibold uppercase ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="text-[11px] font-mono text-[var(--text-3)]">
        Logs loaded from request history database.
      </div>
    </div>
  );
}
}
