import { randomUUID } from "node:crypto";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";
import { policyDefaults } from "./settings.js";
import { quotaPeriodStart, ApiKeyPolicyError } from "./rules.js";
import { POLICY_RATE_WINDOW_MS, POLICY_RESERVATION_TTL_MS } from "@/shared/constants/apiKeyPolicy.js";

function resetPeriod(db, key, policy, now) {
  const period = quotaPeriodStart(policy.quotaResetCycle, new Date(now));
  if (period !== key.quotaPeriodStartedAt) {
    db.run("UPDATE apiKeys SET quotaPeriodStartedAt = ?, quotaTokens = ?, quotaCost = ? WHERE id = ?", [period, period === null ? key.quotaTokens : 0, period === null ? key.quotaCost : 0, key.id]);
    key.quotaPeriodStartedAt = period;
    if (period !== null) { key.quotaTokens = 0; key.quotaCost = 0; }
  }
  return period;
}

function assertQuota(policy, key, tokens, cost) {
  if (policy.maxTokensQuota != null && (key.quotaTokens >= policy.maxTokensQuota || key.quotaTokens + tokens > policy.maxTokensQuota)) throw new ApiKeyPolicyError(429, "quota_exceeded", "API key token quota exceeded.");
  if (policy.maxCostUsd != null && (key.quotaCost >= policy.maxCostUsd || key.quotaCost + cost > policy.maxCostUsd)) throw new ApiKeyPolicyError(429, "cost_quota_exceeded", "API key cost quota exceeded.");
}

export function reserveKeyUsage(db, apiKeyId, estimate, now = Date.now()) {
  // Acquire the SQLite writer lock before reading counters so different Node
  // workers cannot both admit against the same snapshot.
  db.exec("BEGIN IMMEDIATE");
  try {
    const key = db.get("SELECT * FROM apiKeys WHERE id = ?", [apiKeyId]);
    if (!key || !key.isActive) throw new ApiKeyPolicyError(401, "invalid_api_key", "API key is invalid or inactive.");
    const policy = policyDefaults(parseJson(key.policy, {}));
    if (policy.expiresAt && Date.parse(policy.expiresAt) <= now) throw new ApiKeyPolicyError(401, "api_key_expired", "API key has expired.");
    const period = resetPeriod(db, key, policy, now);

    // A crashed worker cannot turn reserved usage into free quota. Charge its
    // remaining estimate once before releasing the stale reservation.
    const stale = db.all("SELECT * FROM apiKeyRequests WHERE apiKeyId = ? AND isPending = 1 AND expiresAt <= ?", [apiKeyId, now]);
    for (const row of stale) {
      const remainingTokens = Math.max(0, row.estimatedTokens - row.actualTokens);
      const remainingCost = Math.max(0, row.estimatedCost - row.actualCost);
      accountKeyUsage(db, row, remainingTokens, remainingCost, now);
      finishKeyUsage(db, row);
    }
    const current = db.get("SELECT * FROM apiKeys WHERE id = ?", [apiKeyId]);
    const outstanding = db.get(`SELECT COALESCE(SUM(MAX(0, estimatedTokens - actualTokens) * multiplier),0) AS tokens,
      COALESCE(SUM(MAX(0, estimatedCost - actualCost) * multiplier),0) AS cost FROM apiKeyRequests
      WHERE apiKeyId = ? AND isPending = 1`, [apiKeyId]);
    assertQuota(policy, current, outstanding.tokens + estimate.tokens * policy.tokenMultiplier, outstanding.cost + estimate.cost * policy.tokenMultiplier);

    const recent = db.get(`SELECT COUNT(*) AS requests, MIN(startedAt) AS oldest,
      COALESCE(SUM(CASE WHEN isPending = 1 THEN MAX(estimatedTokens,actualTokens) ELSE actualTokens END),0) AS tokens
      FROM apiKeyRequests WHERE apiKeyId = ? AND startedAt > ?`, [apiKeyId, now - POLICY_RATE_WINDOW_MS]);
    const tokenWindow = db.get(`SELECT COALESCE(SUM(CASE WHEN isPending = 1 THEN MAX(estimatedTokens,actualTokens) ELSE actualTokens END),0) AS tokens
      FROM apiKeyRequests WHERE apiKeyId = ? AND (isPending = 1 OR usageRecordedAt > ?)`, [apiKeyId, now - POLICY_RATE_WINDOW_MS]);
    const retryAfter = Math.max(1, Math.ceil((recent.oldest + POLICY_RATE_WINDOW_MS - now) / 1000));
    if (policy.rateLimitRpm != null && recent.requests >= policy.rateLimitRpm) throw new ApiKeyPolicyError(429, "rate_limit_exceeded", "API key requests per minute limit exceeded.", retryAfter);
    if (policy.rateLimitTpm != null && tokenWindow.tokens + estimate.tokens > policy.rateLimitTpm) throw new ApiKeyPolicyError(429, "token_rate_limit_exceeded", "API key tokens per minute limit exceeded.", Number.isFinite(retryAfter) ? retryAfter : 60);
    db.run("DELETE FROM apiKeyRequests WHERE apiKeyId = ? AND isPending = 0 AND startedAt <= ? AND usageRecordedAt <= ?", [apiKeyId, now - POLICY_RATE_WINDOW_MS, now - POLICY_RATE_WINDOW_MS]);
    const admission = { id: randomUUID(), apiKeyId, multiplier: policy.tokenMultiplier, quotaPeriodStartedAt: period };
    db.run(`INSERT INTO apiKeyRequests(id,apiKeyId,startedAt,expiresAt,quotaPeriodStartedAt,estimatedTokens,estimatedCost,multiplier)
      VALUES(?,?,?,?,?,?,?,?)`, [admission.id, apiKeyId, now, now + POLICY_RESERVATION_TTL_MS, period, estimate.tokens, estimate.cost, admission.multiplier]);
    db.run("UPDATE apiKeys SET lastUsedAt = ? WHERE id = ?", [new Date(now).toISOString(), apiKeyId]);
    db.exec("COMMIT");
    return admission;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function accountKeyUsage(db, admission, rawTokens, rawCost, now = Date.now()) {
  const key = db.get("SELECT * FROM apiKeys WHERE id = ?", [admission.apiKeyId]);
  if (!key) return;
  resetPeriod(db, key, policyDefaults(parseJson(key.policy, {})), now);
  const tokens = Math.max(0, Number(rawTokens) || 0);
  const cost = Math.max(0, Number(rawCost) || 0);
  db.run("UPDATE apiKeys SET quotaTokens = quotaTokens + ?, quotaCost = quotaCost + ? WHERE id = ?", [tokens * admission.multiplier, cost * admission.multiplier, admission.apiKeyId]);
  db.run("UPDATE apiKeyRequests SET actualTokens = actualTokens + ?, actualCost = actualCost + ?, usageRecordedAt = ? WHERE id = ?", [tokens, cost, now, admission.id]);
}

export function finishKeyUsage(db, admission) {
  db.run("UPDATE apiKeyRequests SET isPending = 0 WHERE id = ?", [admission.id]);
}
