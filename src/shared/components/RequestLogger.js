"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback } from "react";
import { SegmentedControl, Toggle } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";

function getStatusVariant(statusStr = "") {
  const upper = statusStr.toUpperCase();
  if (upper.includes("OK") || upper.includes("SUCCESS")) return "success";
  if (upper.includes("PARTIAL") || upper.includes("WARN")) return "warning";
  if (upper.includes("FAIL") || upper.includes("ERR")) return "error";
  return "default";
}

const VIEW_MODES = [
  { value: "table", label: "Table", icon: "table_rows" },
  { value: "cards", label: "Cards", icon: "grid_view" },
];

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState("table"); // "table" | "cards"

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage/request-logs")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) {
          setLogs(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch logs:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Icon className="text-[18px] text-[var(--text-3)]">list_alt</Icon>
          <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[var(--text)]">Request Logs</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <SegmentedControl
            options={VIEW_MODES}
            value={viewMode}
            onChange={setViewMode}
            size="sm"
            aria-label="Log view"
          />

          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-2)]">
            <span>Auto (3s)</span>
            <Toggle
              size="sm"
              checked={autoRefresh}
              onChange={setAutoRefresh}
              aria-label="Auto-refresh request logs"
            />
          </div>
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
              return (
                <div
                  key={i}
                  className="flex flex-col justify-between p-3.5 rounded-[var(--r2)] bg-[var(--surface-2)]/60 border border-[var(--line)] shadow-xs font-mono text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] text-[var(--text-3)]">{parts[0]}</span>
                    <StatusBadge variant={getStatusVariant(status)} dot={false}>{status}</StatusBadge>
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
                  return (
                    <tr key={i} className="hover:bg-[var(--surface-hover)]/40 transition-colors">
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-[var(--text-3)]">{parts[0]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] font-medium text-[var(--text)]">{parts[1]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)]">
                        <StatusBadge dot={false}>{parts[2]}</StatusBadge>
                      </td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] truncate max-w-[150px] text-[var(--text-2)]" title={parts[3]}>{parts[3]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-right u-tnum text-[var(--text)]">{parts[4]}</td>
                      <td className="px-3 py-1.5 border-r border-[var(--line)] text-right u-tnum text-[var(--pos)]">{parts[5]}</td>
                      <td className="px-3 py-1.5">
                        <StatusBadge variant={getStatusVariant(status)} dot={false}>{status}</StatusBadge>
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
