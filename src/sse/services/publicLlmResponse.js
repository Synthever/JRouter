import { FORMATS } from "../../../open-sse/translator/formats.js";

const responseEvents = new Set([
  "response.created", "response.in_progress", "response.completed",
  "response.failed", "response.incomplete", "response.queued",
]);
const geminiFormats = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY,
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewriteField(payload, key, publicId) {
  if (!Object.hasOwn(payload, key) || payload[key] === publicId) return payload;
  return { ...payload, [key]: publicId };
}

function rewriteNestedField(payload, key, field, publicId) {
  if (!Object.hasOwn(payload, key) || !isRecord(payload[key])) return payload;
  const nested = rewriteField(payload[key], field, publicId);
  return nested === payload[key] ? payload : { ...payload, [key]: nested };
}

export function rewritePublicModelFields(payload, publicId, format) {
  if (!isRecord(payload) || payload.type === "error" || payload.error) return payload;
  if (format === FORMATS.OPENAI || format === FORMATS.OLLAMA) {
    return rewriteField(payload, "model", publicId);
  }
  if (format === FORMATS.CLAUDE) {
    if (payload.type === "message_start") {
      return rewriteNestedField(payload, "message", "model", publicId);
    }
    return !payload.type || payload.type === "message"
      ? rewriteField(payload, "model", publicId) : payload;
  }
  if (format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE) {
    if (responseEvents.has(payload.type)) {
      return rewriteNestedField(payload, "response", "model", publicId);
    }
    return !payload.type ? rewriteField(payload, "model", publicId) : payload;
  }
  if (geminiFormats.has(format)) {
    return rewriteNestedField(rewriteField(payload, "modelVersion", publicId), "response", "modelVersion", publicId);
  }
  return payload;
}

const supportedFormats = new Set([
  FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES,
  FORMATS.OPENAI_RESPONSE, FORMATS.OLLAMA, ...geminiFormats,
]);

function responseInit(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return { status: response.status, statusText: response.statusText, headers };
}

function rewriteJsonData(text, publicId, format) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return text;
  }
  const rewritten = rewritePublicModelFields(payload, publicId, format);
  return rewritten === payload ? text : JSON.stringify(rewritten);
}

function rewriteSseFrame(frame, publicId, format) {
  const lines = frame.split(/(\r?\n)/);
  const dataLines = [];
  let event = "";
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    if (line === "data" || line.startsWith("data:")) {
      const prefix = line === "data" ? "data" : line.match(/^data: ?/)[0];
      dataLines.push({ index, prefix, value: line.slice(prefix.length) });
    } else if (line === "event" || line.startsWith("event:")) {
      event = line.slice(6).replace(/^ /, "");
    }
  }
  if (!dataLines.length || event === "error") return frame;
  const data = dataLines.map(line => line.value).join("\n");
  const rewritten = rewriteJsonData(data, publicId, format);
  if (rewritten === data) return frame;
  for (let index = 0; index < dataLines.length; index++) {
    const line = dataLines[index];
    // Retain all data lines: subsequent empty values join as legal JSON whitespace.
    lines[line.index] = index === 0
      ? `${line.prefix === "data" ? "data:" : line.prefix}${rewritten}` : line.prefix;
  }
  return lines.join("");
}

function rewriteNdjsonLine(line, publicId, format) {
  const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
  const data = ending ? line.slice(0, -ending.length) : line;
  return rewriteJsonData(data, publicId, format) + ending;
}

function rewriteStream(body, publicId, format, isSse) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const delimiter = isSse ? /\r?\n\r?\n/ : /\r?\n/;
  const rewrite = isSse ? rewriteSseFrame : rewriteNdjsonLine;
  let pending = "";
  let ended = false;
  let cancelled = false;
  let released = false;
  const release = () => {
    if (!released) {
      reader.releaseLock();
      released = true;
    }
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          const match = delimiter.exec(pending);
          if (match || (ended && pending)) {
            const end = match ? match.index + match[0].length : pending.length;
            const frame = pending.slice(0, end);
            pending = pending.slice(end);
            controller.enqueue(encoder.encode(rewrite(frame, publicId, format)));
            return;
          }
          if (ended) {
            controller.close();
            return;
          }
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) {
            ended = true;
            pending += decoder.decode();
            release();
          } else {
            pending += decoder.decode(value, { stream: true });
          }
        }
      } catch (error) {
        if (!cancelled) {
          pending = "";
          release();
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      cancelled = true;
      pending = "";
      try {
        if (!released) await reader.cancel(reason);
      } finally {
        release();
      }
    },
  }, { highWaterMark: 0 });
}

export async function adaptPublicLlmResponse(response, { publicId, format }) {
  if (!response.ok || !response.body || !supportedFormats.has(format)) return response;
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType === "text/event-stream" || mediaType === "application/x-ndjson" || mediaType === "application/ndjson") {
    return new Response(rewriteStream(response.body, publicId, format, mediaType === "text/event-stream"), responseInit(response));
  }
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) return response;
  const payload = await response.json();
  return new Response(JSON.stringify(rewritePublicModelFields(payload, publicId, format)), responseInit(response));
}
