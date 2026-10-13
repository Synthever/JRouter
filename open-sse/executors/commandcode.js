import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { isQualifyingModelOutput } from "../utils/aliasOutput.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials, executionOptions = null) {
    body.stream = true;
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const attemptSignal = opts.executionOptions?.attempt?.signal;
    const signal = opts.signal && attemptSignal ? AbortSignal.any([opts.signal, attemptSignal]) : opts.signal || attemptSignal;
    signal?.throwIfAborted();
    const singleAttempt = opts.executionOptions?.alias === true || opts.executionOptions?.retryPolicy === "single-attempt";
    const maxRetries = opts.healthProbe || singleAttempt ? 0 : 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await super.execute(opts);
      if (!result?.response?.ok || !result.response.body) return result;

      const wrappedResponse = await inspectAndWrapCommandCodeResponse(result.response, opts.model, {
        signal: opts.signal, attempt: opts.executionOptions?.attempt,
      });
      if (!wrappedResponse.ok && attempt < maxRetries) {
        const isRetryableStatus = wrappedResponse.status === 502 || wrappedResponse.status === 503 || wrappedResponse.status === 504;
        if (isRetryableStatus) {
          opts.log?.debug?.("RETRY", `CommandCode upstream returned status ${wrappedResponse.status}, retrying ${attempt + 1}/${maxRetries}...`);
          signal?.throwIfAborted();
          await new Promise((resolve, reject) => {
            const onAbort = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(signal.reason); };
            const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, 1000 * (attempt + 1));
            signal?.addEventListener("abort", onAbort, { once: true });
          });
          signal?.throwIfAborted();
          continue;
        }
      }

      result.response = wrappedResponse;
      return result;
    }
  }

  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return {
      status,
      message: msg || `CommandCode upstream error: ${response.status}`,
    };
  }
}

export function parseCommandCodeError(event) {
  if (!event || typeof event !== "object") {
    return {
      statusCode: 503,
      message: "CommandCode upstream error",
      type: "server_error",
    };
  }

  const errVal = event.error ?? event.message ?? "unknown";
  let message = "";
  let statusCode = null;
  let type = "server_error";

  if (typeof errVal === "object" && errVal !== null) {
    message = errVal.message || errVal.error || JSON.stringify(errVal);
    if (errVal.statusCode && Number.isInteger(Number(errVal.statusCode))) {
      statusCode = Number(errVal.statusCode);
    } else if (errVal.status && Number.isInteger(Number(errVal.status))) {
      statusCode = Number(errVal.status);
    }
    if (errVal.type) type = errVal.type;
  } else if (typeof errVal === "string") {
    message = errVal;
  } else {
    message = JSON.stringify(errVal);
  }

  if (event.statusCode && Number.isInteger(Number(event.statusCode))) {
    statusCode = Number(event.statusCode);
  }

  if (!statusCode || statusCode < 400 || statusCode > 599) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests")) {
      statusCode = 429;
      type = "rate_limit_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
      statusCode = 401;
      type = "authentication_error";
    } else if (lower.includes("payment required") || lower.includes("billing")) {
      statusCode = 402;
      type = "billing_error";
    } else if (lower.includes("quota") || lower.includes("forbidden") || lower.includes("permission")) {
      statusCode = 403;
      type = "permission_error";
    } else if (lower.includes("not found")) {
      statusCode = 404;
      type = "invalid_request_error";
    } else if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("server error")) {
      statusCode = 503;
      type = "server_error";
    } else {
      statusCode = 503;
    }
  }

  return { statusCode, message, type };
}

function ownCommandCodeReader(reader, { signal, attempt } = {}) {
  const signals = [...new Set([signal, attempt?.signal].filter(Boolean))];
  let released = false;
  let terminal = false;
  let failReplay = null;
  let boundaries = 0;
  const release = () => {
    if (released) return;
    released = true;
    try { reader.releaseLock(); } catch { /* Preserve the primary error. */ }
  };
  const finish = () => {
    terminal = true;
    for (const source of signals) source.removeEventListener("abort", onAbort);
  };
  const cancel = (reason) => {
    if (terminal) return;
    finish();
    try { void reader.cancel(reason).catch(() => {}); } catch { /* Cleanup is best effort. */ }
    release();
  };
  const onAbort = () => {
    const source = signals.find(source => source.aborted);
    cancel(source.reason);
    failReplay?.(source.reason);
  };
  const check = () => {
    if (attempt && !attempt.outputStarted && Date.now() >= attempt.deadlineAt) attempt.abort("initial-output-deadline");
    for (const source of signals) source.throwIfAborted();
  };
  for (const source of signals) source.addEventListener("abort", onAbort, { once: true });
  if (signals.some(source => source.aborted)) onAbort();
  return {
    check,
    async checkpoint() {
      check();
      if (attempt && !attempt.outputStarted && ++boundaries % 64 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        check();
      }
    },
    async read() {
      check();
      try {
        const part = await reader.read();
        check();
        return part;
      } catch (error) { check(); throw error; }
    },
    cancel,
    upstreamDone() { release(); },
    done() { finish(); release(); },
    replay(controller) { failReplay = reason => controller.error(reason); check(); }
  };
}

