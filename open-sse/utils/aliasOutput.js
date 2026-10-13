const DEFAULT_MAX_PRELUDE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024; // An oversized frame waits only until the fixed attempt deadline.
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

const nonEmpty = (value) => typeof value === "string" && value.length > 0;
const nonBlank = (value) => nonEmpty(value) && value.trim().length > 0;

function textExists(value) {
  if (nonEmpty(value)) return true;
  return Array.isArray(value) && value.some((item) => typeof item === "string" ? nonEmpty(item) : item && typeof item === "object" && (nonEmpty(item.text) || nonEmpty(item.value)));
}

function callExists(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)) return false;
  if (call.type !== undefined && call.type !== "function") return false;
  const fn = call.function && typeof call.function === "object" ? call.function : call;
  return nonBlank(fn.name) || nonEmpty(fn.arguments) || nonEmpty(fn.input);
}

function isHeartbeatFrame(frame) {
  const source = new TextDecoder().decode(frame).trim();
  return source === "" || source.split(/\r\n|\r|\n/).every((line) => !line || line.startsWith(":"));
}

function formatName(format) {
  const name = String(format ?? "").toLowerCase();
  if (["openai", "chat-completions", "openai-chat", "openai-compatible"].includes(name)) return "openai";
  if (["claude", "anthropic", "messages"].includes(name)) return "claude";
  if (["responses", "openai-responses"].includes(name)) return "responses";
  if (["gemini", "gemini-cli", "antigravity", "vertex", "google", "google-genai"].includes(name)) return "gemini";
  if (["ollama", "ollama-chat", "ollama-generate"].includes(name)) return "ollama";
  return name;
}

function openAiOutput(event) {
  return Array.isArray(event.choices) && event.choices.some((choice) => {
    const delta = choice?.delta ?? {};
    const message = choice?.message ?? {};
    return [delta.content, delta.reasoning_content, delta.reasoning, delta.refusal, message.content, message.reasoning_content, message.reasoning, message.refusal].some(textExists)
      || (Array.isArray(delta.tool_calls) && delta.tool_calls.some(callExists))
      || (Array.isArray(message.tool_calls) && message.tool_calls.some(callExists))
      || callExists(delta.function_call) || callExists(message.function_call);
  });
}

function claudeOutput(event) {
  const block = event.content_block;
  const delta = event.delta;
  if (event.type === "content_block_delta") {
    return (delta?.type === "text_delta" && textExists(delta.text))
      || ((delta?.type === "thinking_delta" || delta?.type === "redacted_thinking_delta") && textExists(delta.thinking))
      || (delta?.type === "input_json_delta" && textExists(delta.partial_json));
  }
  if (event.type === "content_block_start") {
    return (block?.type === "text" && textExists(block.text))
      || ((block?.type === "thinking" || block?.type === "redacted_thinking") && textExists(block.thinking))
      || (block?.type === "tool_use" && (nonBlank(block.name) || textExists(block.input)));
  }
  if (event.type === "message" && Array.isArray(event.content)) {
    return event.content.some((item) => item?.type === "text" ? textExists(item.text) : item?.type === "thinking" ? textExists(item.thinking) : item?.type === "tool_use" && (nonBlank(item.name) || textExists(item.input)));
  }
  return false;
}

function responseItemOutput(item) {
  if (item?.type === "function_call") return nonBlank(item.name) || textExists(item.arguments);
  if (item?.type === "reasoning") return (Array.isArray(item.summary) && item.summary.some((part) => textExists(part?.text)))
    || (Array.isArray(item.content) && item.content.some((part) => textExists(part?.text)));
  return item?.type === "message" && Array.isArray(item.content) && item.content.some((part) => part?.type === "refusal" ? textExists(part.refusal) : ["output_text", "text"].includes(part?.type) && textExists(part.text));
}

