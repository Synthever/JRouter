"use client";

import React, { useState, useEffect, useTransition } from "react";
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
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [connectionsError, setConnectionsError] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function loadConnections() {
      try {
        const responses = await Promise.all([
          fetch("/api/providers", { signal }),
          fetch("/api/provider-nodes", { signal }),
        ]);
        if (responses.some((response) => !response.ok)) throw new Error("Connection lookup failed");
        const [provData, nodeData] = await Promise.all(responses.map((response) => response.json()));
        if (signal.aborted) return;
        setProviders((provData.connections || []).filter((c) => c.isActive !== false));
        setNodes(nodeData.nodes || []);
        setConnectionsError(false);
      } catch {
        if (!signal.aborted) setConnectionsError(true);
      } finally {
        if (!signal.aborted) setConnectionsLoading(false);
      }
    }
    loadConnections();
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function loadStats() {
      try {
        const res = await fetch(`/api/usage/stats?period=${period}`, { signal });
        if (!res.ok) throw new Error("Telemetry lookup failed");
        const data = await res.json();
        if (signal.aborted) return;
        setStats(data);
        setError("");
      } catch {
        if (!signal.aborted) setError("Could not load telemetry.");
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          setFetching(false);
        }
      }
    }
    loadStats();
    return () => controller.abort();
  }, [period, refreshVersion]);

  const handlePeriodChange = (newPeriod) => {
    setFetching(true);
    startTransition(() => setPeriod(newPeriod));
  };

  return (
    <div className="dashboard-overview flex flex-col gap-6 w-full pb-10">
      <KpiBentoGrid
        stats={stats}
        connectionsCount={providers.length}
        nodesCount={nodes.length}
        period={period}
        onPeriodChange={handlePeriodChange}
        fetching={fetching || isPending}
        loading={loading}
        error={error}
        connectionsError={connectionsError}
        connectionsLoading={connectionsLoading}
        onRefresh={() => {
          setFetching(true);
          setRefreshVersion((version) => version + 1);
        }}
      />
      <div className="overview-analytics">
        <ActivityTimelineCard period={period} refreshVersion={refreshVersion} />
        <div className="overview-breakdowns">
          <TopModelsCard stats={stats} />
          <ProviderDistributionCard stats={stats} />
        </div>
      </div>
      <LatestRequestsTable initialRequests={stats?.recentRequests || []} />
    </div>
  );
}
