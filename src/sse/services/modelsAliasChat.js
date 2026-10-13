import { isAuthorizedVirtualTarget, assertAuthorizedVirtualMember } from "@/lib/apiKeyPolicy/virtualTargets.js";
import { normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { applyComboPromptInjection } from "@/lib/comboPromptInjection.js";
import { createAliasAttempt } from "open-sse/services/aliasAttempt.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { detectFormat } from "open-sse/services/provider.js";
import { detectFormatByEndpoint, FORMATS } from "open-sse/translator/formats.js";
import { normalizeResponsesInput } from "open-sse/translator/formats/responsesApi.js";
import { RESPONSES_ITEM } from "open-sse/translator/schema/index.js";
import { initState, translateResponse } from "open-sse/translator/index.js";
import { openaiToAntigravityResponse } from "open-sse/translator/response/openai-to-antigravity.js";
import { parseSSEToOpenAIResponse } from "open-sse/handlers/chatCore/sseToJsonHandler.js";
import { getModelStrip, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { translateNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { formatSSE, SSE_DONE } from "open-sse/utils/stream.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { waitWithSignal } from "open-sse/utils/streamHandler.js";
import { executeProviderChat } from "../handlers/providerChat.js";
import { classifyAliasMemberFailure } from "./modelsAliasFailure.js";
import { getAliasCandidateSnapshot, tryClaimAliasMember, settleAliasMemberAttempt, getModelsAliasConfigurationSignal } from "./modelsAliasRuntime.js";
import * as defaultLog from "../utils/logger.js";

// Preserve typed media while removing only tool protocol blocks from panel history.
function panelBody(body) {
  const next = structuredClone(body);
  const text = value => typeof value === "string" ? value : JSON.stringify(value ?? "");
  const toolResult = value => Array.isArray(value)
    ? [{ type: "text", text: "[Tool result:]" }, ...value]
    : `[Tool result: ${text(value)}]`;
  const flatten = item => {
    if (["function_call", "custom_tool_call"].includes(item.type)) return { role: "assistant", content: `[Called tools: ${item.name || "tool"}]` };
    if (["function_call_output", "custom_tool_call_output"].includes(item.type)) return { role: "assistant", content: toolResult(item.output) };
    if (["tool", "function"].includes(item.role)) return { ...item, role: "assistant", content: toolResult(item.content), tool_call_id: undefined, name: undefined };
    if (item.function_call) {
      const { function_call, ...rest } = item;
      const note = { type: "text", text: `[Called tools: ${function_call.name || "tool"}]` };
      return { ...rest, content: Array.isArray(rest.content) ? [...rest.content, note] : `${rest.content || ""}\n${note.text}` };
    }
    if (item.tool_calls) {
      const { tool_calls, ...rest } = item;
      const note = { type: "text", text: `[Called tools: ${tool_calls.map(c => c.function?.name || c.name || "tool").join(", ")}]` };
      return { ...rest, content: Array.isArray(rest.content) ? [...rest.content, note] : `${rest.content || ""}\n${note.text}` };
    }
    if (Array.isArray(item.content)) return { ...item, content: item.content.flatMap(block => {
      if (block.type === "tool_use") return { type: "text", text: `[Called tools: ${block.name || "tool"}]` };
      if (block.type === "tool_result") return Array.isArray(block.content) ? toolResult(block.content) : { type: "text", text: toolResult(block.content) };
      return block;
    }) };
    return item;
  };
  for (const key of ["tools", "tool_choice", "toolChoice", "toolConfig", "functions", "function_call", "stream_options"]) delete next[key];
  for (const key of ["messages", "input"]) if (Array.isArray(next[key])) {
    next[key] = next[key].filter(item => item.type !== RESPONSES_ITEM.ADDITIONAL_TOOLS).map(flatten);
  }
  const gemini = next.request || next;
  for (const key of ["tools", "toolConfig", "tool_choice", "functions", "function_call", "stream_options"]) delete gemini[key];
  if (Array.isArray(gemini.contents)) gemini.contents = gemini.contents.map(item => ({ ...item, parts: (item.parts || []).map(part => {
    if (part.functionCall) return { text: `[Called tools: ${part.functionCall.name || "tool"}]` };
    if (part.functionResponse) return { text: `[Tool result: ${text(part.functionResponse.response)}]` };
    return part;
  }) }));
  next.stream = false;
  return next;
}

function storedCompletion(json, format) {
  if (json.choices?.[0]) return json;
  if (format === FORMATS.OPENAI_RESPONSES) {
    const state = { ...initState(FORMATS.OPENAI), model: json.model };
    const events = [];
    for (const item of json.output || []) {
      if (item.type === "message") for (const block of item.content || []) {
        if (block.text) events.push({ type: "response.output_text.delta", delta: block.text });
      }
      if (item.type === "reasoning") for (const block of item.summary || []) {
        if (block.text) events.push({ type: "response.reasoning_summary_text.delta", delta: block.text });
      }
      if (["function_call", "custom_tool_call"].includes(item.type)) {
        events.push({ type: "response.output_item.added", item });
        events.push({ type: "response.function_call_arguments.delta", item_id: item.id, delta: item.arguments || item.input || "" });
      }
    }
    events.push({ type: "response.completed", response: json });
    const raw = events.flatMap(event => translateResponse(format, FORMATS.OPENAI, event, state) || []).map(chunk => formatSSE(chunk, FORMATS.OPENAI)).join("");
    return { ...parseSSEToOpenAIResponse(raw, json.model), id: json.id, model: json.model };
  }
  return translateNonStreamingResponse(json, format, FORMATS.OPENAI);
}

function serializeStoredAnswer(answer, body, format) {
  if (!body.stream) return new Response(JSON.stringify(answer.json), { status: answer.response.status, headers: answer.response.headers });
  const completion = storedCompletion(answer.json, format);
  const choice = completion.choices?.[0];
  if (!choice) throw new Error("Stored panel answer cannot be serialized");
  const metadata = { id: completion.id, object: "chat.completion.chunk", created: completion.created, model: completion.model };
  const delta = { ...choice.message };
  if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((call, index) => ({ index, ...call }));
  const raw = formatSSE({ ...metadata, choices: [{ index: 0, delta, finish_reason: null }] }, FORMATS.OPENAI)
    + formatSSE({ ...metadata, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || "stop" }], usage: completion.usage }, FORMATS.OPENAI) + SSE_DONE;
  // Existing translators emit each protocol's terminal fields; accounting is already recorded by the panel call.
  let wire = raw;
  if (format !== FORMATS.OPENAI) {
    const state = { ...initState(format), model: completion.model, targetFormat: FORMATS.OPENAI };
    const chunks = [
      { ...metadata, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...metadata, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || "stop" }], usage: completion.usage },
      null,
    ];
    wire = chunks.flatMap(chunk => {
      if (format === FORMATS.GEMINI) {
        const event = openaiToAntigravityResponse(chunk, state);
        return event ? [event.response || event] : [];
      }
      return translateResponse(FORMATS.OPENAI, format, chunk, state) || [];
    }).map(event => formatSSE(event, format)).join("");
    if (format === FORMATS.OPENAI_RESPONSES) wire += SSE_DONE;
  }
  const stream = new Response(wire).body;
  const headers = new Headers(answer.response.headers);
  headers.set("content-type", "text/event-stream"); headers.delete("content-length");
  return new Response(stream, { headers });
}