export async function inspectAndWrapCommandCodeResponse(originalResponse, model, options = null) {
  const reader = originalResponse.body.getReader();
  const owner = ownCommandCodeReader(reader, options || {});
  const decoder = new TextDecoder();
  const inspectState = { model };
  const attempt = options?.attempt;
  const namedTools = new Set();
  let buffer = "";
  const rawChunks = [];
  let detectedError = null;
  let upstreamDone = false;

  const observe = (event) => {
    if (!attempt || event?.type === "error") return false;
    // Do not turn a malformed name-less tool into synthetic arguments output.
    if (event?.type === "tool-call" && (typeof event.toolName !== "string" || !event.toolName.trim())) return false;
    if (event?.type === "tool-input-start") {
      if (typeof event.toolName !== "string" || !event.toolName.trim()) return false;
      namedTools.add(event.id || event.toolCallId);
    }
    if (event?.type === "tool-input-delta" && !namedTools.has(event.id || event.toolCallId)) return false;
    const translated = commandCodeToOpenAIResponse(event, inspectState);
    for (const chunk of translated == null ? [] : Array.isArray(translated) ? translated : [translated]) {
      if (isQualifyingModelOutput(chunk, "openai")) {
        attempt.markOutput(chunk, "openai");
        owner.check();
        return attempt.outputStarted;
      }
    }
    return false;
  };
  try {
    while (true) {
      await owner.checkpoint();
      const { value, done } = await owner.read();
      if (done) {
        upstreamDone = true;
        owner.upstreamDone();
        const trimmed = buffer.trim();
        let parsed = null;
        if (trimmed) {
          try {
            const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
            parsed = JSON.parse(jsonStr);
          } catch { /* Ignore malformed JSON, not cancellation. */ }
        }
        if (parsed?.type === "error") detectedError = parsed;
        else observe(parsed);
        owner.done();
        break;
      }

      rawChunks.push(value);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let stopLoop = false;
      for (const line of lines) {
        await owner.checkpoint();
        const trimmed = line.trim();
        if (!trimmed) continue;
        const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!jsonStr || jsonStr === "[DONE]") {
          stopLoop = true;
          break;
        }

        let event;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (event?.type === "error") {
          detectedError = event;
          stopLoop = true;
          break;
        }

        if (attempt) {
          if (observe(event)) { stopLoop = true; break; }
          continue;
        }
        if (
          event?.type === "text-delta" ||
          event?.type === "reasoning-delta" ||
          event?.type === "tool-input-start" ||
          event?.type === "tool-call" ||
          event?.type === "finish" ||
          event?.type === "finish-step"
        ) {
          stopLoop = true;
          break;
        }
      }

      if (stopLoop) break;
    }
  } catch (error) {
    owner.check();
    if (attempt) {
      owner.cancel(error);
      throw error;
    }
    owner.done();
    return originalResponse;
  }

  if (detectedError) {
    owner.cancel();
    const { statusCode, message, type } = parseCommandCodeError(detectedError);
    return new Response(
      JSON.stringify({
        error: {
          message: `[CommandCode error: ${message}]`,
          type,
          code: statusCode,
        },
      }),
      {
        status: statusCode,
        statusText: statusCode === 503 ? "Service Unavailable" : (statusCode === 429 ? "Too Many Requests" : "Bad Gateway"),
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const combinedStream = createRawReplayedStream(rawChunks, owner, upstreamDone);
  return wrapNdjsonAsOpenAISse(combinedStream, model, originalResponse);
}

function createRawReplayedStream(rawChunks, owner, upstreamDone) {
  let chunkIndex = 0;
  let closed = false;
  return new ReadableStream({
    start(controller) {
      try { owner.replay(controller); } catch (error) { closed = true; controller.error(error); }
    },
    async pull(controller) {
      if (closed) return;
      try {
        owner.check();
        if (chunkIndex < rawChunks.length) {
          controller.enqueue(rawChunks[chunkIndex++]);
          return;
        }
        const { value, done } = upstreamDone ? { done: true } : await owner.read();
        if (done) {
          closed = true;
          owner.done();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        closed = true;
        owner.cancel(error);
        controller.error(error);
      }
    },
    cancel(reason) { closed = true; owner.cancel(reason); },
  });
}

function wrapNdjsonAsOpenAISse(streamBody, model, originalResponse = null) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) {
        emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
      }
      controller.enqueue(encoder.encode(SSE_DONE));
    },
  });

  const newBody = streamBody.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse?.status || 200,
    statusText: originalResponse?.statusText || "OK",
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...(originalResponse?.headers ? Object.fromEntries(originalResponse.headers.entries()) : {}),
      "content-type": "text/event-stream",
    },
  });
}

export default CommandCodeExecutor;
