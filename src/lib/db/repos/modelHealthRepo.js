import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { DEFAULT_CONFIG, advanceStatus, availability } from "../../health/logic.js";

function configFromRow(row) {
  return row ? { ...row, enabled: row.enabled === 1, includeInRouting: row.includeInRouting === 1 } : { ...DEFAULT_CONFIG, status: "UNKNOWN", failures: 0, successes: 0, lastCheckAt: null, lastSuccessAt: null, latestLatencyMs: null };
}

export async function getHealthConfig(modelId) {
  const db = await getAdapter();
  return configFromRow(db.get("SELECT * FROM modelHealthConfigs WHERE modelId = ?", [modelId]));
}

export async function saveHealthConfig(modelId, config) {
  const db = await getAdapter();
  const now = Date.now();
  db.run(`INSERT INTO modelHealthConfigs(modelId, enabled, intervalSeconds, timeoutSeconds, failureThreshold, recoveryThreshold, includeInRouting, createdAt, updatedAt, nextCheckAt)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(modelId) DO UPDATE SET enabled=excluded.enabled, intervalSeconds=excluded.intervalSeconds,
    timeoutSeconds=excluded.timeoutSeconds, failureThreshold=excluded.failureThreshold, recoveryThreshold=excluded.recoveryThreshold,
    includeInRouting=excluded.includeInRouting, updatedAt=excluded.updatedAt, nextCheckAt=excluded.nextCheckAt`,
  [modelId, +config.enabled, config.intervalSeconds, config.timeoutSeconds, config.failureThreshold, config.recoveryThreshold, +config.includeInRouting, now, now, now]);
  return getHealthConfig(modelId);
}

export async function claimLease(id, ttlMs = 90000, owner = randomUUID(), now = Date.now()) {
  const db = await getAdapter();
  const result = db.run(`INSERT INTO modelHealthLeases(id,owner,expiresAt) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expiresAt=excluded.expiresAt WHERE modelHealthLeases.expiresAt <= ?`, [id, owner, now + ttlMs, now]);
  return result.changes ? { id, owner } : null;
}

export async function releaseLease(lease) {
  if (!lease) return;
  const db = await getAdapter();
  db.run("DELETE FROM modelHealthLeases WHERE id=? AND owner=?", [lease.id, lease.owner]);
}

export async function renewLease(lease, ttlMs = 90000) {
  const db = await getAdapter();
  return db.run("UPDATE modelHealthLeases SET expiresAt=? WHERE id=? AND owner=?", [Date.now() + ttlMs, lease.id, lease.owner]).changes > 0;
}

export async function claimCheck(modelId, dueOnly = false) {
  const db = await getAdapter();
  const now = Date.now();
  const owner = randomUUID();
  return db.transaction(() => {
    const config = configFromRow(db.get("SELECT * FROM modelHealthConfigs WHERE modelId=?", [modelId]));
    if (dueOnly && (!config.enabled || config.nextCheckAt > now)) return null;
    const ttlMs = Math.max(90000, (config.timeoutSeconds + 30) * 1000);
    const acquire = (id) => db.run(`INSERT INTO modelHealthLeases(id,owner,expiresAt) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expiresAt=excluded.expiresAt WHERE modelHealthLeases.expiresAt <= ?`, [id, owner, now + ttlMs, now]).changes > 0;
    const id = `model:${modelId}`;
    if (!acquire(id)) return null;
    for (let i = 0; i < 3; i++) {
      const slot = `slot:${i}`;
      if (acquire(slot)) return { id, owner, slot, config };
    }
    db.run("DELETE FROM modelHealthLeases WHERE id=? AND owner=?", [id, owner]);
    return null;
  });
}

export async function releaseCheck(lease) {
  if (!lease) return;
  const db = await getAdapter();
  db.run("DELETE FROM modelHealthLeases WHERE owner=? AND id IN (?,?)", [lease.owner, lease.id, lease.slot]);
}

