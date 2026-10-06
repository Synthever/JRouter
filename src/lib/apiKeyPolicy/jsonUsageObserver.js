// Retain small usage objects while skipping large image/audio strings. Scanner
// state survives chunk boundaries; quoted braces and escaped quotes are ignored.
export function jsonUsageObserver(onUsage) {
  let inString = false;
  let escaped = false;
  let text = "";
  let key = null;
  let valueKey = null;
  const objects = [];
  let captured = null;
  let captureDepth = 0;

  return (chunk) => {
    for (const character of chunk) {
      if (captured !== null) {
        if (captured.length < 65536) captured += character;
        else captured = null;
      }
      if (inString) {
        if (escaped) { escaped = false; if (text.length < 64) text += character; }
        else if (character === "\\") { escaped = true; if (text.length < 64) text += character; }
        else if (character === '"') { inString = false; key = text; }
        else if (text.length < 64) text += character;
        continue;
      }
      if (character === '"') { inString = true; text = ""; }
      else if (character === ":") { valueKey = key; key = null; }
      else if (character === "{") {
        const parent = objects.at(-1);
        const isUsage = valueKey === "usage" || valueKey === "usageMetadata";
        if (captured === null && isUsage && (objects.length === 1 || (objects.length === 2 && ["response", "message"].includes(parent)))) {
          captured = "{"; captureDepth = objects.length + 1;
        }
        objects.push(valueKey); valueKey = null; key = null;
      } else if (character === "}") {
        if (captured !== null && objects.length === captureDepth) {
          try { onUsage(JSON.parse(captured)); } catch { /* Malformed or oversized metadata is not billable usage. */ }
          captured = null;
        }
        objects.pop(); key = null; valueKey = null;
      } else if (!/\s/.test(character)) { key = null; valueKey = null; }
    }
  };
}
