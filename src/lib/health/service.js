import { getConfiguredHealthModels } from "./catalog.js";
import { probeModel } from "./probe.js";
import { DEFAULT_CONFIG, RANGES, availability, validateConfig, classifyFailure } from "./logic.js";
import * as repo from "@/lib/db/repos/modelHealthRepo.js";

export class HealthError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function publicModel(model, row = {}) {
  const stale = row.enabled && row.lastCheckAt && Date.now() - row.lastCheckAt > Math.max(row.intervalSeconds * 3, row.timeoutSeconds + 60) * 1000;
  return { ...model, status: stale ? "UNKNOWN" : row.status || "UNKNOWN", stale: !!stale,
    latencyMs: row.latestLatencyMs ?? null, avgLatencyMs: row.avgLatencyMs ?? null, availability: row.availability ?? null,
    checks: row.checks || 0, successful: row.successful || 0, lastCheckAt: row.lastCheckAt || null, lastSuccessAt: row.lastSuccessAt || null,
    config: Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, row[key] ?? DEFAULT_CONFIG[key]])),
    failures: row.failures || 0, successes: row.successes || 0 };
}

export async function getModelsHealth() {
  const [models, rows] = await Promise.all([getConfiguredHealthModels(), repo.getHealthRows()]);
  const byId = new Map(rows.map((row) => [row.modelId, row]));
  return models.map((model) => publicModel(model, byId.get(model.id)));
}

export function summarizeHealth(models) {
  const summary = { healthy: 0, degraded: 0, down: 0, unknown: 0, total: models.length, checks: 0, successful: 0, availability: null, avgLatencyMs: null };
  let latencySum = 0, latencyCount = 0;
  for (const model of models) {
    summary[model.status.toLowerCase()]++;
    summary.checks += model.checks;
    summary.successful += model.successful;
    if (model.avgLatencyMs != null) { latencySum += model.avgLatencyMs * model.successful; latencyCount += model.successful; }
  }
  summary.availability = availability(summary.successful, summary.checks);
  summary.avgLatencyMs = latencyCount ? latencySum / latencyCount : null;
  return summary;
}

export async function getHealthSummary() { return summarizeHealth(await getModelsHealth()); }

export async function requireModel(id) {
  const model = (await getConfiguredHealthModels()).find((item) => item.id === id);
  if (!model) throw new HealthError("Model is no longer enabled or configured", 404);
  return model;
}

export async function getHealthHistory(modelId = null, range = "3d") {
  if (!RANGES[range]) throw new HealthError("Choose 24h, 3d or 7d");
  const models = modelId ? [await requireModel(modelId)] : await getConfiguredHealthModels();
  const to = Date.now();
  return { range, ...await repo.aggregateTimeline(models.map((model) => model.id), to - RANGES[range], to) };
}

export async function getModelHealth(id, range = "3d", page = 1) {
  const models = await getModelsHealth();
  const model = models.find((item) => item.id === id);
  if (!model) throw new HealthError("Model is no longer enabled or configured", 404);
  const [history, recent, p95LatencyMs] = await Promise.all([getHealthHistory(id, range), repo.getRecentChecks(id, page), repo.getP95Latency(id)]);
  return { model: { ...model, p95LatencyMs }, history, recent };
}

export async function updateHealthConfig(id, input) {
  await requireModel(id);
  let config;
  try { config = validateConfig(input, await repo.getHealthConfig(id)); } catch (error) { throw new HealthError(error.message); }
  const saved = await repo.saveHealthConfig(id, config);
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, saved[key]]));
}

export async function checkModel(id, { model, scheduled = false } = {}) {
  model ||= await requireModel(id);
  const lease = await repo.claimCheck(id, scheduled);
  if (!lease) return { modelId: id, skipped: true, errorMessage: "A check is already running, capacity is busy, or the scheduled check is not due" };
  try {
    const result = await probeModel(model, lease.config);
    if (!result.executed) {
      if (scheduled) await repo.deferCheck(id);
      return { modelId: id, skipped: true, errorMessage: result.errorMessage };
    }
    const check = await repo.recordCheck({ ...result, modelId: id, providerId: model.providerId, source: "active" }, lease);
    if (!check) return { modelId: id, skipped: true, errorMessage: "Check lease expired; result discarded" };
    const row = (await repo.getHealthRows()).find((item) => item.modelId === id);
    return { modelId: id, check, model: publicModel(model, row) };
  } finally { await repo.releaseCheck(lease); }
}

export async function checkAllModels({ models, onResult = () => {}, signal, scheduled = false } = {}) {
  models ||= await getConfiguredHealthModels();
  let next = 0, completed = 0, skipped = 0;
  await Promise.all(Array.from({ length: Math.min(3, models.length) }, async () => {
    while (next < models.length && !signal?.aborted) {
      const model = models[next++];
      let result;
      try { result = await checkModel(model.id, { model, scheduled }); }
      catch { result = { modelId: model.id, skipped: true, errorMessage: "Health check could not be completed" }; }
      completed++;
      if (result.skipped) skipped++;
      await onResult({ ...result, completed, total: models.length });
    }
  }));
  return { completed, total: models.length, skipped };
}

// Passive observations are stored separately and cannot change authoritative active health.
export async function recordPassiveSignal({ modelId, providerId, apiKeyId, success, httpStatus, latencyMs, error }) {
  return repo.recordCheck({ modelId, providerId, apiKeyId, success: !!success, httpStatus: httpStatus ?? null,
    latencyMs: latencyMs ?? null, source: "passive", ...(success ? {} : classifyFailure({ httpStatus, message: error })) });
}

export async function getRoutingHealth(modelIds) {
  const models = await getModelsHealth();
  return Object.fromEntries(models.filter((model) => modelIds.includes(model.id)).map((model) => [model.id, { status: model.status, includeInRouting: model.config.includeInRouting, lastCheckAt: model.lastCheckAt }]));
}
