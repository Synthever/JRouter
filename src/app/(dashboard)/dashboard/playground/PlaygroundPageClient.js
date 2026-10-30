"use client";
import Icon from "@/shared/components/Icon";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import ModelPickerPopover from "./ModelPickerPopover";
import styles from "./playground.module.css";

// Chat goes through the same OpenAI-compatible JRouter endpoint every other client uses,
// so combos, provider fallback, translation and usage tracking all apply unchanged.
const CHAT_ENDPOINT = "/api/v1/chat/completions";
const MAX_COMPOSER_HEIGHT = 200;
const SUGGESTIONS = [
  "Explain your capabilities",
  "Write a short TypeScript example",
  "Compare REST and GraphQL",
];

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Elapsed-time measurements happen in event handlers and stream callbacks, never
// during render — reading the clock through one helper keeps that explicit.
function now() {
  return Date.now();
}

function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "";
}

function providerInitials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}

// Upscale error payloads from the router, upstream providers and the network into one line.
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

// Only non-empty, numeric values are sent, so untouched fields keep the provider default.
function buildGenerationParams(settings) {
  const params = {};
  const temperature = Number.parseFloat(settings.temperature);
  if (Number.isFinite(temperature)) params.temperature = temperature;
  const maxTokens = Number.parseInt(settings.maxTokens, 10);
  if (Number.isFinite(maxTokens) && maxTokens > 0) params.max_tokens = maxTokens;
  const topP = Number.parseFloat(settings.topP);
  if (Number.isFinite(topP)) params.top_p = topP;
  return params;
}

function toRequestMessages(messages) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
}

// Reasoning fields some providers stream alongside (or instead of) the answer text.
function reasoningDeltaFrom(delta) {
  const raw = delta?.reasoning_content ?? delta?.reasoning;
  return typeof raw === "string" ? raw : "";
}

// Latency · prompt tokens · completion tokens · finish reason · routed model.
function buildMetaParts(meta) {
  const parts = [];
  const latency = formatLatency(meta.latencyMs);
  if (latency) parts.push(latency);
  const prompt = formatCount(meta.usage?.prompt_tokens);
  if (prompt) parts.push(`${prompt} in`);
  const completion = formatCount(meta.usage?.completion_tokens);
  if (completion) {
    parts.push(`${completion} out`);
  } else {
    const total = formatCount(meta.usage?.total_tokens);
    if (total) parts.push(`${total} tokens`);
  }
  if (meta.finishReason) parts.push(meta.finishReason);
  if (meta.responseModel && meta.responseModel !== meta.requestedModel) parts.push(meta.responseModel);
  if (meta.stopped) parts.push("stopped");
  return parts;
}

function ModelIcon({ model, providerId, providerName, providerColor, isCombo, size = 16 }) {
  const connectionId = providerId && !isCombo ? providerId : "";
  if (!connectionId) {
    return (
      <span className={styles.modelFallback} style={{ width: size, height: size }}>
        <Icon style={{ fontSize: Math.max(10, Math.round(size * 0.7)) }}>{isCombo ? "layers" : "science"}</Icon>
      </span>
    );
  }
  return (
    <ProviderIcon
      providerId={connectionId}
      alt={providerName || "model"}
      size={size}
      fallbackText={providerInitials(providerName)}
      fallbackColor={providerColor}
    />
  );
}

// Nine-cell grid whose cells light up in sequence while the model works.
function ActivityGlyph() {
  return (
    <span className={styles.activityGrid} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
    </span>
  );
}

// Waiting-for-first-token state. The running clock lives here so the 120ms ticks
// re-render this row instead of the whole conversation.
function ActivityState({ label, startedAt }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 120);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <p className={styles.activity} role="status">
      <ActivityGlyph />
      <span className={styles.activityText}>{label}</span>
      <span className={styles.activityDots} aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className={styles.activityElapsed}>{formatLatency(elapsedMs)}</span>
    </p>
  );
}

