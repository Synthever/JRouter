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
    <div className="flex flex-col gap-5 max-w-[1380px] mx-auto pb-10">
      {/* 1. Top Section: Period Filters + 5 KPI Cards */}
      <KpiBentoGrid
        stats={stats}
        connectionsCount={providers.length}
        nodesCount={nodes.length}
        period={period}
        onPeriodChange={handlePeriodChange}
        fetching={fetching || isPending}
        onRefresh={fetchStats}
      />

      {/* 2. Activity Timeline Card */}
      <ActivityTimelineCard period={period} />

      {/* 3. Lower Bento Grid: Top Models (6 cols) + Provider Distribution (6 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-6 flex flex-col">
          <TopModelsCard stats={stats} />
        </div>
        <div className="lg:col-span-6 flex flex-col">
          <ProviderDistributionCard stats={stats} />
        </div>
      </div>

      {/* 4. Full-Width Bottom Section: Latest Requests Table */}
      <LatestRequestsTable initialRequests={stats?.recentRequests || []} />
    </div>
  );
}