function responsesOutput(event) {
  const type = event.type;
  if (type === "response.refusal.done") return textExists(event.refusal);
  if (["response.output_text.delta", "response.output_text.done", "response.refusal.delta", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_text.delta", "response.reasoning_text.done", "response.reasoning.delta", "response.function_call_arguments.delta", "response.function_call_arguments.done"].includes(type) && textExists(event.delta ?? event.text ?? event.arguments)) return true;
  if (["response.output_item.added", "response.output_item.done"].includes(type) && responseItemOutput(event.item)) return true;
  const response = event.response ?? event;
  return (Array.isArray(response.output) && response.output.some(responseItemOutput))
    || (type === "response.completed" && textExists(response.output_text));
}

function geminiOutput(event) {
  const response = event.response ?? event;
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const parts = candidates.flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .concat(Array.isArray(response.content?.parts) ? response.content.parts : []);
  return parts.some((part) => textExists(part?.text) || (part?.functionCall && nonBlank(part.functionCall.name)));
}

function ollamaOutput(event) {
  const message = event.message ?? {};
  return [message.content, message.thinking, event.response, event.content, event.thinking].some(textExists)
    || (Array.isArray(message.tool_calls) && message.tool_calls.some(callExists))
    || (Array.isArray(event.tool_calls) && event.tool_calls.some(callExists));
}

export function isQualifyingModelOutput(event, format) {
  if (!event || typeof event !== "object" || Array.isArray(event) || readAliasProtocolError(event, format)) return false;
  switch (formatName(format)) {
    case "openai": return openAiOutput(event);
    case "claude": return claudeOutput(event);
    case "responses": return responsesOutput(event);
    case "gemini": return geminiOutput(event);
    case "ollama": return ollamaOutput(event);
    default: return false;
  }
}

function messageFor(error) {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  return [error.message, error.type, error.code, error.status].filter((value) => value !== undefined && value !== null).join(": ");
}

export function readAliasProtocolError(event, format) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const normalizedFormat = formatName(format);
  const eventType = typeof event.type === "string" ? event.type : (typeof event.event === "string" ? event.event : null);
  let error = event.error;
  let status = Number.isFinite(event.status) ? event.status : (Number.isFinite(event.code) ? event.code : null);
  if (["responses", "gemini"].includes(normalizedFormat) && event.response?.error) {
    error = event.response.error;
    status = status ?? event.response.status_code ?? null;
  }
  if (normalizedFormat === "gemini" && error) status = status ?? error.code ?? null;
  const flatError = normalizedFormat === "responses" && eventType === "error" && error == null;
  if (flatError) error = event;
  const failedEvent = ["error", "response.failed"].includes(eventType) || event.status === "failed"
    || (normalizedFormat === "responses" && event.response?.status === "failed");
  if (!failedEvent && (error === undefined || error === null || error === false || error === "")) return null;
  return {
    format: normalizedFormat,
    code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : null,
    message: (flatError && nonEmpty(error.message) ? error.message : messageFor(error)) || (failedEvent ? `Provider emitted ${eventType ?? "a failed response"}` : "Provider returned a protocol error"),
    status: Number.isFinite(status) ? status : null,
    eventType,
  };
}

function makeError(code, message, extra = {}) {
  return Object.assign(new Error(message), { name: "AliasResponseGateError", code, ...extra });
}

function checkProtocolError(event, format) {
  const detail = readAliasProtocolError(event, format);
  return detail ? makeError("ALIAS_PROTOCOL_ERROR", detail.message, { protocolError: true, detail }) : null;
}

function parseJson(data, format, eventName) {
  if (!data || data.trim() === "[DONE]") return { event: null, done: true };
  let event;
  try {
    event = JSON.parse(data);
  } catch {
    if (eventName === "error") event = { type: "error", error: data };
    else return { event: null, done: false };
  }
  if (eventName && event && typeof event === "object" && event.type === undefined) event = { ...event, type: eventName };
  const error = checkProtocolError(event, format);
  if (error) throw error;
  return { event, done: false };
}

function parseSse(frame, format) {
  const source = new TextDecoder().decode(frame).replace(/(?:\r\n|\r|\n){1,2}$/, "");
  const data = [];
  let eventName = null;
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    if (field === "event") eventName = value;
  }
  return data.length ? parseJson(data.join("\n"), format, eventName) : { event: null, done: false };
}

