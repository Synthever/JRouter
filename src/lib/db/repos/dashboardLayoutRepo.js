import { makeKv } from "../helpers/kvStore.js";
import { sanitizeKpiLayout } from "@/shared/constants/dashboardKpi.js";

// kv scope/key for the dashboard's persisted KPI bento layout.
const layoutKv = makeKv("dashboardLayout");
const LAYOUT_KEY = "kpiBento";

/**
 * Reads the dashboard KPI layout, or null when nothing usable is stored.
 * Stored layouts are sanitized so a hand-edited or legacy DB row cannot
 * inject unknown widgets or out-of-range spans into the grid.
 */
export async function getDashboardKpiLayout() {
  const stored = await layoutKv.get(LAYOUT_KEY, null);
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.layout)) return null;
  return {
    layout: sanitizeKpiLayout(stored.layout),
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
  };
}

/** Canonicalizes and persists the layout; returns exactly what was stored. */
export async function saveDashboardKpiLayout(layout) {
  const saved = {
    layout: sanitizeKpiLayout(layout),
    updatedAt: new Date().toISOString(),
  };
  await layoutKv.set(LAYOUT_KEY, saved);
  return saved;
}

/** Removes the stored layout so the dashboard falls back to its defaults. */
export async function clearDashboardKpiLayout() {
  await layoutKv.remove(LAYOUT_KEY);
}