export async function recordCheck(check, lease = null) {
  const db = await getAdapter();
  return db.transaction(() => {
    if (lease && !db.get("SELECT id FROM modelHealthLeases WHERE id=? AND owner=? AND expiresAt>?", [lease.id, lease.owner, Date.now()])) return null;
    const now = check.checkedAt || Date.now();
    const completed = { ...check, id: randomUUID(), checkedAt: now, status: check.success ? "SUCCESS" : "FAILED" };
    db.run(`INSERT INTO modelHealthChecks(id,modelId,providerId,apiKeyId,source,status,success,latencyMs,httpStatus,errorType,errorMessage,checkedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [completed.id, check.modelId, check.providerId, check.apiKeyId || null, check.source || "active", completed.status, +check.success, check.latencyMs ?? null, check.httpStatus ?? null, check.errorType || null, check.errorMessage || null, now]);
    if (!check.source || check.source === "active") {
      const config = configFromRow(db.get("SELECT * FROM modelHealthConfigs WHERE modelId=?", [check.modelId]));
      const state = advanceStatus(config, check.success, config);
      db.run(`INSERT INTO modelHealthConfigs(modelId,createdAt,updatedAt,status,failures,successes,lastCheckAt,lastSuccessAt,latestLatencyMs,nextCheckAt)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(modelId) DO UPDATE SET updatedAt=excluded.updatedAt,status=excluded.status,
        failures=excluded.failures,successes=excluded.successes,lastCheckAt=excluded.lastCheckAt,lastSuccessAt=excluded.lastSuccessAt,
        latestLatencyMs=excluded.latestLatencyMs,nextCheckAt=excluded.nextCheckAt`,
      [check.modelId, now, now, state.status, state.failures, state.successes, now, check.success ? now : config.lastSuccessAt ?? null, check.latencyMs ?? null, now + config.intervalSeconds * 1000]);
    }
    return completed;
  });
}

export async function getHealthRows(now = Date.now()) {
  const db = await getAdapter();
  return db.all(`SELECT c.*, a.checks, a.successful, a.avgLatencyMs FROM modelHealthConfigs c
    LEFT JOIN (SELECT modelId,COUNT(*) checks,SUM(success) successful,AVG(CASE WHEN success=1 THEN latencyMs END) avgLatencyMs
    FROM modelHealthChecks WHERE source='active' AND checkedAt>=? GROUP BY modelId) a ON a.modelId=c.modelId`, [now - 86400000]).map((row) => ({ ...configFromRow(row), availability: availability(row.successful || 0, row.checks || 0), checks: row.checks || 0, successful: row.successful || 0 }));
}

export async function getRecentChecks(modelId, page = 1, pageSize = 20) {
  const db = await getAdapter();
  const params = [modelId];
  const total = db.get("SELECT COUNT(*) total FROM modelHealthChecks WHERE modelId=? AND source='active'", params).total;
  const checks = db.all("SELECT * FROM modelHealthChecks WHERE modelId=? AND source='active' ORDER BY checkedAt DESC,id DESC LIMIT ? OFFSET ?", [...params, pageSize, (page - 1) * pageSize]);
  return { checks: checks.map((row) => ({ ...row, success: row.success === 1 })), total, page, pageSize };
}

export async function getP95Latency(modelId, now = Date.now()) {
  const db = await getAdapter();
  const params = [modelId, now - 86400000];
  const count = db.get("SELECT COUNT(*) n FROM modelHealthChecks WHERE modelId=? AND checkedAt>=? AND source='active' AND success=1 AND latencyMs IS NOT NULL", params).n;
  if (!count) return null;
  return db.get("SELECT latencyMs FROM modelHealthChecks WHERE modelId=? AND checkedAt>=? AND source='active' AND success=1 AND latencyMs IS NOT NULL ORDER BY latencyMs LIMIT 1 OFFSET ?", [...params, Math.ceil(count * 0.95) - 1]).latencyMs;
}

export async function aggregateTimeline(modelIds, from, to, bucketCount = 72) {
  const db = await getAdapter();
  const size = (to - from) / bucketCount;
  const rows = modelIds.length ? db.all(`SELECT CAST((checkedAt-?)/? AS INTEGER) bucket, COUNT(*) checks, SUM(success) successful,
    AVG(CASE WHEN success=1 THEN latencyMs END) avgLatencyMs FROM modelHealthChecks WHERE source='active' AND checkedAt>=? AND checkedAt<?
    AND modelId IN (${modelIds.map(() => "?").join(",")}) GROUP BY bucket`, [from, size, from, to, ...modelIds]) : [];
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const row = byBucket.get(index);
    const checks = row?.checks || 0;
    const successful = row?.successful || 0;
    return { start: Math.round(from + index * size), end: Math.round(from + (index + 1) * size),
      checks, failures: checks - successful, availability: availability(successful, checks), avgLatencyMs: row?.avgLatencyMs ?? null,
      status: !checks ? "UNKNOWN" : successful === checks ? "HEALTHY" : successful === 0 ? "DOWN" : "DEGRADED" };
  });
  const total = rows.reduce((n, row) => n + row.checks, 0);
  return { from, to, availability: availability(rows.reduce((n, row) => n + row.successful, 0), total), checks: total, buckets };
}

export async function getDueModels(limit = 30, modelIds = null) {
  const db = await getAdapter();
  if (modelIds && !modelIds.length) return [];
  const eligible = modelIds ? ` AND modelId IN (${modelIds.map(() => "?").join(",")})` : "";
  return db.all(`SELECT modelId FROM modelHealthConfigs WHERE enabled=1 AND nextCheckAt<=?${eligible} ORDER BY nextCheckAt LIMIT ?`, [Date.now(), ...(modelIds || []), limit]).map((row) => row.modelId);
}

export async function deferCheck(modelId, seconds = 60) {
  const db = await getAdapter();
  db.run("UPDATE modelHealthConfigs SET nextCheckAt=? WHERE modelId=?", [Date.now() + seconds * 1000, modelId]);
}

export async function pruneHealthHistory(now = Date.now()) {
  const db = await getAdapter();
  db.run("DELETE FROM modelHealthChecks WHERE checkedAt<?", [now - 30 * 86400000]);
  db.run("DELETE FROM modelHealthLeases WHERE expiresAt<=?", [now]);
}
