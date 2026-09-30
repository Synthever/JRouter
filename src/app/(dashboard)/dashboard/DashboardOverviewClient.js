"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import DashboardStatCards from "./components/DashboardStatCards";
import ActivityChart from "./components/ActivityChart";
import TopModelsRank from "./components/TopModelsRank";
import ProviderDistribution from "./components/ProviderDistribution";
import LatestRequestsTable from "./components/LatestRequestsTable";
import GatewayQuickStatus from "./components/GatewayQuickStatus";

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All Time" },
];

export default function DashboardOverviewClient({ machineId = "" }) {
  const [period, setPeriod] = useState("today");
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [detailedRequests, setDetailedRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchTelemetry = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setRefreshing(true);

    try {
      const [statsRes, chartRes, detailsRes] = await Promise.allSettled([
        fetch(`/api/usage/stats?period=${period}`, { cache: "no-store" }),
        fetch(`/api/usage/chart?period=${period}`, { cache: "no-store" }),
        fetch(`/api/usage/request-details?pageSize=20`, { cache: "no-store" }),
      ]);

      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const statsData = await statsRes.value.json();
        setStats(statsData);
      }

      if (chartRes.status === "fulfilled" && chartRes.value.ok) {
        const chartJson = await chartRes.value.json();
        setChartData(Array.isArray(chartJson) ? chartJson : []);
      }

      if (detailsRes.status === "fulfilled" && detailsRes.value.ok) {
        const detailsJson = await detailsRes.value.json();
        if (Array.isArray(detailsJson?.details)) {
          setDetailedRequests(detailsJson.details);
        }
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error("[Dashboard] Error fetching telemetry:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  // Initial and period change fetch
  useEffect(() => {
    fetchTelemetry(false);
  }, [fetchTelemetry]);

  // Auto-refresh interval (every 15s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchTelemetry(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchTelemetry]);

  return (
    <div className="page flex flex-col gap-6 py-4 px-2 sm:px-4 min-w-0">
      {/* Top Action Bar: Eyebrow, Period Filters, and Live Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[var(--line)]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="lp-eyebrow__dot bg-[var(--pos)]" />
            <span className="text-[11px] font-mono font-medium tracking-[0.2em] text-[var(--text-3)] uppercase">
              Operational Telemetry
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text)]">
            Gateway Dashboard
          </h1>
        </div>

        {/* Filter Controls & Auto-refresh */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Period selector */}
          <div className="flex items-center p-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)]">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-2.5 py-1 text-xs font-mono transition-all rounded-[var(--r1)] cursor-pointer ${
                  period === opt.value
                    ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                    : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Refresh Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fetchTelemetry(true)}
              disabled={loading || refreshing}
              title="Refresh telemetry"
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] text-xs font-mono text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[15px] ${refreshing ? "animate-spin" : ""}`}>
                refresh
              </span>
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              title={autoRefresh ? "Pause 15s auto-refresh" : "Enable 15s auto-refresh"}
              className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--r1)] border text-xs font-mono transition-colors cursor-pointer ${
                autoRefresh
                  ? "bg-[#14251D] text-[var(--pos)] border-[#34D39A]/20"
                  : "bg-[var(--surface-2)] text-[var(--text-3)] border-[var(--line-2)]"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {autoRefresh && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--pos)] opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    autoRefresh ? "bg-[var(--pos)]" : "bg-[var(--text-3)]"
                  }`}
                />
              </span>
              <span className="hidden md:inline">{autoRefresh ? "Live" : "Paused"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 1. Stat Cards (5-column grid) */}
      <DashboardStatCards stats={stats} loading={loading} />

      {/* 2. Primary Charts Grid: Activity Over Time + Top Models */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 xl:col-span-8 min-w-0">
          <ActivityChart
            data={chartData}
            loading={loading}
            period={period}
          />
        </div>
        <div className="lg:col-span-5 xl:col-span-4 min-w-0">
          <TopModelsRank
            byModel={stats?.byModel}
            loading={loading}
          />
        </div>
      </div>

      {/* 3. Secondary Grid: Provider Distribution + Gateway Quick Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 xl:col-span-4 min-w-0">
          <ProviderDistribution
            byProvider={stats?.byProvider}
            loading={loading}
          />
        </div>
        <div className="lg:col-span-7 xl:col-span-8 min-w-0">
          <GatewayQuickStatus
            stats={stats}
            machineId={machineId}
          />
        </div>
      </div>

      {/* 4. Latest Requests Table */}
      <LatestRequestsTable
        requests={stats?.recentRequests || []}
        detailedRequests={detailedRequests}
        loading={loading}
        onRefresh={() => fetchTelemetry(true)}
      />

      {/* Footer Meta info */}
      {lastUpdated && (
        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-3)] pt-2 pb-6 border-t border-[var(--line)]">
          <span>JRouter Core Engine · v0.5.91</span>
          <span>Last telemetry sync: {lastUpdated.toLocaleTimeString("en-US", { hour12: false })}</span>
        </div>
      )}
    </div>
  );
}

DashboardOverviewClient.propTypes = {
  machineId: PropTypes.string,
};
