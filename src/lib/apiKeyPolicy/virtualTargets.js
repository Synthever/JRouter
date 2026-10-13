import REGISTRY from "open-sse/providers/registry/index.js";
import { getProviderAlias } from "@/shared/constants/providers.js";
import { ApiKeyPolicyError, assertModelAllowed } from "./rules.js";

const admissions = new WeakMap();
const providerPrefixes = new Map();
for (const entry of REGISTRY) {
  providerPrefixes.set(entry.id, [...new Set([entry.id, entry.alias, entry.uiAlias, ...(entry.aliases || [])].filter(Boolean))]);
}

export function virtualTargetIdentifiers(target) {
  return target.kind === "combo" ? [target.publicId, target.name] : [target.publicId];
}

export function modelIdentifiers(requested, info = {}, nodes = []) {
  const values = [requested, info.model];
  if (info.provider && info.model) {
    const prefixes = new Set([info.provider, getProviderAlias(info.provider), ...(providerPrefixes.get(info.provider) || [])]);
    for (const node of nodes) {
      if (node.id === info.provider && node.prefix && !REGISTRY.some((entry) => providerPrefixes.get(entry.id).includes(node.prefix))) prefixes.add(node.prefix);
    }
    for (const prefix of prefixes) values.push(`${prefix}/${info.model}`);
  }
  return [...new Set(values.filter((value) => typeof value === "string" && value.length))];
}

export function assertVirtualParentAllowed(target, policy) {
  assertModelAllowed(policy || {}, virtualTargetIdentifiers(target));
}

export function assertVirtualMemberNotBlocked(policy, identifiers) {
  assertModelAllowed({ blockedModels: policy?.blockedModels || [] }, identifiers);
}

function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

function deny() {
  throw new ApiKeyPolicyError(403, "model_not_allowed", "This model is not allowed for this API key.");
}

// Only the asynchronous admission service supplies resolved leaves and permissions.
export function createAuthorizedVirtualTarget(target, members, { policy = null, keyAccess = null, modelPermissions = null, providerNodes = [], configuredMembers = members } = {}) {
  const authorized = freezeSnapshot(structuredClone({ target, members, policy, keyAccess: keyAccess ? { keyId: keyAccess.keyId, keyName: keyAccess.keyName, allow: keyAccess.allow } : null }));
  admissions.set(authorized, {
    nodes: structuredClone(providerNodes),
    configuredMembers: structuredClone(configuredMembers),
    modelPermissions: modelPermissions === null ? null : new Set(modelPermissions),
    canonicalIds: new Set(members.map((member) => member.canonicalId)),
  });
  return authorized;
}

export function isAuthorizedVirtualTarget(authorized) {
  return admissions.has(authorized);
}

export function assertAuthorizedVirtualMember(authorized, requested, info, { extraComboMember = false } = {}) {
  const admission = admissions.get(authorized);
  if (!admission || !info?.provider || !info.model || info.provider === "jrouter") deny();
  const canonicalId = `${info.provider}/${info.model}`;
  const configured = admission.configuredMembers.filter((member) => member.canonicalId === canonicalId);
  const identifiers = [...modelIdentifiers(requested, info, admission.nodes), ...configured.flatMap((member) => modelIdentifiers(member.requested, member, admission.nodes))];
  assertVirtualMemberNotBlocked(authorized.policy, identifiers);
  if (admission.canonicalIds.has(canonicalId)) return;
  if (!extraComboMember || authorized.target.kind !== "combo") deny();
  const parentIds = new Set(virtualTargetIdentifiers(authorized.target));
  const ownIdentifiers = modelIdentifiers(null, info, admission.nodes).filter((id) => !parentIds.has(id) && !id.startsWith("jrouter/"));
  assertModelAllowed(authorized.policy || {}, ownIdentifiers);
  if (admission.modelPermissions && !admission.modelPermissions.has(canonicalId.toLowerCase())) deny();
}
