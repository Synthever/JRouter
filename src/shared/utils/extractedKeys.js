// Parse the "Extract Keys" JSON payload (or a bare array of entries) into
// bulk-add entries. Accepts the extract format
//   { provider, exportedAt, keys: [{ name, apiKey, isActive?, priority? }] }
// and tolerant variants (bare array, missing name, isActive false skipped,
// whitespace junk). Names may be empty → planner auto-names "Key N".
/**
 * @param {string} text raw pasted JSON
 * @returns {{ entries: {name: string, apiKey: string}[], provider: string|null, skipped: number, error: string|null }}
 */
export function parseExtractedKeys(text) {
  const fail = (error) => ({ entries: [], provider: null, skipped: 0, error });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("Invalid JSON.");
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.keys;
  if (!Array.isArray(list)) return fail('JSON must contain a "keys" array (or be an array of entries).');

  const entries = [];
  let skipped = 0;
  for (const item of list) {
    const apiKey = typeof item?.apiKey === "string" ? item.apiKey.trim() : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!apiKey) { skipped += 1; continue; }
    if (item?.isActive === false) { skipped += 1; continue; }
    entries.push({ name, apiKey });
  }
  if (!entries.length && skipped > 0) return fail("No usable keys found (all entries empty or inactive).");
  return {
    entries,
    provider: typeof parsed?.provider === "string" ? parsed.provider : null,
    skipped,
    error: null,
  };
}
