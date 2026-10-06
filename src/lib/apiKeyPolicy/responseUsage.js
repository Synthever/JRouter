import { estimateOutputTokens, canonicalizeUsage } from "open-sse/utils/usageTracking.js";
import { jsonUsageObserver } from "./jsonUsageObserver.js";

// Observe token metadata without buffering or changing the provider response.
export function responseUsageObserver(contentType) {
  const decoder = new TextDecoder();
  let buffer = "";
  let input = 0;
  let output = 0;
  let hasUsage = false;
  let outputChars = 0;
  const details = { cached_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0 };
  const isSse = contentType.includes("text/event-stream");
  const isJson = contentType.includes("json");
  function observeUsage(usage) {
    const normalized = canonicalizeUsage(Object.hasOwn(usage, "promptTokenCount") ? {
      prompt_tokens: usage.promptTokenCount, completion_tokens: usage.candidatesTokenCount,
      cached_tokens: usage.cachedContentTokenCount, reasoning_tokens: usage.thoughtsTokenCount,
    } : usage);
    if (!normalized) return;
    input = Math.max(input, normalized.prompt_tokens || 0);
    output = Math.max(output, normalized.completion_tokens || 0);
    for (const field of Object.keys(details)) details[field] = Math.max(details[field], normalized[field] || 0);
    hasUsage = true;
  }
  const observeJson = jsonUsageObserver(observeUsage);
  function parse(text) {
    try {
      const data = JSON.parse(text);
      const usage = data.usage || data.response?.usage || data.message?.usage || data.usageMetadata;
      if (usage) observeUsage(usage);
      const content = data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || data.delta?.text || (typeof data.delta === "string" ? data.delta : "");
      if (typeof content === "string") outputChars += content.length;
    } catch { /* Incomplete JSON or a terminal SSE marker. */ }
  }
  return {
    push(chunk) {
      if (!isJson && !isSse) return;
      const text = decoder.decode(chunk, { stream: true });
      if (isJson && !isSse) observeJson(text);
      buffer += text;
      if (isSse) {
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) if (line.startsWith("data:")) parse(line.slice(5).trim());
      }
      if (buffer.length > 1024 * 1024) buffer = buffer.slice(-65536);
    },
    result() {
      if (isJson) parse(buffer);
      else if (buffer.startsWith("data:")) parse(buffer.slice(5).trim());
      return { hasUsage, input, output: hasUsage ? output : estimateOutputTokens(outputChars), tokens: { ...details, prompt_tokens: input, completion_tokens: output } };
    },
  };
}
