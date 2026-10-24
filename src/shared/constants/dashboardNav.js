/** Single source of truth for dashboard navigation: sidebar groups and page search. */
export const DASHBOARD_NAV_GROUPS = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
    ],
  },
  {
    title: "Gateway",
    items: [
      { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns" },
      { href: "/dashboard/combos", label: "Combos", icon: "layers" },
    ],
  },
  {
    title: "Studio",
    items: [
      { href: "/dashboard/playground", label: "Playground", icon: "science" },
    ],
  },
  {
    title: "Monitor",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { href: "/dashboard/health", label: "Health", icon: "monitoring" },
      { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
    ],
  },
];

export const DASHBOARD_SYSTEM_ITEMS = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export const DASHBOARD_DEBUG_ITEMS = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

export const DASHBOARD_SETTINGS_ITEM = {
  href: "/dashboard/profile",
  label: "Settings",
  icon: "settings",
};

/** Flat page index for the topbar search. Group titles become the result hints. */
export function buildDashboardSearchIndex({ includeTranslator = true } = {}) {
  const entries = [];
  for (const group of DASHBOARD_NAV_GROUPS) {
    for (const item of group.items) entries.push({ ...item, group: group.title });
  }
  for (const item of DASHBOARD_SYSTEM_ITEMS) entries.push({ ...item, group: "System" });
  entries.push({ href: "/dashboard/media-providers/embedding", label: "Media Providers", icon: "perm_media", group: "System" });
  for (const item of DASHBOARD_DEBUG_ITEMS) {
    if (!includeTranslator && item.href === "/dashboard/translator") continue;
    entries.push({ ...item, group: "System" });
  }
  entries.push({ ...DASHBOARD_SETTINGS_ITEM, group: "System" });
  return entries;
}
