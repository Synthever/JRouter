// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

/** Cancel the owned read without waiting for transport cleanup. */
export function waitWithSignal(operation, signal, onAbort = null) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve(operation);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      try { onAbort?.(signal.reason); } catch { /* Keep the original reason. */ }
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? signal.reason : error);
    });
  });
}

export function cancelBody(body, reason) {
  try { void Promise.resolve(body?.cancel(reason)).catch(() => {}); } catch { /* Best effort cleanup. */ }
}

function findSseFrameEnd(bytes, state) {
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    if (state.pendingCR) {
      state.pendingCR = false;
      if (byte === 10) {
        const boundary = state.pendingCRBoundary;
        state.pendingCRBoundary = false;
        if (boundary) return i + 1;
        continue;
      }
      const boundary = state.pendingCRBoundary;
      state.pendingCRBoundary = false;
      if (boundary) return i;
    }
    if (byte === 13) {
      state.pendingCR = true;
      state.pendingCRBoundary = !state.lineHasBytes;
      state.lineHasBytes = false;
      if (state.pendingCRBoundary && i + 1 === bytes.byteLength) return -1;
    } else if (byte === 10) {
      const boundary = !state.lineHasBytes;
      state.lineHasBytes = false;
      if (boundary) return i + 1;
    } else state.lineHasBytes = true;
  }
  return -1;
}

