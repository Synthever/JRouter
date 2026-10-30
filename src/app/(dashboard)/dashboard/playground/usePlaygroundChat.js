"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildTurnBody } from "./playgroundUtils";

// Chat goes through the same OpenAI-compatible endpoint every other client uses,
// so combos, provider fallback, translation and usage tracking all apply unchanged.
const CHAT_ENDPOINT = "/api/v1/chat/completions";

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function errorMessageFrom(payload) {
  const raw = payload?.error?.message ?? payload?.error ?? payload?.message ?? payload?.msg;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return "";
}

function reasoningDeltaFrom(delta) {
  const raw = delta?.reasoning_content ?? delta?.reasoning;
  return typeof raw === "string" ? raw : "";
}

export default function usePlaygroundChat({ apiKey, settings, onAppend, onPatch, onFinish }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async ({ sessionId, question, history, model }) => {
    const text = (question || "").trim();
    if (!text || !model?.value || streamingRef.current) return;

    const assistantId = createId();
    const startedAt = Date.now();
    const userMessage = { id: createId(), role: "user", content: text };

    onAppend(sessionId, [
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        modelName: model.name,
        providerId: model.providerId,
        providerName: model.providerName,
        isCombo: model.isCombo,
        startedAt,
        reasoning: "",
        thinkingMs: null,
        elapsedMs: null,
        meta: null,
      },
    ]);

    streamingRef.current = true;
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (values) => onPatch(sessionId, assistantId, values);

    let content = "";
    let reasoning = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";
    let firstTokenMs = null;
    let thinkingMs = null;
    let thinkingStartedAt = null;
    let thinkingEndedAt = null;

    const finalize = (status, extra = {}) => {
      const elapsedMs = Date.now() - startedAt;
      patch({
        content,
        reasoning,
        status,
        elapsedMs,
        thinkingMs: thinkingMs ?? (thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null),
        meta: {
          latencyMs: elapsedMs,
          firstTokenMs,
          usage,
          finishReason,
          responseModel,
          requestedModel: model.value,
          ...extra,
        },
      });
      onFinish?.({
        sessionId,
        assistantId,
        status,
        content,
        stopped: extra.stopped === true,
        messages: [...history, userMessage, { role: "assistant", content }],
      });
    };

    try {
      const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const body = buildTurnBody({ model, messages: [...history, userMessage] }, settings);
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(errorMessageFrom(payload) || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error("The response contained no body to read.");

      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const payload = await response.json().catch(() => null);
        const failure = errorMessageFrom(payload);
        if (failure) throw new Error(failure);
        const message = payload?.choices?.[0]?.message;
        content = typeof message?.content === "string" ? message.content : "";
        reasoning = reasoningDeltaFrom(message);
        usage = payload?.usage || null;
        finishReason = payload?.choices?.[0]?.finish_reason || "";
        responseModel = typeof payload?.model === "string" ? payload.model : "";
        finalize(content || reasoning ? "done" : "empty");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          if (chunk?.error) throw new Error(errorMessageFrom(chunk) || "Request failed.");

          const choice = chunk?.choices?.[0];
          const deltaText = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
          const deltaReasoning = reasoningDeltaFrom(choice?.delta);
          if (deltaReasoning) {
            if (!thinkingStartedAt) thinkingStartedAt = Date.now();
            reasoning += deltaReasoning;
          }
          if (deltaText) {
            if (firstTokenMs == null) firstTokenMs = Date.now() - startedAt;
            if (thinkingStartedAt && !thinkingEndedAt) thinkingEndedAt = Date.now();
            content += deltaText;
          }
          if (deltaText || deltaReasoning) patch({ content, reasoning });
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
          if (typeof chunk?.model === "string" && chunk.model) responseModel = chunk.model;
        }
      }

      thinkingMs = thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null;
      finalize(content || reasoning ? "done" : "empty");
    } catch (error) {
      thinkingMs = thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : null;
      if (error?.name === "AbortError") {
        finalize("done", { stopped: true });
      } else {
        patch({
          content,
          reasoning,
          status: "error",
          thinkingMs,
          error: error?.message || "Request failed.",
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
    }
  }, [apiKey, settings, onAppend, onPatch, onFinish]);

  return { isStreaming, run, stop };
}
