"use client";

import { useCallback, useEffect, useRef } from "react";
import { parseFollowUps, sanitizeTitle } from "./playgroundUtils";

const CHAT_ENDPOINT = "/api/v1/chat/completions";

const TITLE_SYSTEM = "Write a 3 to 6 word title for this conversation. Reply with the title only, no quotes, no trailing punctuation.";
const FOLLOW_UP_SYSTEM = "Suggest exactly three short follow-up questions the user might ask next. Reply with a JSON array of three strings and nothing else.";

async function callHelper({ apiKey, model, messages, maxTokens, temperature, signal }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.value,
      messages,
      stream: false,
      max_tokens: maxTokens,
      temperature,
    }),
    signal,
  });
  if (!response.ok) return "";

  const payload = await response.json().catch(() => null);
  const message = payload?.choices?.[0]?.message;
  return typeof message?.content === "string" ? message.content : "";
}

// Extra billed calls are opt-in through the AI helper setting. Both requests are
// fire-and-forget: they never block a turn, and a failure simply removes the
// title or the suggestion pills.
export default function usePlaygroundHints({ apiKey, model, helper, onTitle, onFollowUps }) {
  const controllersRef = useRef(new Set());

  const cancelAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  useEffect(() => cancelAll, [cancelAll]);

  const call = useCallback(async (messages, maxTokens, temperature) => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      return await callHelper({ apiKey, model, messages, maxTokens, temperature, signal: controller.signal });
    } catch (error) {
      if (error?.name !== "AbortError") console.warn("Playground helper call failed:", error);
      return "";
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [apiKey, model]);

  const requestTitle = useCallback(async (sessionId, question) => {
    if (!helper || !model?.value) return;
    const raw = await call([
      { role: "system", content: TITLE_SYSTEM },
      { role: "user", content: question.slice(0, 1200) },
    ], 24, 0.3);
    const title = sanitizeTitle(raw);
    if (title) onTitle(sessionId, title);
  }, [helper, model, call, onTitle]);

  const requestFollowUps = useCallback(async (sessionId, assistantId, messages) => {
    if (!helper || !model?.value) return;
    const recent = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 1200) }));

    const raw = await call([
      { role: "system", content: FOLLOW_UP_SYSTEM },
      ...recent,
    ], 160, 0.7);

    const questions = parseFollowUps(raw);
    if (questions.length > 0) onFollowUps(sessionId, assistantId, questions);
  }, [helper, model, call, onFollowUps]);

  return { requestTitle, requestFollowUps, cancelAll };
}
