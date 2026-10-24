export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "none", label: "No connection" },
];

// noAuth providers (e.g. free proxies) are always usable even though they
// never have a stored connection record, so they never fall into "none".
export function getConnectionStatus(stats, isNoAuth = false) {
  if (isNoAuth) return "active";
  if (!stats || stats.total === 0) return "none";
  return stats.allDisabled ? "inactive" : "active";
}

export function matchesStatusFilter(statusFilter, stats, isNoAuth = false) {
  if (statusFilter === "all") return true;
  return getConnectionStatus(stats, isNoAuth) === statusFilter;
}

// Summary strip for the providers page. `entries` is one item per catalog
// provider: { id, name, stats, free?, noAuth? }. Counts describe the whole
// catalog, never the filtered view, so the strip stays stable while filtering.
export function computeProviderSummary(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  let activeCount = 0;
  let topProvider = null;
  let freeCount = 0;
  const readyFreeNames = [];

  list.forEach((entry) => {
    const stats = entry?.stats ?? {};
    const connections = Number(stats.total) || 0;
    const isLive = connections > 0 && !stats.allDisabled;

    if (isLive) {
      activeCount += 1;
      const isBigger = !topProvider || connections > topProvider.connections;
      const isTieBreak =
        topProvider &&
        connections === topProvider.connections &&
        String(entry.name || "").localeCompare(String(topProvider.name || "")) < 0;
      if (isBigger || isTieBreak) {
        topProvider = {
          id: entry.id,
          name: entry.name || entry.id,
          connections,
        };
      }
    }

    if (entry?.free) {
      freeCount += 1;
      if (entry.noAuth && entry.name) readyFreeNames.push(entry.name);
    }
  });

  return {
    total: list.length,
    activeCount,
    topProvider,
    freeCount,
    readyFreeNames,
  };
}