function parseNdjson(frame, format) {
  const source = new TextDecoder().decode(frame).replace(/\r?\n$/, "").trim();
  if (!source) return { event: null, done: false };
  let event;
  try { event = JSON.parse(source); } catch { return { event: null, done: false }; }
  const error = checkProtocolError(event, format);
  if (error) throw error;
  return { event, done: false };
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function delimiterIndex(bytes, ndjson) {
  for (let i = 0; i < bytes.length; i += 1) {
    if (ndjson && bytes[i] === 10) return i + 1;
    if (!ndjson && bytes[i] === 10 && bytes[i + 1] === 10) return i + 2;
    if (!ndjson && bytes[i] === 13 && bytes[i + 1] === 13) return i + 2;
    if (!ndjson && bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) return i + 4;
    if (!ndjson && bytes[i] === 10 && bytes[i + 1] === 13 && bytes[i + 2] === 10) return i + 3;
  }
  return 0;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason;
}

function checkInitialAttempt(attempt) {
  if (!attempt.outputStarted && Date.now() >= attempt.deadlineAt) attempt.abort("initial-output-deadline");
  throwIfAborted(attempt.signal);
}

function createReadinessCheckpoint(attempt) {
  let boundaries = 0;
  return async () => {
    checkInitialAttempt(attempt);
    // Ready reads and frames can otherwise monopolize promise microtasks.
    if (!attempt.outputStarted && ++boundaries % 64 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkInitialAttempt(attempt);
    }
  };
}

function waitForAbort(attempt) {
  checkInitialAttempt(attempt);
  const signal = attempt.signal;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readWithAbort(reader, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reader.cancel(signal.reason);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const read = reader.read();
    read.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

function ownReader(reader) {
  if (!reader) return null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  return {
    read: () => reader.read(),
    release,
    cancel(reason) {
      if (released) return;
      try {
        // Cancellation settles pending reads even if the source cleanup never settles.
        void reader.cancel(reason).catch(() => {});
      } catch { /* preserve the primary stream error */ }
      finally { release(); }
    },
  };
}

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}

function replayResponse(response, reader, signal, initialBytes, upstreamDone = false) {
  let abortHandler;
  let terminal = false;
  const finish = () => {
    terminal = true;
    signal.removeEventListener("abort", abortHandler);
  };
  const body = new ReadableStream({
    start(controller) {
      abortHandler = () => {
        if (terminal) return;
        finish();
        reader.cancel(signal.reason);
        controller.error(signal.reason);
      };
      if (signal.aborted) return abortHandler();
      if (initialBytes.byteLength) controller.enqueue(initialBytes);
      if (upstreamDone) {
        finish();
        reader.release();
        controller.close();
      } else signal.addEventListener("abort", abortHandler, { once: true });
    },
    async pull(controller) {
      if (terminal) return;
      try {
        const part = await readWithAbort(reader, signal);
        if (terminal) return;
        throwIfAborted(signal);
        if (part.done) {
          finish();
          reader.release();
          controller.close();
        } else if (part.value?.byteLength) controller.enqueue(part.value);
      } catch (error) {
        if (terminal) return;
        finish();
        reader.cancel(error);
        controller.error(error);
      }
    },
    cancel(reason) {
      if (terminal) return;
      finish();
      reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: responseHeaders(response) });
}

async function gateBuffered(response, { attempt, format, maxBufferedBytes }) {
  const reader = ownReader(response.body?.getReader());
  if (!reader) throw makeError("ALIAS_NO_OUTPUT", "Provider returned an empty response body", { status: response.status });
  const chunks = [];
  let size = 0;
  const checkpoint = createReadinessCheckpoint(attempt);
  const onAbort = () => { reader.cancel(attempt.signal.reason); };
  attempt.signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      await checkpoint();
      const part = await readWithAbort(reader, attempt.signal);
      checkInitialAttempt(attempt);
      if (part.done) break;
      if (!part.value?.byteLength) continue;
      size += part.value.byteLength;
      if (size > maxBufferedBytes) throw makeError("ALIAS_BUFFER_LIMIT", "Buffered provider response exceeded the safety bound", { maxBufferedBytes });
      chunks.push(part.value);
    }
  } catch (error) {
    reader.cancel(error);
    throw error;
  } finally {
    attempt.signal.removeEventListener("abort", onAbort);
    reader.release();
  }
  const bytes = concatBytes(chunks);
  let event;
  try { event = JSON.parse(new TextDecoder().decode(bytes)); } catch (cause) {
    throw makeError("ALIAS_INVALID_JSON", "Provider returned invalid buffered JSON", { cause });
  }
  const failure = checkProtocolError(event, format);
  if (failure) throw failure;
  if (!response.ok) throw makeError("ALIAS_UPSTREAM_HTTP_ERROR", `Provider returned HTTP ${response.status}`, { status: response.status, payload: event });
  if (!isQualifyingModelOutput(event, format)) throw makeError("ALIAS_NO_OUTPUT", "Buffered response completed without semantic output", { status: response.status });
  checkInitialAttempt(attempt);
  attempt.markOutput(event, format);
  checkInitialAttempt(attempt);
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: responseHeaders(response) });
}

