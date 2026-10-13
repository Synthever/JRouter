const CONTEXTS = new Set(["invocation", "members", "key-allow", "key-block", "media"]);
const CAP_FLAGS = ["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "search", "tools", "reasoning"];

export function resolveCatalogContext(context, kindFilter) {
  if (context != null) {
    if (!CONTEXTS.has(context)) throw new Error("Invalid model catalog context.");
    return context;
  }
  return kindFilter && kindFilter !== "llm" ? "media" : "invocation";
}

export function normalizePublicCatalog(payload) {
  const invalid = () => { throw new Error("Invalid public model catalog."); };
  if (!payload || !Array.isArray(payload.models)) invalid();
  const seen = new Set();
  return payload.models.map(entry => {
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" ||
        entry.kind !== "llm" || !["alias", "combo"].includes(entry.targetType) ||
        entry.id !== `jrouter/${entry.name}` || !entry.name.trim() ||
        entry.name.startsWith("jrouter/") || entry.name.split("/").some(part => !part) ||
        /[\x00-\x1f\x7f\\?#<>\[\]]|:\/\//.test(entry.name) || seen.has(entry.id)) invalid();
    seen.add(entry.id);
    let caps = null;
    if (entry.capabilities != null) {
      if (typeof entry.capabilities !== "object" || Array.isArray(entry.capabilities)) invalid();
      caps = {};
      for (const key of CAP_FLAGS) if (typeof entry.capabilities[key] === "boolean") caps[key] = entry.capabilities[key];
      for (const key of ["contextWindow", "maxOutput"]) {
        if (Number.isFinite(entry.capabilities[key]) && entry.capabilities[key] > 0) caps[key] = entry.capabilities[key];
      }
    }
    if (caps && !Object.keys(caps).length) caps = null;
    return { id: entry.id, value: entry.id, name: entry.name, targetType: entry.targetType,
      isAlias: entry.targetType === "alias", isCombo: entry.targetType === "combo", caps };
  });
}

export function selectContextCatalog({ catalogContext, virtuals = [], groups = {}, combos = [], includeLegacyCombos = false, excludePlaceholders = false, kindFilter = null, capFilter = null }) {
  const publicTargets = ["invocation", "key-allow", "key-block"].includes(catalogContext);
  const providerTargets = ["members", "media", "key-block"].includes(catalogContext);
  let memberGroups = providerTargets ? groups : {};
  if (providerTargets && (catalogContext !== "media" || excludePlaceholders)) {
    memberGroups = Object.fromEntries(Object.entries(groups).map(([id, group]) => [id, {
      ...group, models: group.models.filter(model => !model.value?.startsWith("jrouter/") &&
        (!excludePlaceholders || (!model.isPlaceholder && (!model.kind || model.kind === "llm")))),
    }]).filter(([, group]) => group.models.length));
  }
  const legacyCombos = !kindFilter && !capFilter && (catalogContext === "media" || (catalogContext === "members" && includeLegacyCombos));
  return {
    aliases: publicTargets ? virtuals.filter(entry => entry.targetType === "alias") : [],
    combos: publicTargets ? virtuals.filter(entry => entry.targetType === "combo") : legacyCombos
      ? combos.map(combo => ({ ...combo, value: combo.name, isCombo: true, targetType: "combo", isLegacyCombo: true })) : [],
    groups: memberGroups,
  };
}

export function filterCatalogEntries(entries, { searchQuery = "", capFilter = null, addedModelValues = [] } = {}) {
  const query = searchQuery.trim().toLowerCase();
  return entries.filter(entry => (!query || `${entry.name} ${entry.value || entry.id}`.toLowerCase().includes(query)) &&
    (!capFilter || entry.caps?.[capFilter] === true)).sort((a, b) =>
    Number(addedModelValues.includes(b.value)) - Number(addedModelValues.includes(a.value)) || a.name.localeCompare(b.name));
}
