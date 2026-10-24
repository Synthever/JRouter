// Shared KPI bento metadata and layout canonicalization.
// No React imports: this module is safe on the server (API route + repo) and in the browser.

export const KPI_LAYOUT_STORAGE_KEY = "jrouter.dashboard.kpiLayout.v1";

// Reference layout: three equal cards, then two wider cards. Saved layouts win.
export const KPI_ITEMS = [
  { id: "requests", title: "Total requests", defaultSpan: 2 },
  { id: "cost", title: "Estimated cost", defaultSpan: 2 },
  { id: "connections", title: "Connections", defaultSpan: 2 },
  { id: "success", title: "Recent success", defaultSpan: 3 },
  { id: "tokens", title: "Total tokens", defaultSpan: 3 },
];

const MIN_SPAN = 2;
const MAX_SPAN = 6;

function clampSpan(span, fallback = MIN_SPAN) {
  const value = Number.isFinite(span) ? span : Number.isFinite(fallback) ? fallback : MIN_SPAN;
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.round(value)));
}

/**
 * Returns a canonical `{ id, span }[]` for the dashboard KPI grid: known IDs only,
 * first occurrence wins, spans are rounded and clamped to 2..6, and any missing
 * known KPI is appended in KPI_ITEMS order with its default span.
 * Non-array input (including malformed stored JSON) yields the default layout.
 */
export function sanitizeKpiLayout(value) {
  const known = new Map(KPI_ITEMS.map((item) => [item.id, item]));
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || !known.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, span: clampSpan(entry.span, known.get(entry.id).defaultSpan) });
  }
  for (const item of KPI_ITEMS) {
    if (!seen.has(item.id)) out.push({ id: item.id, span: clampSpan(item.defaultSpan) });
  }
  return out;
}

export const DEFAULT_KPI_LAYOUT = sanitizeKpiLayout(null);