function concatSseParts(parts) {
  if (parts.length === 1) return parts[0];
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function recordUpstreamChunk(chunk, stats, armStall) {
  stats.chunkCount++;
  const size = chunk?.byteLength || chunk?.length || 0;
  stats.totalBytes += size;
  const now = Date.now();
  const gap = now - stats.lastChunkAt;
  stats.lastChunkAt = now;
  if (isDebugEnabled && (stats.chunkCount <= 5 || stats.chunkCount % 20 === 0 || gap > 5000)) {
    dbg("STREAM", `chunk #${stats.chunkCount} | size=${size}B | gap=${gap}ms | total=${stats.totalBytes}B`);
  }
  armStall();
}

function createAliasSseFrameStream(body, options, stats, armStall, clearStall, startTime) {
  const reader = body.getReader();
  const maxFrameBytes = 16 * 1024 * 1024;
  const delimiterState = { lineHasBytes: false, pendingCR: false, pendingCRBoundary: false };
  let sourceChunk = null;
  let sourceOffset = 0;
  let frameParts = [];
  let frameBytes = 0;
  let done = false;

  return new ReadableStream({
    start() { armStall(); },
    async pull(controller) {
      try {
        while (!done) {
          if (!sourceChunk || sourceOffset >= sourceChunk.byteLength) {
            const part = await waitWithSignal(reader.read(), options.signal, reason => cancelBody({ cancel: value => reader.cancel(value) }, reason));
            if (part.done) {
              done = true;
              clearStall();
              dbg("STREAM", `upstream EOF | chunks=${stats.chunkCount} | bytes=${stats.totalBytes} | dur=${Date.now() - startTime}ms`);
              reader.releaseLock();
              break;
            }
            sourceChunk = part.value;
            sourceOffset = 0;
            recordUpstreamChunk(sourceChunk, stats, armStall);
            if (!(sourceChunk instanceof Uint8Array)) { controller.enqueue(sourceChunk); sourceChunk = null; return; }
          }

          const remaining = sourceChunk.subarray(sourceOffset);
          const end = findSseFrameEnd(remaining, delimiterState);
          if (end >= 0) {
            const framePart = remaining.subarray(0, end);
            frameBytes += framePart.byteLength;
            if (frameBytes > maxFrameBytes) throw Object.assign(new Error("Provider SSE event exceeded the alias frame limit"), { code: "ALIAS_FRAME_LIMIT" });
            if (framePart.byteLength) frameParts.push(framePart);
            sourceOffset += end;
            if (frameParts.length) {
              const frame = concatSseParts(frameParts);
              frameParts = [];
              frameBytes = 0;
              controller.enqueue(frame);
              return;
            }
            continue;
          }

          frameBytes += remaining.byteLength;
          if (frameBytes > maxFrameBytes) throw Object.assign(new Error("Provider SSE event exceeded the alias frame limit"), { code: "ALIAS_FRAME_LIMIT" });
          if (remaining.byteLength) frameParts.push(remaining);
          sourceOffset = sourceChunk.byteLength;
          sourceChunk = null;
        }

        if (frameParts.length) {
          const partialFrame = concatSseParts(frameParts);
          frameParts = [];
          frameBytes = 0;
          controller.enqueue(partialFrame);
        } else controller.close();
      } catch (error) {
        cancelBody({ cancel: reason => reader.cancel(reason) }, error);
        controller.error(error);
      }
    },
    cancel(reason) {
      cancelBody({ cancel: value => reader.cancel(value) }, reason);
      clearStall();
    }
  }, { highWaterMark: 0 });
}

export async function readResponseText(response, signal) {
  signal?.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const cancel = reason => cancelBody({ cancel: r => reader.cancel(r) }, reason);
  try {
    while (true) {
      const { value, done } = await waitWithSignal(reader.read(), signal, cancel);
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) { cancel(error); throw error; }
  finally { reader.releaseLock(); }
}

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ onDisconnect, onError, log, provider, model, reqTag = "" } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      // Debug-only: Responses API has no [DONE] sentinel, so codex/droid close the
      // socket on every completed request. "📊 done" is the authoritative outcome line.
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: reason => abortController.abort(reason)
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 *
 * @param {function} [onAbortTerminal] - Receives a human-readable abort
 * message and returns terminal SSE bytes to emit downstream.
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  let terminalEmitted = false;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(error);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        // Treat network resets / socket hang up / abort as graceful close
        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkClose =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        // Graceful close on network/abort, or when a structured terminal is available
        // (Responses passthrough prefers response.failed + [DONE] over a raw transport error)
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(error);
          }
        } catch (e) { /* already closed or cancelled */ }
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS, options = {}) {
  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  let abortMessage = "upstream connection lost";
  let stallFailure = null;
  const t0 = Date.now();
  const upstreamStats = { chunkCount, totalBytes, lastChunkAt };
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      abortMessage = "stream stall timeout";
      dbg(tag, `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
      streamController.handleError?.(new Error("stream stall timeout"));
      if (options.alias) stallFailure = Object.assign(new Error(abortMessage), { code: "ALIAS_STREAM_STALL" });
      streamController.abort?.(stallFailure || undefined);
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); streamController.abort(); }
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${stallTimeoutMs}ms`);

  const frameSse = options.alias === true && providerResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "text/event-stream";
  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      recordUpstreamChunk(chunk, upstreamStats, armStall);
      controller.enqueue(chunk);
    },
    flush() {
      dbg(tag, `upstream EOF | chunks=${upstreamStats.chunkCount} | bytes=${upstreamStats.totalBytes} | dur=${Date.now() - t0}ms`);
      clearStall();
    }
  });

  const upstreamSource = frameSse
    ? createAliasSseFrameStream(providerResponse.body, options, upstreamStats, armStall, clearStall, t0)
    : providerResponse.body.pipeThrough(upstreamTap, options.alias && options.signal ? { signal: options.signal } : undefined);
  const transformedBody = upstreamSource.pipeThrough(transformStream, options.alias && options.signal ? { signal: options.signal } : undefined);

  if (options.alias) {
    const signal = options.signal;
    const reader = transformedBody.getReader();
    let terminal = false;
    let abort;
    const finish = () => { terminal = true; clearStall(); signal?.removeEventListener("abort", abort); };
    const cancel = reason => cancelBody({ cancel: r => reader.cancel(r) }, reason);
    return new ReadableStream({
      start(controller) {
        abort = () => {
          if (terminal) return;
          finish(); cancel(signal.reason);
          options.onFailure?.(signal.reason);
          if (stallFailure && signal.reason === stallFailure && onAbortTerminal) {
            const bytes = onAbortTerminal(abortMessage, stallFailure);
            if (bytes) controller.enqueue(bytes);
            controller.close();
          } else controller.error(signal.reason);
        };
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      },
      async pull(controller) {
        if (terminal) return;
        try {
          const { done, value } = await waitWithSignal(reader.read(), signal, cancel);
          if (terminal) return;
          if (done) { finish(); reader.releaseLock(); streamController.handleComplete(); controller.close(); }
          else controller.enqueue(value);
        } catch (error) {
          if (terminal) return;
          finish(); cancel(error); options.onFailure?.(error);
          if (signal?.aborted) controller.error(signal.reason);
          else {
            streamController.handleError(error);
            const bytes = onAbortTerminal?.(error?.message || "upstream connection lost", error);
            if (bytes) { controller.enqueue(bytes); controller.close(); } else controller.error(error);
          }
        }
      },
      cancel(reason) { if (terminal) return; finish(); cancel(reason); streamController.handleDisconnect(reason); streamController.abort(); },
    });
  }

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    wrappedController,
    onAbortTerminal ? () => onAbortTerminal(abortMessage) : null
  );
}

