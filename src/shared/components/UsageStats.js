"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}
import { Select, SegmentedControl, Skeleton } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import dynamic from "next/dynamic";
import styles from "@/app/(dashboard)/dashboard/usage/usage.module.css";
// Lazy-load: keeps @xyflow/react and recharts out of the initial bundle
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
const UsageChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/UsageChart"), { ssr: false });
const ProviderBarChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderBarChart"), { ssr: false });
const TopModelsChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/TopModelsChart"), { ssr: false });

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }) {
  return (
    <section className={`ui-card ${styles.section} ${styles.recentRequests}`} aria-labelledby="usage-recent-heading">
      <div className={styles.sectionHeader}>
        <h2 id="usage-recent-heading" className="ui-eyebrow">Recent Requests</h2>
      </div>

      {!requests.length ? (
        <div className={`${styles.inset} flex-1`}>No requests yet</div>
      ) : (
        <div
          className={`${styles.tableWrap} ${styles.recentRequestsScroll} no-scrollbar`}
          role="region"
          aria-label="Recent requests list"
          tabIndex={0}
        >
          <table className={`${styles.table} ${styles.recentRequestsTable}`}>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className={styles.num}>In / Out</th>
                <th scope="col" className={styles.num}>When</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i}>
                    <td className="font-mono" title={r.model}>
                      <div className={styles.recentRequestModel}>
                        <StatusBadge variant={ok ? "success" : "error"} className="!px-0 shrink-0">
                          <span className="sr-only">{ok ? "Success" : "Error"}</span>
                        </StatusBadge>
                        <span>{r.model}</span>
                      </div>
                    </td>
                    <td className={styles.num}>
                      <span className={styles.muted}>{fmt(r.promptTokens)}↑</span>{" "}
                      <span className="text-[var(--pos)]">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className={`${styles.num} ${styles.subtle} whitespace-nowrap`}>
                      <TimeAgo timestamp={r.timestamp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      // ponytail: cost split is a token-share allocation of the (rate-accurate)
      // server total, not a per-rate recompute. cached is a subset of prompt, so
      // peel it out of the input share. Upgrade to a stored per-component cost
      // breakdown if exact cached-rate cost display is needed.
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, (data.promptTokens || 0) - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, cachedCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unknown Model";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": return item.keyName || "Unknown Key";
    case "endpoint": return item.endpoint || "Unknown Endpoint";
    default: return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

const VIEW_MODES = [
  { value: "costs", label: "Costs" },
  { value: "tokens", label: "Tokens" },
];

const NUM_CELL = styles.num;
const MUTED_CELL = `${styles.num} ${styles.muted}`;
const SUBTLE_CELL = `${styles.num} ${styles.subtle} whitespace-nowrap`;
const PROVIDER_CELL = "align-middle";

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => r.ok ? r.json() : null),
      fetch("/api/provider-nodes").then((r) => r.ok ? r.json() : null),
    ])
      .then(([d, nodesData]) => {
        // Build node name lookup for custom providers
        const nodeNameMap = {};
        for (const node of (nodesData?.nodes || [])) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || []).filter((c) => {
          if (c.isActive === false) return false;
          if (!isLLMProvider(c.provider)) return false;
          if (AI_PROVIDERS[c.provider]?.hidden) return false;
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        }).map((c) => ({
          ...c,
          nodeName: nodeNameMap[c.provider] || null,
        }));
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST on period change, then poll every 3s so the
  // dashboard updates without a manual reload. Background polls stay silent.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const load = async ({ silent = false } = {}) => {
      if (cancelled || inFlight) return;
      inFlight = true;
      if (!silent) {
        // First load: skeleton placeholders; subsequent: subtle fetching indicator
        if (isInitialLoad.current) {
          isInitialLoad.current = false;
          setLoading(true);
        } else {
          setFetching(true);
        }
      }
      try {
        const r = await fetch(`/api/usage/stats?period=${period}`);
        const data = r.ok ? await r.json() : null;
        if (!cancelled && data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      } catch {
        // Keep the last snapshot; the next poll retries.
      } finally {
        if (!cancelled && !silent) {
          setLoading(false);
          setFetching(false);
        }
        inFlight = false;
      }
    };

    load();
    const id = setInterval(() => {
      if (!document.hidden) load({ silent: true });
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [period]);

  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Always merge only real-time fields, never overwrite full stats from REST
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byModel, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className={MUTED_CELL}>—</td>
              <td className={NUM_CELL}>{fmt(group.summary.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`font-medium ${item.pending > 0 ? styles.pending : ""}`}>{item.rawModel}</td>
              <td className={PROVIDER_CELL}><StatusBadge dot={false}>{item.provider}</StatusBadge></td>
              <td className={NUM_CELL}>{fmt(item.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = stats.pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byAccount, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className={MUTED_CELL}>—</td>
              <td className={MUTED_CELL}>—</td>
              <td className={NUM_CELL}>{fmt(group.summary.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`font-medium ${item.pending > 0 ? styles.pending : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</td>
              <td className={`font-medium ${item.pending > 0 ? styles.pending : ""}`}>{item.rawModel}</td>
              <td className={PROVIDER_CELL}><StatusBadge dot={false}>{item.provider}</StatusBadge></td>
              <td className={NUM_CELL}>{fmt(item.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className={MUTED_CELL}>—</td>
              <td className={MUTED_CELL}>—</td>
              <td className={NUM_CELL}>{fmt(group.summary.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="font-medium">{item.keyName}</td>
              <td>{item.rawModel}</td>
              <td className={PROVIDER_CELL}><StatusBadge dot={false}>{item.provider}</StatusBadge></td>
              <td className={NUM_CELL}>{fmt(item.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byEndpoint, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className={MUTED_CELL}>—</td>
              <td className={MUTED_CELL}>—</td>
              <td className={NUM_CELL}>{fmt(group.summary.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="font-mono">{item.endpoint}</td>
              <td>{item.rawModel}</td>
              <td className={PROVIDER_CELL}><StatusBadge dot={false}>{item.provider}</StatusBadge></td>
              <td className={NUM_CELL}>{fmt(item.requests)}</td>
              <td className={SUBTLE_CELL}>{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading) {
    return (
      <div className={styles.page}>
        <section className={`ui-card ${styles.section}`}>
          <div className={styles.inset}>
            <Icon className="text-[20px] text-[var(--danger)]">error</Icon>
            <p>Failed to load usage statistics.</p>
            <p className={styles.insetHint}>The usage store could not be read. Reload to retry.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Period selector (hidden when controlled by parent) */}
      {(!hidePeriodSelector || fetching) && (
        <div className={`${styles.controls} w-full sm:w-auto sm:self-end`}>
          {!hidePeriodSelector && (
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              aria-label="Usage period"
              className="max-w-full"
            />
          )}
          {fetching && (
            <Icon
              className="animate-spin text-[16px] text-[var(--text-3)]"
              aria-label="Refreshing usage statistics"
            >
              progress_activity
            </Icon>
          )}
        </div>
      )}

      {/* Overview cards */}
      {loading ? (
        <div className="grid-stats min-w-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`ui-card ${styles.metric}`}>
              <Skeleton className="mb-3 h-3 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      ) : (
        <section aria-labelledby="usage-overview-heading">
          <h2 id="usage-overview-heading" className="sr-only">Overview metrics</h2>
          <OverviewCards stats={stats} />
        </section>
      )}

      {/* Provider topology + Recent Requests */}
      {loading ? (
        <div className={styles.gridSplit}>
          <Skeleton className="h-[320px] w-full rounded-[var(--r3)]" />
          <Skeleton className="h-[320px] w-full rounded-[var(--r3)]" />
        </div>
      ) : (
        <div className={styles.gridSplit}>
          <ProviderTopology
            providers={providers}
            activeRequests={stats.activeRequests || []}
            lastProvider={stats.recentRequests?.[0]?.provider || ""}
            errorProvider={stats.errorProvider || ""}
          />
          <RecentRequests requests={stats.recentRequests || []} />
        </div>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? <Skeleton className="h-[300px] w-full rounded-[var(--r3)]" /> : <UsageChart period={period} />}

      {/* Provider and model breakdown charts */}
      {!loading && (stats.byProvider || stats.byModel) && (
        <div className={styles.gridHalves}>
          <ProviderBarChart byProvider={stats.byProvider} />
          <TopModelsChart byModel={stats.byModel} />
        </div>
      )}

      {/* Table with dropdown selector */}
      <section className={`ui-card ${styles.section}`} aria-labelledby="usage-breakdown-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="usage-breakdown-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">table_rows</Icon> Breakdown
            </h2>
            <p className={styles.sectionDescription}>Grouped usage with expandable detail rows</p>
          </div>
          <div className={`${styles.controls} w-full sm:w-auto`}>
            <Select
              options={TABLE_OPTIONS}
              value={tableView}
              onChange={(e) => setTableView(e.target.value)}
              aria-label="Usage breakdown dimension"
              className={styles.dimension}
              selectClassName="py-1.5 text-xs"
            />
            <SegmentedControl
              options={VIEW_MODES}
              value={viewMode}
              onChange={setViewMode}
              size="sm"
              aria-label="Value mode"
            />
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          activeTableConfig && (
            <UsageTable
              title=""
              columns={activeTableConfig.columns}
              groupedData={activeTableConfig.groupedData}
              tableType={tableView}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggleSort={toggleSort}
              viewMode={viewMode}
              storageKey={activeTableConfig.storageKey}
              renderSummaryCells={activeTableConfig.renderSummaryCells}
              renderDetailCells={activeTableConfig.renderDetailCells}
              emptyMessage={activeTableConfig.emptyMessage}
            />
          )
        )}
      </section>
    </div>
  );
}
