"use client";

import React, { useState, useEffect, useCallback, useMemo, useId } from "react";
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
import styles from "./LatestRequestsTable.module.css";

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
      <StatusBadge variant="success" className={cn(styles.statusBadge, styles.success)}>
        OK
      </StatusBadge>
    );
  }
  if (s === "partial" || s.startsWith("3") || s.includes("stream")) {
    return (
      <StatusBadge variant="warning" className={cn(styles.statusBadge, styles.warning)}>
        Partial
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="error" className={styles.statusBadge}>
      {s.startsWith("4") || s.startsWith("5") ? s : "Error"}
    </StatusBadge>
  );
}

export default function LatestRequestsTable({ initialRequests = [] }) {
  const titleId = useId();
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
  const visibleRequests = filtered.slice(0, 15);
  const maxTtft = Math.max(1, ...visibleRequests.map((log) => log.ttftMs || log.ttft || 0));

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      {/* Table Header / Action Row */}
      <div className={styles.header}>
        <div>
          <h2 id={titleId} className={styles.title}>Latest requests</h2>
          <p className={styles.subtitle}>
            Live stream of the most recent payloads
          </p>
        </div>

        {/* Filter Input + Controls */}
        <div className={styles.controls}>
          {/* Dual Layout Toggle */}
          <AnimatedBackground
            value={layout}
            onValueChange={setLayout}
            aria-label="Request logs layout"
            containerClassName={styles.layoutGroup}
            className={styles.layoutHighlight}
          >
            <button
              data-id="table"
              type="button"
              aria-label="Table view"
              className={styles.layoutButton}
              title="Table View (Desktop analysis)"
            >
              <Table className={styles.icon} aria-hidden="true" />
            </button>
            <button
              data-id="cards"
              type="button"
              aria-label="Cards view"
              className={styles.layoutButton}
              title="Cards View (Touch-friendly)"
            >
              <LayoutGrid className={styles.icon} aria-hidden="true" />
            </button>
          </AnimatedBackground>

          <div className={styles.searchField}>
                      <Search className={styles.searchIcon} aria-hidden="true" />
            <input
              type="search"
              aria-label="Filter requests"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter model / status..."
              className={styles.searchInput}
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            aria-label="Live polling"
            aria-pressed={autoRefresh}
            className={styles.liveButton}
            title={autoRefresh ? "Live polling active (6s)" : "Polling paused"}
          >
            <span className={styles.liveDot} aria-hidden="true" />
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
            className={styles.refreshButton}
            title="Refresh logs"
          >
            <RefreshCw className={cn(styles.icon, loading && styles.spinning)} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content: Cards View vs Table View */}
      {layout === "cards" ? (
        <div className={styles.cards}>
          {filtered.length > 0 ? (
            visibleRequests.map((log, i) => {
              const promptTok = log.promptTokens || log.prompt_tokens || 0;
              const compTok = log.completionTokens || log.completion_tokens || 0;
              const duration = log.durationMs || log.duration || 0;
              const ttft = log.ttftMs || log.ttft || 0;

              return (
                <div
                  key={log.id || `${log.timestamp}-${i}`}
                  className={styles.requestCard}
                >
                  <div className={styles.cardHeader}>
                    {renderStatusBadge(log.status)}
                    <span className={styles.timestamp}>{timeAgo(log.timestamp)}</span>
                  </div>

                  <div className={styles.cardIdentity}>
                    <div className={styles.model} title={log.model}>
                      {log.model || "default"}
                    </div>
                    <div className="mt-1">
                      <span className={styles.providerBadge}>
                        {log.provider || "gateway"}
                      </span>
                    </div>
                  </div>

                  <div className={styles.cardMetrics}>
                    <div>
                      <span className={styles.metricLabel}>Tokens</span>
                      <span className={styles.tokenPair}>
                        <span className="text-[var(--text-3)]">{fmtTokens(promptTok)}</span>
                        <span className="text-[var(--text-3)]">/</span>
                        <span className={styles.outputTokens}>{fmtTokens(compTok)}</span>
                      </span>
                    </div>
                    <div>
                      <span className={styles.metricLabel}>TTFT (ms)</span>
                      <span className="text-[var(--text-2)] u-tnum block mt-0.5">
                        {ttft > 0 ? `${Math.round(ttft)}ms` : "—"}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={styles.metricLabel}>Latency</span>
                      <span className={styles.latency}>
                        {duration > 0 ? (duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${Math.round(duration)}ms`) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyCards}>
              {filter ? "No requests matching filter" : "No recent requests logged yet."}
            </div>
          )}
        </div>
      ) : (
        /* High-density Table View */
        <div className={styles.tableScroll} role="region" aria-label="Latest requests table" tabIndex={0}>
          <table className={styles.table} aria-labelledby={titleId}>
            <thead>
              <tr>
                <th scope="col" className="py-2.5 px-3 font-medium">Status</th>
                <th scope="col" className="py-2.5 px-3 font-medium">Model</th>
                <th scope="col" className="py-2.5 px-3 font-medium">Provider</th>
                <th scope="col" className="py-2.5 px-3 font-medium text-right">Tokens In / Out</th>
                <th scope="col" className="py-2.5 px-3 font-medium text-right">TTFT (ms)</th>
                <th scope="col" className="py-2.5 px-3 font-medium text-right">Latency (ms)</th>
                <th scope="col" className="py-2.5 px-3 font-medium text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? (
                visibleRequests.map((log, i) => {
                  const promptTok = log.promptTokens || log.prompt_tokens || 0;
                  const compTok = log.completionTokens || log.completion_tokens || 0;
                  const duration = log.durationMs || log.duration || 0;
                  const ttft = log.ttftMs || log.ttft || 0;

                  return (
                    <tr key={log.id || `${log.timestamp}-${i}`} >
                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {renderStatusBadge(log.status)}
                      </td>

                      {/* Model */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={styles.model} title={log.model}>
                          {log.model || "default"}
                        </span>
                      </td>

                      {/* Provider */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={styles.providerBadge}>
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
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        {ttft > 0 ? (
                          <div className={styles.timing} title="Bar scaled to the longest TTFT in this view">
                            <span className={styles.ttftTrack} aria-hidden="true">
                              <i className={styles.ttftFill} style={{ width: `${(ttft / maxTtft) * 100}%` }} />
                            </span>
                            <span className="text-[var(--text-3)] u-tnum">{Math.round(ttft)}ms</span>
                          </div>
                        ) : (
                          <span className="text-[var(--text-3)] u-tnum">—</span>
                        )}
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
                  <td colSpan={7} className={styles.empty}>
                    {filter ? "No requests matching filter" : "No recent requests logged yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Navigation */}
      <div className={styles.footer}>
        <span>Showing {Math.min(filtered.length, 15)} most recent payloads</span>
        <div className={styles.footerLinks}>
          <Link
            href="/dashboard/usage?tab=details"
            className={styles.footerLink}
          >
            <span>Full usage logs</span>
            <ExternalLink className={styles.linkIcon} aria-hidden="true" />
          </Link>
          <span className="text-[var(--text-3)]">·</span>
          <Link
            href="/dashboard/console-log"
            className={styles.footerLink}
          >
            <span>Console raw stream</span>
            <ExternalLink className={styles.linkIcon} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
