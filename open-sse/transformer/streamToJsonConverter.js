import { waitWithSignal, cancelBody } from "../utils/streamHandler.js";
import { readAliasProtocolError } from "../utils/aliasOutput.js";

/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state, { onEvent, strict = false } = {}) {
  if (!msg.trim()) return;

  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!dataMatch || (!eventMatch && !strict && !onEvent)) return;

  let eventType = eventMatch?.[1].trim();
  const dataStr = dataMatch[1].trim();
  if (dataStr === "[DONE]") return;

  let parsed;
  try { parsed = JSON.parse(dataStr); }
  catch (cause) { if (strict) throw Object.assign(new Error("Invalid Responses SSE JSON"), { code: "ALIAS_INVALID_JSON", cause }); return; }
  eventType ||= parsed.type;
  if (eventType && parsed.type === undefined) parsed = { ...parsed, type: eventType };
  onEvent?.(parsed, "openai-responses");
  if (strict) {
    const detail = readAliasProtocolError(parsed, "openai-responses");
    if (detail) throw Object.assign(new Error(detail.message), { code: "ALIAS_PROTOCOL_ERROR", detail });
    if (eventType === "response.incomplete") throw new Error("Incomplete Responses stream");
    if (parsed.response?.model) state.model = parsed.response.model;
  }

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || state.responseId;
    state.created = parsed.response?.created_at || state.created;
  } else if (eventType === "response.output_item.done") {
    state.items.set(parsed.output_index ?? 0, parsed.item);
  } else if (eventType === "response.completed" || eventType === "response.done") {
    state.status = "completed";
    if (strict && Array.isArray(parsed.response?.output)) parsed.response.output.forEach((item, index) => state.items.set(index, item));
    if (strict && parsed.response?.usage) state.usage = { ...parsed.response.usage };
    if (parsed.response?.usage) {
      state.usage.input_tokens = parsed.response.usage.input_tokens || 0;
      state.usage.output_tokens = parsed.response.usage.output_tokens || 0;
      state.usage.total_tokens = parsed.response.usage.total_tokens || 0;
    }
  } else if (eventType === "response.failed") {
    state.status = "failed";
  }
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream, options = {}) {
  const { signal, strict = false } = options;
  signal?.throwIfAborted();
  if (!stream || typeof stream.getReader !== "function") {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const state = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map()
  };

  try {
    while (true) {
      const { done, value } = await waitWithSignal(reader.read(), signal, reason => cancelBody({ cancel: r => reader.cancel(r) }, reason));
      signal?.throwIfAborted();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split(strict || options.onEvent ? /\r\n\r\n|\n\n|\r\r/ : "\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        processSSEMessage(msg, state, options);
      }
    }

    // Flush remaining buffer (last event may not end with \n\n)
    if (buffer.trim()) {
      processSSEMessage(buffer + decoder.decode(), state, options);
    }
  } catch (error) {
    cancelBody({ cancel: reason => reader.cancel(reason) }, error);
    throw error;
  } finally {
    reader.releaseLock();
  }

  signal?.throwIfAborted();
  if (strict && state.status !== "completed") throw Object.assign(new Error("Responses stream ended without completion"), { code: "ALIAS_INCOMPLETE_STREAM" });

  // Build output array from accumulated items (ordered by index)
  const output = [];
  const maxIndex = state.items.size > 0 ? Math.max(...state.items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    output.push(state.items.get(i) || { type: "message", content: [], role: "assistant" });
  }

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    ...(strict && state.model ? { model: state.model } : {}),
    created_at: state.created,
    status: state.status || "completed",
    output,
    usage: state.usage
  };
}
