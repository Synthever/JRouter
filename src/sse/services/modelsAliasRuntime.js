import { randomUUID } from "node:crypto";
import { getConfiguredAliasOrder, getModelsAliasConfigKey, normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { classifyAliasMemberFailure } from "./modelsAliasFailure.js";

const key = Symbol.for("jrouter.modelsAliases.runtime");
const states = globalThis[key] ||= new Map();

function configuration(alias) {
  if (typeof alias?.id !== "string" || !alias.id) throw new Error("Models Alias requires a stable ID");
  const config = { id: alias.id, ...normalizeModelsAliasConfig(alias) };
  return { config, configKey: getModelsAliasConfigKey(config) };
}

function currentState(alias) {
  const { config, configKey } = configuration(alias);
  let state = states.get(config.id);
  if (state && state.configKey !== configKey) {
    invalidateModelsAliasRuntime(config.id);
    state = null;
  }
  if (!state) {
    const configuredOrder = getConfiguredAliasOrder(config);
    state = {
      aliasId: config.id, config, configKey, configVersion: randomUUID(),
      configuredOrder, order: [...configuredOrder], rotation: 0, orderVersion: 0,
      controller: new AbortController(), snapshots: new WeakMap(), leases: new WeakMap(),
      members: new Map(configuredOrder.map((id) => [id, {
        epoch: 0, retryAt: null, needsRecovery: false, recovery: null,
        transientFailures: 0, rateLimitLevel: 0,
      }])),
    };
    states.set(config.id, state);
  }
  return state;
}

function allowedKey(members) {
  if (!Array.isArray(members) || members.some((id) => typeof id !== "string")) throw new Error("allowedMembers must be configured requested member IDs");
  return JSON.stringify([...new Set(members)].sort());
}

function eligible(member, now) {
  return member.retryAt <= now && !member.recovery;
}

function effectiveOrder(state) {
  if (state.config.strategy === "fallback") return [...state.order];
  const order = state.configuredOrder;
  if (state.config.strategy === "round-robin") return [...order.slice(state.rotation), ...order.slice(0, state.rotation)];
  return [...order];
}

/** allowedMembers uses ResolvedMember.requested, never canonicalId. Omission fails closed. */
export function getAliasCandidateSnapshot(alias, { allowedMembers = [], now = Date.now() } = {}) {
  const state = currentState(alias);
  const authorizationKey = allowedKey(allowedMembers);
  const allowed = new Set(allowedMembers);
  const order = effectiveOrder(state);
  const candidates = order.filter((id) => allowed.has(id) && eligible(state.members.get(id), now));
  if (candidates.length && state.config.strategy === "round-robin") {
    state.rotation = (state.configuredOrder.indexOf(candidates[0]) + 1) % state.configuredOrder.length;
  }
  const retryTimes = state.configuredOrder.filter((id) => allowed.has(id)).map((id) => state.members.get(id)).filter((member) => !member.recovery && member.retryAt > now).map((member) => member.retryAt);
  const snapshot = Object.freeze({
    aliasId: state.aliasId, configVersion: state.configVersion,
    candidates: Object.freeze(candidates), serverNow: now,
    allIneligible: !candidates.length,
    retryAt: !candidates.length && retryTimes.length ? Math.min(...retryTimes) : null,
  });
  state.snapshots.set(snapshot, { source: alias, allowedMembers, authorizationKey, attempted: new Set() });
  return snapshot;
}

export function tryClaimAliasMember(snapshot, memberId, { now = Date.now() } = {}) {
  const state = states.get(snapshot?.aliasId);
  const request = state?.snapshots.get(snapshot);
  if (!request || state.configVersion !== snapshot.configVersion || state.controller.signal.aborted) return null;
  try {
    if (configuration(request.source).configKey !== state.configKey) {
      invalidateModelsAliasRuntime(state.aliasId);
      return null;
    }
    if (allowedKey(request.allowedMembers) !== request.authorizationKey) return null;
  } catch {
    invalidateModelsAliasRuntime(state.aliasId);
    return null;
  }
  if (!snapshot.candidates.includes(memberId) || request.attempted.has(memberId)) return null;
  const member = state.members.get(memberId);
  if (!member || !eligible(member, now)) return null;
  const lease = Object.freeze({ aliasId: state.aliasId, configVersion: state.configVersion, memberId, recovery: member.needsRecovery });
  state.leases.set(lease, { member, epoch: member.epoch, orderVersion: state.orderVersion, source: request.source });
  request.attempted.add(memberId);
  if (lease.recovery) member.recovery = lease;
  return lease;
}

function takeLease(lease) {
  const state = states.get(lease?.aliasId);
  const attempt = state?.leases.get(lease);
  if (!attempt || state.configVersion !== lease.configVersion || state.controller.signal.aborted) return null;
  state.leases.delete(lease);
  if (attempt.member.recovery === lease) attempt.member.recovery = null;
  try {
    if (configuration(attempt.source).configKey !== state.configKey) {
      invalidateModelsAliasRuntime(state.aliasId);
      return null;
    }
  } catch {
    invalidateModelsAliasRuntime(state.aliasId);
    return null;
  }
  if (attempt.epoch !== attempt.member.epoch) return null;
  return { state, ...attempt };
}

/** Returns the classification applied, or null for an already-consumed/stale lease. */
export function settleAliasMemberAttempt(lease, outcome, { now = Date.now() } = {}) {
  const attempt = takeLease(lease);
  if (!attempt) return null;
  const { state, member, orderVersion } = attempt;
  const result = classifyAliasMemberFailure(outcome, {
    now, provider: lease.memberId.split("/", 1)[0],
    transientFailures: member.transientFailures, rateLimitLevel: member.rateLimitLevel,
  });
  if (result.category === "success") {
    // Healthy successes cannot erase a concurrent failure's newer health epoch.
    if (member.needsRecovery) member.epoch++;
    member.needsRecovery = false;
    member.retryAt = null;
    member.transientFailures = 0;
    member.rateLimitLevel = 0;
  } else if (result.penalize) {
    member.epoch++;
    member.retryAt = result.retryAt;
    member.needsRecovery = true;
    member.transientFailures = result.transientFailures;
    member.rateLimitLevel = result.rateLimitLevel;
    if (state.config.strategy === "fallback" && lease.memberId !== state.config.primaryModel && orderVersion === state.orderVersion) {
      state.order = [...state.order.filter((id) => id !== lease.memberId), lease.memberId];
    }
  }
  return result;
}

export function releaseAliasMemberAttempt(lease) {
  return !!takeLease(lease);
}

export function getModelsAliasRuntimeStatus(alias, { now = Date.now() } = {}) {
  const state = currentState(alias);
  return {
    aliasId: state.aliasId, configVersion: state.configVersion, serverNow: now,
    configuredOrder: [...state.configuredOrder], effectiveOrder: effectiveOrder(state),
    members: state.configuredOrder.map((modelId) => {
      const member = state.members.get(modelId);
      return {
        modelId,
        status: member.retryAt > now ? "cooldown" : member.needsRecovery ? "recovering" : "available",
        retryAt: member.retryAt > now ? member.retryAt : null,
      };
    }),
  };
}

export function resetModelsAliasRuntimeOrder(alias) {
  const state = currentState(alias);
  state.order = [...state.configuredOrder];
  state.rotation = 0;
  state.orderVersion++;
}

export function invalidateModelsAliasRuntime(aliasId) {
  const state = states.get(aliasId);
  if (!state) return;
  states.delete(aliasId);
  state.controller.abort();
  for (const member of state.members.values()) member.recovery = null;
}

export function getModelsAliasConfigurationSignal(alias) {
  return currentState(alias).controller.signal;
}
