"use client";

// One conversation lane: the model target, its transcript, and the turn engine
// (stream, abort, capture). The composer draft and all rendering stay in the page.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildPayload,
  consumeSseStream,
  createId,
  errorMessageFrom,
  reasoningDeltaFrom,
} from "./playgroundUtils.js";

// Chat goes through the same OpenAI-compatible JRouter endpoint every other client uses,
// so combos, provider fallback, translation and usage tracking all apply unchanged.
export const CHAT_ENDPOINT = "/api/v1/chat/completions";

function now() {
  return Date.now();
}

export default function usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft }) {
  const [model, setModel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState("");

  const abortRef = useRef(null);
  const streamingRef = useRef(false);
  const modelRef = useRef(null);
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchAssistant = useCallback((assistantId, patch) => {
    setMessages((previous) => previous.map((message) => (
      message.id === assistantId ? { ...message, ...patch } : message
    )));
  }, []);

  const runTurn = useCallback(async (question, base, target) => {
    if (!question || !target?.value || streamingRef.current) return;

    const assistantId = createId();
    const history = [...base, { id: createId(), role: "user", content: question }];
    const startedAt = now();

    setMessages([
      ...history,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        reasoning: "",
        status: "streaming",
        modelName: target.name,
        providerId: target.providerId,
        providerName: target.providerName,
        providerColor: target.providerColor,
        isCombo: target.isCombo,
        startedAt,
        meta: null,
      },
    ]);
    setLastError("");
    streamingRef.current = true;
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const params = paramsRef.current;
    const payload = buildPayload({
      model: target,
      history,
      systemPrompt: systemPromptRef.current,
      params,
    });
    const headers = { "Content-Type": "application/json", Accept: params.stream ? "text/event-stream" : "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const request = { url: CHAT_ENDPOINT, headers, body: payload };

    let content = "";
    let reasoning = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";
    let firstTokenMs = null;
    let totalMs = null;
    let httpStatus = 0;
    let httpContentType = "";

    const finalize = (status, extra = {}, response = {}) => {
      patchAssistant(assistantId, {
        content,
        reasoning,
        status,
        firstTokenMs,
        totalMs,
        meta: {
          usage,
          finishReason,
          reportedModel: responseModel,
          requestedModel: target.value,
          ...extra,
        },
        request,
        response,
      });
    };

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      httpStatus = response.status;
      httpContentType = contentType;

      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const message = errorMessageFrom(failure) || `Request failed (${response.status})`;
        setLastError(message);
        throw new Error(message);
      }
      if (!response.body) throw new Error("The response contained no body to read.");

      if (contentType.includes("application/json")) {
        const jsonPayload = await response.json().catch(() => null);
        const message = errorMessageFrom(jsonPayload);
        if (message) throw new Error(message);
        const messagePayload = jsonPayload?.choices?.[0]?.message;
        content = typeof messagePayload?.content === "string" ? messagePayload.content : "";
        reasoning = reasoningDeltaFrom(messagePayload);
        usage = jsonPayload?.usage || null;
        finishReason = jsonPayload?.choices?.[0]?.finish_reason || "";
        responseModel = typeof jsonPayload?.model === "string" ? jsonPayload.model : "";
        totalMs = now() - startedAt;
        finalize(content ? "done" : "empty", {}, {
          status: response.status,
          contentType,
          rawText: JSON.stringify(jsonPayload, null, 2),
          frames: 0,
          truncated: false,
          durationMs: totalMs,
        });
        return;
      }

      const streamed = await consumeSseStream(response.body, {
        onDelta: ({ content: nextContent, reasoning: nextReasoning }) => {
          content = nextContent;
          reasoning = nextReasoning;
          if (firstTokenMs === null) firstTokenMs = now() - startedAt;
          patchAssistant(assistantId, { content, reasoning, firstTokenMs });
        },
      });
      content = streamed.content;
      reasoning = streamed.reasoning;
      usage = streamed.usage;
      finishReason = streamed.finishReason;
      responseModel = streamed.responseModel;
      totalMs = now() - startedAt;
      finalize(content || reasoning ? "done" : "empty", {}, {
        status: response.status,
        contentType,
        rawText: streamed.rawText,
        frames: streamed.frames,
        truncated: streamed.truncated,
        durationMs: totalMs,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        totalMs = now() - startedAt;
        finalize("done", { stopped: true }, { status: 0, contentType: "", rawText: "", frames: 0, truncated: false, durationMs: totalMs });
      } else {
        const message = error?.message || "Request failed.";
        setLastError(message);
        patchAssistant(assistantId, {
          content,
          reasoning,
          status: "error",
          error: message,
          request,
          response: {
            status: httpStatus,
            contentType: httpContentType,
            rawText: message,
            frames: 0,
            truncated: false,
            durationMs: now() - startedAt,
          },
        });
        if (onRestoreDraft) onRestoreDraft(question);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
    }
  }, [apiKey, onRestoreDraft, paramsRef, patchAssistant, systemPromptRef]);

  const selectModel = useCallback((next) => {
    if (!next?.value) return;
    const previous = modelRef.current;
    const changed = previous?.value !== next.value;
    const target = {
      value: next.value,
      name: next.name || next.value,
      providerId: next.providerId || "",
      providerName: next.providerName || "",
      providerColor: next.providerColor || "",
      isCombo: next.isCombo === true,
    };
    modelRef.current = target;
    setModel(target);
    setMessages((current) => (
      changed && current.some((message) => message.role !== "divider")
        ? [...current, { id: createId(), role: "divider", from: previous?.name || "", to: target.name, content: `Model switched to ${target.name}` }]
        : current
    ));
  }, []);

  const send = useCallback((text) => {
    const target = modelRef.current;
    const question = String(text ?? "").trim();
    if (!target || !question || streamingRef.current) return;
    return runTurn(question, messagesRef.current, target);
  }, [runTurn]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback((assistantId) => {
    if (streamingRef.current) return;
    const list = messagesRef.current;
    const index = list.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    const answered = list[index];
    let questionIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (list[cursor].role === "user") {
        questionIndex = cursor;
        break;
      }
    }
    if (questionIndex < 0) return;
    const target = {
      value: answered.meta?.requestedModel || "",
      name: answered.modelName || "",
      providerId: answered.providerId || "",
      providerName: answered.providerName || "",
      providerColor: answered.providerColor || "",
      isCombo: answered.isCombo === true,
    };
    if (!target.value) return;
    return runTurn(list[questionIndex].content, list.slice(0, questionIndex), target);
  }, [runTurn]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setIsStreaming(false);
    setMessages([]);
    setLastError("");
  }, []);

  const lastTurn = [...messages].reverse().find((message) => message.role === "assistant" && message.status !== "streaming") || null;

  return {
    model, selectModel, messages, isStreaming,
    send, stop, retry, reset, lastTurn, lastError, streamingRef,
  };
}