async function gateStream(response, { attempt, format, ndjson, maxPreludeBytes, maxFrameBytes, allowOutput = true }) {
  const reader = ownReader(response.body?.getReader());
  if (!reader) throw makeError("ALIAS_NO_OUTPUT", "Provider returned an empty stream", { status: response.status });
  const retained = [];
  let retainedSize = 0;
  let pending = new Uint8Array(0);
  const parseFrame = ndjson ? parseNdjson : parseSse;
  const checkpoint = createReadinessCheckpoint(attempt);
  const abortHandler = () => { reader.cancel(attempt.signal.reason); };
  attempt.signal.addEventListener("abort", abortHandler, { once: true });

  const inspectFrame = async (frame) => {
    await checkpoint();
    const parsed = parseFrame(frame, format);
    if (parsed.event && isQualifyingModelOutput(parsed.event, format)) {
      if (!allowOutput) {
        if (retainedSize + frame.byteLength <= maxPreludeBytes) {
          retained.push(frame);
          retainedSize += frame.byteLength;
        }
        return false;
      }
      checkInitialAttempt(attempt);
      attempt.markOutput(parsed.event, format);
      checkInitialAttempt(attempt);
      return true;
    }
    if (retainedSize + frame.byteLength <= maxPreludeBytes) {
      retained.push(frame);
      retainedSize += frame.byteLength;
    } else if (!isHeartbeatFrame(frame)) {
      await waitForAbort(attempt);
    }
    return false;
  };

  try {
    while (true) {
      await checkpoint();
      const part = await readWithAbort(reader, attempt.signal);
      checkInitialAttempt(attempt);
      if (part.done) {
        if (pending.byteLength > maxFrameBytes) await waitForAbort(attempt);
        reader.release();
        if (pending.byteLength && await inspectFrame(pending)) return replayResponse(response, reader, attempt.signal, concatBytes([...retained, pending]), true);
        if (!response.ok) throw makeError("ALIAS_UPSTREAM_HTTP_ERROR", `Provider returned HTTP ${response.status}`, { status: response.status });
        throw makeError("ALIAS_NO_OUTPUT", "Provider stream ended without semantic model output", { status: response.status });
      }
      if (!part.value?.byteLength) continue;
      const combined = pending.byteLength ? concatBytes([pending, part.value]) : part.value;
      let offset = 0;
      while (offset < combined.byteLength) {
        checkInitialAttempt(attempt);
        const remaining = combined.subarray(offset);
        const end = delimiterIndex(remaining, ndjson);
        if (!end) {
          if (remaining.byteLength > maxFrameBytes) await waitForAbort(attempt);
          pending = remaining.slice();
          break;
        }
        const frame = remaining.slice(0, end);
        if (frame.byteLength > maxFrameBytes) await waitForAbort(attempt);
        const qualifies = await inspectFrame(frame);
        offset += end;
        if (qualifies) {
          const tail = combined.subarray(offset);
          return replayResponse(response, reader, attempt.signal, concatBytes([...retained, frame, ...(tail.byteLength ? [tail] : [])]));
        }
        pending = new Uint8Array(0);
      }
    }
  } catch (error) {
    reader.cancel(error);
    throw error;
  } finally {
    attempt.signal.removeEventListener("abort", abortHandler);
  }
}

export async function gateAliasResponse(response, {
  attempt,
  format,
  maxPreludeBytes = DEFAULT_MAX_PRELUDE_BYTES,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
} = {}) {
  if (!attempt?.signal || typeof attempt.markOutput !== "function") throw new TypeError("gateAliasResponse requires an alias attempt");
  if (!(response instanceof Response)) throw new TypeError("gateAliasResponse requires a Response");
  for (const [name, value] of [["maxPreludeBytes", maxPreludeBytes], ["maxFrameBytes", maxFrameBytes], ["maxBufferedBytes", maxBufferedBytes]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  }
  checkInitialAttempt(attempt);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isEventStream = contentType.includes("text/event-stream") || contentType.includes("ndjson");
  if (!isEventStream) return gateBuffered(response, { attempt, format, maxBufferedBytes });
  return gateStream(response, { attempt, format, ndjson: contentType.includes("ndjson"), maxPreludeBytes, maxFrameBytes, allowOutput: response.ok });
}
