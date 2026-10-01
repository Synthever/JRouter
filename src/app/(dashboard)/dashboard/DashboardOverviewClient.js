"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import KpiBentoGrid from "./components/KpiBentoGrid";
import ActivityTimelineCard from "./components/ActivityTimelineCard";
import TopModelsCard from "./components/TopModelsCard";
import ProviderDistributionCard from "./components/ProviderDistributionCard";
import LatestRequestsTable from "./components/LatestRequestsTable";

export default function DashboardOverviewClient({ machineId }) {
  const [period, setPeriod] = useState("7d");
  const [stats, setStats] = useState(null);
  const [providers, setProviders] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Fetch providers & nodes once on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([provData, nodeData]) => {
        if (provData?.connections) {
          setProviders(provData.connections.filter((c) => c.isActive !== false));
        }
        if (nodeData?.nodes) {
          setNodes(nodeData.nodes);
        }
      })
      .catch((err) => console.error("Failed to load providers info:", err));
  }, []);

  // Fetch usage stats whenever period changes
  const fetchStats = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch(`/api/usage/stats?period=${period}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handlePeriodChange = (newPeriod) => {
    startTransition(() => {
      setPeriod(newPeriod);
    });
  };

  return (
    <div className="flex flex-col gap-6 w-full pb-10">
      {/* 1. Top Section: Period Filters + 5 KPI Cards (.grid-stats) */}
      <KpiBentoGrid
        stats={stats}
        connectionsCount={providers.length}
        nodesCount={nodes.length}
        period={period}
        onPeriodChange={handlePeriodChange}
        fetching={fetching || isPending}
        onRefresh={fetchStats}
      />

      {/* 2. Analytics Split: Activity Timeline (1.6fr) + Model Breakdown (1fr) */}
      <div className="overview-analytics">
        <ActivityTimelineCard period={period} />
        <TopModelsCard stats={stats} />
      </div>

      {/* 3. Upstream Provider Distribution */}
      <ProviderDistributionCard stats={stats} />

      {/* 4. Full-Width Bottom Section: Interactive Activity Logs (.logs-table) */}
      <LatestRequestsTable initialRequests={stats?.recentRequests || []} />
    </div>
  );
}
