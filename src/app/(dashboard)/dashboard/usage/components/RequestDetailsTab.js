"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import Input from "@/shared/components/Input";
import StatusBadge from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import styles from "../usage.module.css";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={styles.collapsible}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={styles.collapsibleToggle}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon && <Icon className="shrink-0 text-[16px] text-[var(--text-2)]">{icon}</Icon>}
          <span className={`${styles.collapsibleLabel} truncate`}>{title}</span>
        </span>
        <Icon
          className={cn(
            styles.collapsibleChevron,
            "text-[18px]",
            isOpen && styles.collapsibleChevronOpen
          )}
        >
          chevron_right
        </Icon>
      </button>

      {isOpen && <div className={styles.collapsibleBody}>{children}</div>}
    </div>
  );
}

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: ""
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString()
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination(prev => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination(prev => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
  };

  const hasFilters = !!(filters.provider || filters.startDate || filters.endDate);

  return (
    <div className={styles.page}>
      <section className={`ui-card ${styles.section}`} aria-labelledby="usage-filters-heading">
        <div className={styles.sectionHeader}>
          <h2 id="usage-filters-heading" className="ui-eyebrow flex items-center gap-2">
            <Icon className="text-[16px]">filter_list</Icon> Filters
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            disabled={!hasFilters}
          >
            Clear Filters
          </Button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="provider-filter"
              className="font-mono text-xs uppercase tracking-wider text-[var(--text-2)]"
            >
              Provider
            </label>
            <select
              id="provider-filter"
              value={filters.provider}
              onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
              className={styles.filterSelect}
            >
              <option value="">All Providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            id="start-date-filter"
            type="datetime-local"
            label="Start Date"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />

          <Input
            id="end-date-filter"
            type="datetime-local"
            label="End Date"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />
        </div>
      </section>

      <section className={`ui-card ${styles.section}`} aria-labelledby="usage-history-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="usage-history-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">receipt_long</Icon> Request History
            </h2>
            <p className={styles.sectionDescription}>
              {pagination.totalItems
                ? `${pagination.totalItems.toLocaleString()} recorded requests`
                : "Per-request tokens, latency and payloads"}
            </p>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Model</th>
                <th scope="col">Provider</th>
                <th scope="col" className={styles.num}>Input</th>
                <th scope="col" className={styles.num}>Cached</th>
                <th scope="col" className={styles.num}>Cache Write</th>
                <th scope="col" className={styles.num}>Output</th>
                <th scope="col">Latency</th>
                <th scope="col" className={styles.center}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className={styles.empty}>Loading request details…</td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan="9" className={styles.empty}>No request details found</td>
                </tr>
              ) : (
                details.map((detail, index) => (
                  <tr key={`${detail.id}-${index}`}>
                    <td className="whitespace-nowrap text-[var(--text-2)]">
                      {new Date(detail.timestamp).toLocaleString()}
                    </td>
                    <td className="font-mono" title={detail.model}>
                      <span className="block max-w-[260px] truncate">{detail.model}</span>
                    </td>
                    <td className="max-w-[180px] truncate">
                      {getProviderName(detail.provider, providerNameCache)}
                    </td>
                    <td className={styles.num}>{getInputTokens(detail.tokens).toLocaleString()}</td>
                    <td className={`${styles.num} ${styles.muted}`}>
                      {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className={`${styles.num} ${styles.muted}`}>
                      {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className={styles.num}>
                      {detail.tokens?.completion_tokens?.toLocaleString() || 0}
                    </td>
                    <td className={styles.muted}>
                      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                        <div>TTFT: {detail.latency?.ttft || 0}ms</div>
                        <div>Total: {detail.latency?.total || 0}ms</div>
                      </div>
                    </td>
                    <td className={styles.center}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleViewDetail(detail)}
                        aria-label={`Detail for ${detail.model}`}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </section>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg"
      >
        {selectedDetail && (
          <div className="flex flex-col gap-5">
            <dl className={styles.detailGrid}>
              <div>
                <dt>ID</dt>
                <dd className="font-mono">{selectedDetail.id}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{new Date(selectedDetail.timestamp).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{getProviderName(selectedDetail.provider, providerNameCache)}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="font-mono">{selectedDetail.model}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge variant={selectedDetail.status === "success" ? "success" : "error"}>
                    {selectedDetail.status}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd className="font-mono">
                  TTFT {selectedDetail.latency?.ttft || 0}ms · Total {selectedDetail.latency?.total || 0}ms
                </dd>
              </div>
              <div>
                <dt>Input Tokens</dt>
                <dd className="font-mono u-tnum">{getInputTokens(selectedDetail.tokens).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Output Tokens</dt>
                <dd className="font-mono u-tnum">
                  {selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}
                </dd>
              </div>
              {getCachedTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <dt>Cached Tokens</dt>
                  <dd className="font-mono u-tnum">
                    {getCachedTokens(selectedDetail.tokens).toLocaleString()}
                  </dd>
                </div>
              )}
              {getCacheCreationTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <dt>Cache Creation</dt>
                  <dd className="font-mono u-tnum">
                    {getCacheCreationTokens(selectedDetail.tokens).toLocaleString()}
                  </dd>
                </div>
              )}
            </dl>

            {selectedDetail.pxpipe && (
              <div className={`ui-card ${styles.section}`}>
                <div className={styles.sectionHeader}>
                  <h3 className="ui-eyebrow flex items-center gap-2">
                    <Icon className="text-[16px]">image</Icon> PXPIPE
                  </h3>
                  <StatusBadge variant={selectedDetail.pxpipe.applied ? "success" : "warning"}>
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </StatusBadge>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <span className={`${styles.fieldLabel} block`}>Original (est.)</span>
                      <span className="font-mono u-tnum">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className={`${styles.fieldLabel} block`}>Compressed (est.)</span>
                      <span className="font-mono u-tnum">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className={`${styles.fieldLabel} block`}>Saved</span>
                      <span className="font-mono u-tnum text-[var(--pos)]">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className={`${styles.fieldLabel} block`}>Images</span>
                      <span className="font-mono u-tnum">
                        {selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className={styles.description}>
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <CollapsibleSection title="1. Client Request (Input)" defaultOpen={true} icon="input">
                <pre className={styles.codeBlock}>
                  {JSON.stringify(selectedDetail.request, null, 2)}
                </pre>
              </CollapsibleSection>

              {selectedDetail.providerRequest && (
                <CollapsibleSection title="2. Provider Request (Translated)" icon="translate">
                  <pre className={styles.codeBlock}>
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                </CollapsibleSection>
              )}

              {selectedDetail.providerResponse && (
                <CollapsibleSection title="3. Provider Response (Raw)" icon="data_object">
                  <pre className={styles.codeBlock}>
                    {typeof selectedDetail.providerResponse === 'object'
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : selectedDetail.providerResponse
                    }
                  </pre>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="4. Client Response (Final)" defaultOpen={true} icon="output">
                {selectedDetail.response?.thinking && (
                  <div className="mb-4">
                    <h4 className={styles.fieldLabel}>Thinking Process</h4>
                    <pre className={styles.codeBlock}>{selectedDetail.response.thinking}</pre>
                  </div>
                )}

                <h4 className={styles.fieldLabel}>Content</h4>
                <pre className={styles.codeBlock}>
                  {selectedDetail.response?.content || "[No content]"}
                </pre>
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