function ownedStream(response, context, finish) {
  const reader = response.body.getReader();
  let ended = false;
  let downstream;
  const end = () => {
    if (ended) return;
    ended = true;
    context.attempt.signal.removeEventListener("abort", abort);
    try { reader.releaseLock(); } catch { /* Pending cancellation owns the reader. */ }
    finish();
  };
  const abort = () => {
    void reader.cancel(context.attempt.signal.reason).catch(() => {});
    try { downstream.error(context.attempt.signal.reason); } catch { /* Consumer cancellation already closed it. */ }
    end();
  };
  return new Response(new ReadableStream({
    start(controller) {
      downstream = controller;
      context.attempt.signal.addEventListener("abort", abort, { once: true });
      if (context.attempt.signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await waitWithSignal(reader.read(), context.attempt.signal, reason => { void reader.cancel(reason).catch(() => {}); });
        if (ended) return;
        if (done) { controller.close(); end(); } else controller.enqueue(value);
      } catch (error) { if (!ended) { controller.error(error); end(); } }
    },
    async cancel(reason) {
      context.attempt.abort("client", reason);
      try { await reader.cancel(reason); } catch { /* Abort already stopped the upstream reader. */ } finally { end(); }
    },
  }, { highWaterMark: 0 }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function handleModelsAliasChat({ authorized, body, request, clientRawRequest = null, apiKey = null, log = defaultLog }) {
  if (!isAuthorizedVirtualTarget(authorized)) return errorResponse(403, "Models Alias requires authorized admission");
  if (authorized.target.kind !== "alias") return errorResponse(400, "Unsupported Models Alias target");
  if (!authorized.members.length) return errorResponse(403, "No configured model is allowed");
  const alias = { id: authorized.target.entityId, ...normalizeModelsAliasConfig(authorized.target.config) };
  const members = new Map(authorized.members.map(member => [member.requested, member]));
  for (const member of members.values()) assertAuthorizedVirtualMember(authorized, member.requested, member);
  const format = (request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null) || detectFormat(body);
  const composed = applyComboPromptInjection(structuredClone(body), alias, { requestedModel: authorized.target.requestedId, sourceFormat: format });
  if (format === FORMATS.OPENAI_RESPONSES && typeof composed.input === "string") {
    composed.input = normalizeResponsesInput(composed.input);
  }
  const required = detectRequiredCapabilities(composed);
  // Capability checks cover history as well as the current turn: alias routing cannot discard typed input.
  const scan = value => {
    if (!value || typeof value !== "object") return;
    for (const cap of detectRequiredCapabilities({ messages: [{ ...value, role: "user", content: Array.isArray(value.content) ? value.content : (typeof value.content === "string" ? value.content : [value]) }] })) required.add(cap);
    for (const key of ["content", "parts", "messages", "input", "contents", "request"]) {
      const child = value[key];
      if (Array.isArray(child)) child.forEach(scan); else if (child && typeof child === "object") scan(child);
    }
  };
  scan(composed);
  const hard = [...required].filter(cap => ["vision", "pdf", "audioInput", "videoInput"].includes(cap));
  const stripNames = { vision: "image", audioInput: "audio", videoInput: "video", pdf: "pdf" };
  const allowed = [...members.keys()].filter(id => {
    const member = members.get(id);
    const strips = getModelStrip(PROVIDER_ID_TO_ALIAS[member.provider] || member.provider, member.model);
    return hard.every(cap => getCapabilitiesForModel(member.provider, member.model)[cap] === true && !strips.includes(stripNames[cap]));
  });
  if (!allowed.length) return errorResponse(400, "No authorized configured member supports the required input modalities");
  const configSignal = getModelsAliasConfigurationSignal(alias);
  const signal = AbortSignal.any([request?.signal, configSignal].filter(Boolean));
  const snapshots = new Map();
  let lastSnapshot = null;
  const active = new Set();
  const options = {
    alias: true, signal,
    getCandidates(phase, judge) {
      const snapshot = getAliasCandidateSnapshot(alias, { allowedMembers: allowed });
      snapshots.set(phase, snapshot); lastSnapshot = snapshot;
      const preferred = judge || alias.judgeModel || alias.primaryModel;
      return phase === "judge" ? [...snapshot.candidates.filter(id => id === preferred), ...snapshot.candidates.filter(id => id !== preferred)] : [...snapshot.candidates];
    },
    resolveAttempt(id, phase) {
      if (signal.aborted) return null;
      const lease = tryClaimAliasMember(snapshots.get(phase), id);
      if (!lease) return null;
      const attempt = createAliasAttempt({ initialResponseTimeoutMs: alias.initialResponseTimeoutSeconds * 1000, clientSignal: request?.signal, configSignal });
      const context = { id, phase, lease, attempt, finished: false, result: null };
      active.add(context);
      return context;
    },
    settleResult(result, context) {
      context.result = result;
      const outcome = () => context.attempt.signal.aborted
        ? { category: "cancelled", cancelReason: context.attempt.signal.reason?.reason, outputStarted: context.attempt.outputStarted }
        : result.failure || (result.success ? { category: "success" } : { category: "provider", status: result.response.status, outputStarted: context.attempt.outputStarted });
      const finish = () => {
        if (context.finished) return;
        context.finished = true;
        settleAliasMemberAttempt(context.lease, outcome());
        context.attempt.dispose(); active.delete(context);
      };
      const classification = classifyAliasMemberFailure(outcome());
      const streaming = result.success && result.response.body && result.response.headers.get("content-type")?.includes("text/event-stream");
      const response = streaming ? ownedStream(result.response, context, finish) : result.response;
      if (!streaming) finish();
      const credentialsUnavailable = !context.attempt.signal.aborted && result.failure?.category === "configuration" && result.failure.credentialsUnavailable === true;
      return { response, success: !!result.success, shouldFallback: (classification.shouldFallback || credentialsUnavailable) && !context.attempt.outputStarted };
    },
    cancelAttempt(context, reason) { context.attempt.abort(reason); },
    exhausted(lastResponse) {
      if (signal.aborted) return errorResponse(499, "Alias request cancelled");
      if (lastResponse) return lastResponse;
      const retryAt = lastSnapshot?.retryAt ? new Date(lastSnapshot.retryAt).toISOString() : null;
      return retryAt ? unavailableResponse(503, "All Models Alias members unavailable", retryAt, null) : errorResponse(503, "All Models Alias members unavailable");
    },
    preparePanelBody: panelBody,
    serializeStoredAnswer: answer => serializeStoredAnswer(answer, composed, format),
  };
  const handleSingleModel = (candidateBody, id, context) => {
    const member = members.get(id);
    assertAuthorizedVirtualMember(authorized, id, member);
    const raw = clientRawRequest ? structuredClone(clientRawRequest) : { endpoint: request?.url ? new URL(request.url).pathname : "", headers: request?.headers ? Object.fromEntries(request.headers) : {} };
    raw.body = structuredClone(candidateBody);
    return executeProviderChat({ body: structuredClone(candidateBody), member, request, clientRawRequest: raw, apiKey, log,
      executionOptions: { alias: true, attempt: context.attempt, forceUpstreamStreaming: true } });
  };
  try {
    if (alias.strategy === "fusion") return await handleFusionChat({ body: composed, models: allowed, handleSingleModel, log, comboName: alias.name, judgeModel: alias.judgeModel || alias.primaryModel, executionOptions: options });
    return await handleComboChat({ body: composed, models: allowed, handleSingleModel, log, comboName: alias.name, comboStrategy: alias.strategy, autoSwitch: false, executionOptions: options });
  } catch (error) {
    for (const context of active) { context.attempt.abort("collection", error); settleAliasMemberAttempt(context.lease, { category: "collection" }); context.attempt.dispose(); }
    return errorResponse(signal.aborted ? 499 : 502, "Models Alias execution failed");
  }
}
