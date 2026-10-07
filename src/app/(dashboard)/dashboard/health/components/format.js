export const statusLabel = (status) => ({ HEALTHY: "Healthy", DEGRADED: "Degraded", DOWN: "Down", UNKNOWN: "Unknown" })[status] || "Unknown";
export const percent = (value) => value == null ? "No data" : `${value.toFixed(2)}%`;
export const latency = (value) => value == null ? "No data" : value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
export function relativeTime(timestamp) {
  if (!timestamp) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export const dateTime = (value) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export async function readJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.errorMessage || "Health data could not be loaded");
  return data;
}
