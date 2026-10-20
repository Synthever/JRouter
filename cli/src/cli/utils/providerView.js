// Pure helpers for the Providers TUI: status rendering, ordering and priority
// math. Kept out of menus/providers.js so they can be tested without a terminal.

// The server reports `testStatus` as active | unavailable | error | unknown.
// Anything unrecognised must render as unknown rather than silently as healthy.
const STATUS_STYLE = {
  active: { mark: "✓", label: "active", tone: "ok" },
  unavailable: { mark: "✗", label: "unavailable", tone: "bad" },
  error: { mark: "✗", label: "error", tone: "bad" },
  unknown: { mark: "?", label: "unknown", tone: "dim" },
};

/**
 * Resolve the display status for a connection.
 * A demoted connection is healthy-credentialed but currently sorted last, so it
 * gets its own marker instead of being reported as an error.
 * @param {Object} connection
 * @returns {{mark: string, label: string, tone: string, demoted: boolean}}
 */
function connectionStatus(connection) {
  const raw = String(connection?.testStatus || "unknown").toLowerCase();
  const base = STATUS_STYLE[raw] || STATUS_STYLE.unknown;
  const demoted = Boolean(connection?.demotedAt);
  if (demoted) {
    return { mark: "⇣", label: "demoted", tone: "warn", demoted: true };
  }
  return { ...base, demoted: false };
}

/**
 * One-line label for a connection row.
 * @param {Object} connection
 * @param {number} index - 1-based position within the provider's list
 * @param {number} total
 * @returns {string}
 */
function connectionLabel(connection, index, total) {
  const status = connectionStatus(connection);
  const name = connection?.name || connection?.email || connection?.displayName || "Unnamed";
  const prefix = total > 1 ? `${String(index).padStart(2)}/${total} ` : "";
  const disabled = connection?.isActive === false ? " [off]" : "";
  const priority = connection?.priority !== undefined && connection.priority !== null
    ? ` p${connection.priority}`
    : "";
  return `${prefix}${name} ${status.mark}${disabled}${priority}`;
}

/**
 * Sort connections the way the router sees them: active first, then by
 * priority, then demoted last. A disabled connection is always after an
 * enabled one regardless of priority.
 * @param {Array<Object>} connections
 * @returns {Array<Object>} new array
 */
function sortConnections(connections) {
  return [...(connections || [])].sort((a, b) => {
    const offA = a?.isActive === false ? 1 : 0;
    const offB = b?.isActive === false ? 1 : 0;
    if (offA !== offB) return offA - offB;

    const demA = a?.demotedAt ? 1 : 0;
    const demB = b?.demotedAt ? 1 : 0;
    if (demA !== demB) return demA - demB;

    const priA = a?.priority === undefined || a?.priority === null ? Number.MAX_SAFE_INTEGER : Number(a.priority);
    const priB = b?.priority === undefined || b?.priority === null ? Number.MAX_SAFE_INTEGER : Number(b.priority);
    if (priA !== priB) return priA - priB;

    return String(a?.name || a?.email || "").localeCompare(String(b?.name || b?.email || ""));
  });
}

/**
 * Next priority that places a connection at a new position.
 * Programs send the whole list because the API updates one connection at a time
 * and duplicate priorities would make the order unstable.
 * @param {Array<Object>} connections - current list, already sorted
 * @param {string} connectionId - the one being moved
 * @param {number} direction - -1 to move up, +1 to move down
 * @returns {Array<{id: string, priority: number}>} changes to PATCH, may be empty
 */
function planPriorityMove(connections, connectionId, direction) {
  const list = [...(connections || [])];
  const index = list.findIndex((c) => c?.id === connectionId);
  if (index === -1) return [];

  const target = index + direction;
  if (target < 0 || target >= list.length) return [];

  // Swap positions, then renumber the whole list so priorities stay unique.
  [list[index], list[target]] = [list[target], list[index]];
  return list
    .map((c, i) => ({ id: c?.id, priority: i + 1 }))
    .filter(({ id, priority }) => {
      const current = connections.find((c) => c?.id === id);
      return current ? Number(current.priority) !== priority : true;
    });
}

/**
 * Summarise a batch test response.
 * @param {Object} data - { results, summary }
 * @returns {{total: number, passed: number, failed: number, failures: Array}}
 */
function summariseBatch(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const failures = results
    .filter((r) => !r?.valid)
    .map((r) => ({
      name: r?.connectionName || r?.connectionId || "unknown",
      error: r?.error || "unknown error",
      statusCode: r?.statusCode ?? null,
    }));
  return {
    total: results.length,
    passed: results.filter((r) => r?.valid).length,
    failed: failures.length,
    failures,
  };
}

/**
 * Providers with zero connections clutter a list that is otherwise actionable.
 * Keeps everything when nothing is connected, so the list is never empty.
 * @param {Array<{count: number}>} entries
 * @param {boolean} onlyConnected
 */
function filterProviders(entries, onlyConnected) {
  if (!onlyConnected) return [...(entries || [])];
  const connected = (entries || []).filter((e) => (e?.count || 0) > 0);
  return connected.length > 0 ? connected : [...(entries || [])];
}

module.exports = {
  connectionStatus,
  connectionLabel,
  sortConnections,
  planPriorityMove,
  summariseBatch,
  STATUS_STYLE,
};