export default function PlaygroundPageClient() {
  const [providers, setProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedModel, setSelectedModel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generation, setGeneration] = useState({ temperature: "", maxTokens: "", topP: "" });
  const [thinkingOpen, setThinkingOpen] = useState({});

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const settingsRef = useRef(null);
  const atBottomRef = useRef(true);
  const streamingRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();

  // Model picker sources: same connections/aliases data the Combo picker uses.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [providersRes, aliasesRes, keysRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models/alias", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
        ]);
        const providersData = providersRes.ok ? await providersRes.json().catch(() => ({})) : {};
        const aliasesData = aliasesRes.ok ? await aliasesRes.json().catch(() => ({})) : {};
        const keysData = keysRes.ok ? await keysRes.json().catch(() => ({})) : {};
        if (cancelled) return;

        setProviders(
          Array.isArray(providersData.connections)
            ? providersData.connections.filter((connection) => connection?.isActive !== false)
            : []
        );
        setModelAliases(aliasesData.aliases && typeof aliasesData.aliases === "object" ? aliasesData.aliases : {});
        setApiKey((keysData.keys || []).find((key) => key.isActive !== false)?.key || "");
        if (!providersRes.ok) setLoadError("Providers could not be loaded. Reload the page to try again.");
      } catch (error) {
        if (!cancelled) setLoadError(error?.message || "Providers and models could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the composer one line tall until the text wraps.
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [input]);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  // Follow new output only while the reader is already at the bottom, so scrolling
  // back through a long answer is not yanked away by incoming tokens.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handlePointerDown = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) setSettingsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const canSend = !isStreaming && !!selectedModel && input.trim().length > 0;

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setIsStreaming(false);
    setMessages([]);
    setInput("");
    setThinkingOpen({});
    setSettingsOpen(false);
    setPickerOpen(false);
    atBottomRef.current = true;
    inputRef.current?.focus();
  };

  const handleSelectModel = (model) => {
    if (!model?.value) return;
    const label = model.name || model.value;
    const previous = selectedModel;
    const changed = previous?.value !== model.value;
    setSelectedModel({
      value: model.value,
      name: label,
      providerId: model.providerId || "",
      providerName: model.providerName || "",
      providerColor: model.providerColor || "",
      isCombo: model.isCombo === true,
    });
    setPickerOpen(false);
    // Keep the transcript so the same context can be replayed against another model.
    setMessages((current) => (
      changed && current.some((message) => message.role !== "divider")
        ? [...current, {
          id: createId(),
          role: "divider",
          from: previous?.name || previous?.value || "",
          to: label,
          content: `Model switched to ${label}`,
        }]
        : current
    ));
    inputRef.current?.focus();
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const patchAssistant = useCallback((assistantId, patch) => {
    setMessages((previous) => previous.map((message) => (
      message.id === assistantId ? { ...message, ...patch } : message
    )));
  }, []);

  // `base` is the transcript the new turn runs against. Retry passes the history
  // truncated at the retried question instead of the whole conversation.
  const runTurn = async (question, base, model, startedAt) => {
    if (!question || !model || streamingRef.current) return;

    const assistantId = createId();
    const history = [...base, { id: createId(), role: "user", content: question }];

    setMessages([
      ...history,
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
        meta: null,
      },
    ]);
    setInput("");
    streamingRef.current = true;
    setIsStreaming(true);
    atBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (values) => patchAssistant(assistantId, values);

    let content = "";
    let reasoning = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";
    let elapsedMs = null;

    const finalize = (status, extra = {}) => {
      patch({
        content,
        reasoning,
        status,
        elapsedMs,
        meta: {
          latencyMs: elapsedMs ?? Date.now() - startedAt,
          usage,
          finishReason,
          responseModel,
          requestedModel: model.value,
          ...extra,
        },
      });
    };

    try {
      const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model.value,
          messages: toRequestMessages(history),
          stream: true,
          ...buildGenerationParams(generation),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(errorMessageFrom(payload) || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error("The response contained no body to read.");

      // A buffered JSON body means the reply was not streamed after all.
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
        finalize(content ? "done" : "empty");
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
          if (deltaText || deltaReasoning) {
            content += deltaText;
            reasoning += deltaReasoning;
            if (!elapsedMs) elapsedMs = now() - startedAt;
            patch({ content, reasoning });
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
          if (typeof chunk?.model === "string" && chunk.model) responseModel = chunk.model;
        }
      }

      finalize(content || reasoning ? "done" : "empty");
    } catch (error) {
      if (error?.name === "AbortError") {
        finalize("done", { stopped: true });
      } else {
        patch({ content, reasoning, status: "error", error: error?.message || "Request failed." });
        // Hand the prompt back so the user can edit and retry.
        setInput((current) => current || question);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !selectedModel || streamingRef.current) return;
    return runTurn(text, messages, selectedModel, now());
  };

  // Replay the same question against the model that answered it.
  const handleRetry = (assistantId) => {
    if (streamingRef.current) return;
    const index = messages.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    const answered = messages[index];

    let questionIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === "user") {
        questionIndex = cursor;
        break;
      }
    }
    if (questionIndex < 0) return;

    const question = messages[questionIndex].content;
    const base = messages.slice(0, questionIndex);
    const model = {
      value: answered.meta?.requestedModel || "",
      name: answered.modelName || "",
      providerId: answered.providerId || "",
      providerName: answered.providerName || "",
      providerColor: selectedModel?.providerColor || "",
      isCombo: answered.isCombo === true,
    };
    if (!model.value) return;
    runTurn(question, base, model, now());
  };

  const copyMessage = (message) => {
    const text = message.content || message.reasoning || "";
    if (!text) return;
    copy(text, message.id);
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent?.isComposing) return;
    event.preventDefault();
    if (canSend) sendMessage();
  };

  const handleGenerationChange = (field) => (event) => {
    setGeneration((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleSuggestion = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const toggleThinking = (messageId) => {
    setThinkingOpen((previous) => ({ ...previous, [messageId]: !previous[messageId] }));
  };

  const modelCatalog = useModelCatalog({ isOpen: pickerOpen, activeProviders: providers, modelAliases });
  const hasCatalog = modelCatalog.filteredCombos.length
    + Object.values(modelCatalog.visibleGroups).reduce((total, group) => total + group.models.length, 0) > 0;

  const renderMessage = (message) => {
    if (message.role === "divider") {
      return <p key={message.id} className={styles.divider}>{message.content}</p>;
    }

    if (message.role === "user") {
      return (
        <div key={message.id} className={`${styles.row} ${styles.rowUser}`}>
          <div className={styles.userBubble}>{message.content}</div>
        </div>
      );
    }

    const isThinkingVisible = thinkingOpen[message.id] === true;
    const reasoningSeconds = message.meta?.latencyMs ? Math.max(1, Math.round(message.meta.latencyMs / 1000)) : 0;
    const isStreamingMessage = message.status === "streaming";
    const isWaiting = isStreamingMessage && !message.content && !message.reasoning;
    const isAnswering = isStreamingMessage && !!message.content;
    const metaParts = message.meta ? buildMetaParts(message.meta) : [];
    const canRetry = message.status === "done" && messages[messages.length - 1]?.id === message.id;
    const actionsVisible = !isStreamingMessage;

    return (
      <div key={message.id} className={styles.row}>
        <div className={styles.assistantHead}>
          <ModelIcon
            providerId={message.providerId}
            providerName={message.providerName}
            isCombo={message.isCombo}
            size={16}
          />
          <span className={styles.assistantName}>{message.modelName || "Assistant"}</span>
          {message.providerName ? (
            <span className={styles.assistantProvider}>{message.providerName}</span>
          ) : null}
        </div>

        {message.status === "error" ? (
          <div className={styles.error} role="alert">
            <p className={styles.errorHead}>
              <Icon>error</Icon> Request failed
            </p>
            <p className={styles.errorBody}>{message.error}</p>
            <div className={styles.errorActions}>
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => handleRetry(message.id)}>
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <>
            {message.reasoning ? (
              <div className={styles.thinking}>
                <button
                  type="button"
                  className={styles.thinkingToggle}
                  onClick={() => toggleThinking(message.id)}
                  aria-expanded={isThinkingVisible}
                >
                  <Icon>stars</Icon>
                  {isStreamingMessage && !message.content
                    ? "Thinking…"
                    : reasoningSeconds > 0
                      ? `Thought for ${reasoningSeconds}s`
                      : "Thoughts"}
                  <Icon className={styles.chevronSmall}>{isThinkingVisible ? "expand_less" : "expand_more"}</Icon>
                </button>
                {isThinkingVisible ? <div className={styles.thinkingBody}>{message.reasoning}</div> : null}
              </div>
            ) : null}

            {isWaiting ? (
              <ActivityState label="Generating" startedAt={message.startedAt} />
            ) : null}

            {message.content ? (
              <div className={styles.assistantBody}>
                <PlaygroundMarkdown content={message.content} />
                {isAnswering ? <span className={styles.caret} aria-hidden="true">▍</span> : null}
              </div>
            ) : null}

            {!message.content && !message.reasoning && !isStreamingMessage ? (
              <p className={styles.note}>
                {message.meta?.stopped ? "Stopped before any output." : "The model returned no text."}
              </p>
            ) : null}

            {!message.content && message.reasoning && !isStreamingMessage ? (
              <p className={styles.note}>This model returned reasoning only.</p>
            ) : null}
          </>
        )}

        {actionsVisible && !isWaiting ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              data-state={copied === message.id ? "copied" : undefined}
              onClick={() => copyMessage(message)}
              disabled={!message.content && !message.reasoning}
            >
              <Icon>{copied === message.id ? "check" : "content_copy"}</Icon>
              {copied === message.id ? "Copied" : "Copy"}
            </button>
            {canRetry ? (
              <button type="button" className={styles.actionButton} onClick={() => handleRetry(message.id)}>
                <Icon>refresh</Icon>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {metaParts.length > 0 ? (
          <p className={styles.meta}>
            {metaParts.map((part, index) => (
              <span key={part}>
                {index > 0 ? <span className={styles.metaSep}>·</span> : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    );
  };

  const emptyHint = selectedModel
    ? `Test ${selectedModel.name} through JRouter.`
    : !loading && providers.length === 0
      ? "No providers connected yet. Connect one from the Providers page to test models here."
      : "Pick a model, then send your first message through JRouter.";

  return (
    <div className={styles.page}>
      <div className={styles.workspace}>
      <div className={`${styles.column} ${styles.toolbar}`}>
        <div className={styles.modelTriggerWrap}>
          <button
            type="button"
            data-model-trigger
            className={styles.modelTrigger}
            onClick={() => setPickerOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <ModelIcon
              providerId={selectedModel?.providerId}
              providerName={selectedModel?.providerName}
              providerColor={selectedModel?.providerColor}
              isCombo={selectedModel?.isCombo}
              size={18}
            />
            <span className={styles.modelTriggerText}>
              <span className={styles.modelNameRow}>
                <span className={styles.modelName}>
                  {selectedModel ? selectedModel.name : loading ? "Loading models…" : "Select a model"}
                </span>
                {selectedModel?.isCombo ? <span className={styles.modelBadge}>combo</span> : null}
              </span>
              <span className={styles.modelProvider}>
                {selectedModel
                  ? selectedModel.providerName || selectedModel.value
                  : !loading && providers.length === 0
                    ? "No connected providers"
                    : "Choose from connected providers"}
              </span>
            </span>
            <Icon className={styles.chevron}>{pickerOpen ? "expand_less" : "expand_more"}</Icon>
          </button>

          <ModelPickerPopover
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={handleSelectModel}
            selectedModel={selectedModel?.value}
            activeProviders={providers}
            modelAliases={modelAliases}
          />
        </div>

        <div className={styles.toolbarActions}>
          <Tooltip text="New chat">
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleNewChat}
              disabled={messages.length === 0}
              aria-label="New chat"
            >
              <Icon>add</Icon>
            </button>
          </Tooltip>

          <span ref={settingsRef} className={styles.settingsAnchor}>
            <Tooltip text="Generation settings">
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-label="Generation settings"
              >
                <Icon>settings</Icon>
              </button>
            </Tooltip>

            {settingsOpen ? (
              <div className={styles.settingsPopover} role="dialog" aria-label="Generation settings">
                <div className={styles.settingsHead}>
                  <span>Generation</span>
                  <button
                    type="button"
                    className={styles.settingsClose}
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    <Icon>close</Icon>
                  </button>
                </div>

                <label className={styles.settingsField}>
                  <span className={styles.settingsLabel}>Temperature</span>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    placeholder="default"
                    value={generation.temperature}
                    onChange={handleGenerationChange("temperature")}
                    className={styles.settingsInput}
                  />
                </label>

                <label className={styles.settingsField}>
                  <span className={styles.settingsLabel}>Max tokens</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="default"
                    value={generation.maxTokens}
                    onChange={handleGenerationChange("maxTokens")}
                    className={styles.settingsInput}
                  />
                </label>

                <label className={styles.settingsField}>
                  <span className={styles.settingsLabel}>Top P</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    placeholder="default"
                    value={generation.topP}
                    onChange={handleGenerationChange("topP")}
                    className={styles.settingsInput}
                  />
                </label>

                <p className={styles.settingsHint}>
                  Applied to the next request. Empty fields use the provider default.
                </p>

                {generation.temperature || generation.maxTokens || generation.topP ? (
                  <button
                    type="button"
                    className={styles.settingsReset}
                    onClick={() => setGeneration({ temperature: "", maxTokens: "", topP: "" })}
                  >
                    Reset to provider defaults
                  </button>
                ) : null}
              </div>
            ) : null}
          </span>
        </div>
      </div>

      <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll} role="region" aria-label="Conversation" tabIndex={0}>
        <div className={`${styles.column} ${styles.canvas}`}>
          {loadError ? (
            <p className={styles.loadError} role="alert">
              <Icon>error</Icon>
              {loadError}
            </p>
          ) : null}

          {messages.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <Icon>science</Icon>
              </span>
              <p className={styles.emptyTitle}>Start a conversation</p>
              <p className={styles.emptyHint}>{emptyHint}</p>
              {selectedModel && hasCatalog ? (
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => handleSuggestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : messages.map(renderMessage)}
        </div>
      </div>

      <div className={`${styles.column} ${styles.composerWrap}`}>
        <div className={styles.composer}>
          <textarea
            ref={inputRef}
            rows={1}
            className={styles.textarea}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedModel ? `Message ${selectedModel.name}...` : "Select a model to start…"}
            aria-label="Message"
          />

          <div className={styles.composerBar}>
            {selectedModel ? (
              <span className={styles.composerContext}>
                <ModelIcon
                  providerId={selectedModel.providerId}
                  providerName={selectedModel.providerName}
                  providerColor={selectedModel.providerColor}
                  isCombo={selectedModel.isCombo}
                  size={13}
                />
                <span className={styles.composerContextName}>
                  {selectedModel.providerName || selectedModel.name}
                </span>
              </span>
            ) : (
              <button
                type="button"
                className={styles.suggestion}
                onClick={() => setPickerOpen(true)}
              >
                Select a model
              </button>
            )}

            <span className={styles.composerButtons}>
              {isStreaming ? (
                <Tooltip text="Stop generating">
                  <button
                    type="button"
                    className={styles.sendButton}
                    data-mode="stop"
                    onClick={handleStop}
                    aria-label="Stop generating"
                  >
                    <Icon>stop</Icon>
                  </button>
                </Tooltip>
              ) : (
                <Tooltip text="Send">
                  <button
                    type="button"
                    className={styles.sendButton}
                    onClick={sendMessage}
                    disabled={!canSend}
                    aria-label="Send message"
                  >
                    <Icon>arrow_upward</Icon>
                  </button>
                </Tooltip>
              )}
            </span>
          </div>
          <p className={styles.hint}>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
