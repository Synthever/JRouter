// Pure helpers behind the CLI Tools index: status classification, counting,
// filtering and product grouping. No React, no I/O — unit-tested directly.

export const TOOL_GROUPS = [
  {
    key: "cli",
    label: "CLI agents & TUI",
    icon: "terminal",
    description: "Terminal agents, TUIs and desktop assistants that read a config file or env vars.",
  },
  {
    key: "ide",
    label: "IDE & editor",
    icon: "code",
    description: "Extensions and editors that call the gateway from their own settings.",
  },
  {
    key: "mitm",
    label: "MITM tools",
    icon: "security",
    description: "IDEs intercepted at the network layer — configure them on the MITM page.",
  },
];

export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "needs-setup", label: "Needs setup" },
  { value: "not-installed", label: "Not installed" },
  { value: "guide", label: "Guide" },
];

export const TYPE_LABELS = {
  env: "Env vars",
  custom: "Config file",
  guide: "Guide",
  mitm: "MITM",
};

const COUNT_KEYS = {
  connected: "connected",
  "needs-setup": "needsSetup",
  "not-installed": "notInstalled",
  guide: "guide",
  mitm: "unknown",
  unknown: "unknown",
};

/** Classifies one tool. Guides and MITM tools need no status payload. */
export function statusOf(tool, status) {
  if (tool?.configType === "guide") {
    return { key: "guide", label: "Guide", variant: "info", dot: false };
  }
  if (tool?.configType === "mitm") {
    return { key: "mitm", label: "MITM", variant: "default", dot: false };
  }
  if (!status) {
    return { key: "unknown", label: "Unknown", variant: "default", dot: false };
  }
  if (status.installed === false) {
    return { key: "not-installed", label: "Not installed", variant: "default", dot: false };
  }
  if (status.hasJRouter) {
    return { key: "connected", label: "Connected", variant: "success", dot: true };
  }
  return { key: "needs-setup", label: "Needs setup", variant: "warning", dot: true };
}

/** Metric strip buckets. MITM tools are not part of this denominator. */
export function countStatuses(tools, statuses) {
  const counts = { connected: 0, needsSetup: 0, notInstalled: 0, guide: 0, unknown: 0 };
  for (const [id, tool] of Object.entries(tools || {})) {
    counts[COUNT_KEYS[statusOf(tool, statuses?.[id]).key]] += 1;
  }
  return counts;
}

export function toolEntries(tools, statuses, hrefFor) {
  return Object.entries(tools || {}).map(([id, tool]) => ({
    id,
    tool,
    status: statusOf(tool, statuses?.[id]),
    href: hrefFor(id),
  }));
}

export function filterEntries(entries, { query = "", status = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return entries.filter(({ id, tool, status: toolStatus }) => {
    if (status !== "all" && toolStatus.key !== status) return false;
    if (!needle) return true;
    return (
      String(tool.name || "").toLowerCase().includes(needle) ||
      String(tool.description || "").toLowerCase().includes(needle) ||
      id.toLowerCase().includes(needle)
    );
  });
}

export function groupTools(cliTools, mitmTools, statuses) {
  const cliEntries = toolEntries(cliTools, statuses, (id) => `/dashboard/cli-tools/${id}`);
  const mitmEntries = toolEntries(mitmTools, statuses, () => "/dashboard/mitm");
  const buckets = { cli: [], ide: [], mitm: mitmEntries };
  for (const entry of cliEntries) {
    buckets[entry.tool.group === "ide" ? "ide" : "cli"].push(entry);
  }
  return TOOL_GROUPS.map((group) => ({ ...group, entries: buckets[group.key] || [] }));
}
