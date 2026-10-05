"use client";
import Icon from "@/shared/components/Icon";

import { useEffect, useRef, useState } from "react";
import { Button, ModelSelectModal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import controls from "@/shared/components/DashboardControls.module.css";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import styles from "./playground.module.css";

// Chat goes through the same OpenAI-compatible JRouter endpoint every other client uses,
// so combos, provider fallback, translation and usage tracking all apply unchanged.
const CHAT_ENDPOINT = "/api/v1/chat/completions";
const MAX_COMPOSER_HEIGHT = 200;

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
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

function formatMeta(meta) {
  const parts = [];
  if (meta.latencyMs) parts.push(formatLatency(meta.latencyMs));
  if (meta.usage?.prompt_tokens) parts.push(`${meta.usage.prompt_tokens} input`);
  if (meta.usage?.completion_tokens) parts.push(`${meta.usage.completion_tokens} output tokens`);
  else if (meta.usage?.total_tokens) parts.push(`${meta.usage.total_tokens} tokens`);
  if (meta.finishReason) parts.push(meta.finishReason);
  if (meta.responseModel && meta.responseModel !== meta.requestedModel) parts.push(`routed ${meta.responseModel}`);
  if (meta.stopped) parts.push("stopped");
  return parts.join(" • ");
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

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const settingsRef = useRef(null);

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

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

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

  const handleNewChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    setInput("");
    setSettingsOpen(false);
    inputRef.current?.focus();
  };

  const handleSelectModel = (model) => {
    if (!model?.value) return;
    const label = model.name || model.value;
    const changed = selectedModel?.value !== model.value;
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
    setMessages((previous) => (
      changed && previous.some((message) => message.role !== "divider")
        ? [...previous, { id: createId(), role: "divider", content: `Model changed to ${label}` }]
        : previous
    ));
    inputRef.current?.focus();
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !selectedModel || isStreaming) return;

    const model = selectedModel;
    const assistantId = createId();
    const history = [...messages, { id: createId(), role: "user", content: text }];
    const startedAt = Date.now();

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
        meta: null,
      },
    ]);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch) => {
      setMessages((previous) => previous.map((message) => (
        message.id === assistantId ? { ...message, ...patch } : message
      )));
    };

    let content = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";

    const finalize = (status, extra = {}) => {
      patchAssistant({
        content,
        status,
        meta: {
          latencyMs: Date.now() - startedAt,
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
        content = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : "";
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
          const delta = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
          if (delta) {
            content += delta;
            patchAssistant({ content });
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
          if (typeof chunk?.model === "string" && chunk.model) responseModel = chunk.model;
        }
      }

      finalize(content ? "done" : "empty");
    } catch (error) {
      if (error?.name === "AbortError") {
        finalize("done", { stopped: true });
      } else {
        patchAssistant({ content, status: "error", error: error?.message || "Request failed." });
        // Hand the prompt back so the user can edit and retry.
        setInput((current) => current || text);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
      inputRef.current?.focus();
    }
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

  const renderModelIcon = ({ providerId, providerName, providerColor, isCombo, fallbackIcon }, size) => {
    if (!providerId || isCombo) {
      return (
        <span className={styles.modelFallback} style={{ width: size, height: size }}>
          <Icon className="text-[13px]">{isCombo ? "layers" : fallbackIcon || "science"}</Icon>
        </span>
      );
    }
    return (
      <ProviderIcon
        providerId={providerId}
        alt={providerName || "model"}
        size={size}
        className="rounded-[var(--r1)] object-contain"
        fallbackText={providerInitials(providerName)}
        fallbackColor={providerColor}
      />
    );
  };

  const renderMessage = (message) => {
    if (message.role === "divider") {
      return <p key={message.id} className={styles.divider}>{message.content}</p>;
    }

    if (message.role === "user") {
      return (
        <div key={message.id} className={`${styles.row} ${styles.rowUser}`}>
          <div className={styles.bubbleUser}>{message.content}</div>
        </div>
      );
    }

    const meta = message.meta;

    return (
      <div key={message.id} className={styles.row}>
        <div className={styles.assistantHead}>
          {renderModelIcon({ ...message, fallbackIcon: "smart_toy" }, 14)}
          <span className={styles.assistantName}>{message.modelName || "Assistant"}</span>
        </div>

        {message.status === "error" ? (
          <div className={styles.errorBox} role="alert">
            <p className={styles.errorTitle}>
              <Icon className="text-[14px]">error</Icon> Request failed
            </p>
            <p className={styles.errorBody}>{message.error}</p>
          </div>
        ) : message.content ? (
          <div className={styles.assistantBody}>
            <PlaygroundMarkdown content={message.content} />
          </div>
        ) : message.status === "streaming" ? (
          <p className={styles.statusNote}>Generating…</p>
        ) : (
          <p className={styles.statusNote}>
            {meta?.stopped ? "Stopped before any output." : "The model returned no text."}
          </p>
        )}

        {meta && message.status !== "error" ? <p className={styles.meta}>{formatMeta(meta)}</p> : null}
      </div>
    );
  };

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.header}>
        <div className="min-w-0">
          <h1 className="ui-eyebrow flex items-center gap-2">
            <Icon className="text-[16px]">science</Icon> Model Playground
          </h1>
          <p className={styles.description}>Test and chat with models through JRouter</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="contrast" icon="add" onClick={handleNewChat} disabled={messages.length === 0}>
            New Chat
          </Button>
        </div>
      </header>

      <section className={`ui-card ${styles.panel}`} aria-label="Model playground">
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.modelTrigger}
            onClick={() => setPickerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            {renderModelIcon({ ...selectedModel, fallbackIcon: "science" }, 18)}
            <span className={styles.modelTriggerText}>
              <span className={styles.modelName}>
                {selectedModel ? selectedModel.name : loading ? "Loading models…" : "Select a model"}
              </span>
              <span className={styles.modelProvider}>
                {selectedModel
                  ? selectedModel.providerName || selectedModel.value
                  : !loading && providers.length === 0
                    ? "No connected providers"
                    : "Choose from connected providers"}
              </span>
            </span>
            <Icon name="expand_more" className="text-[16px] text-[var(--text-3)]" />
          </button>

          <div className={styles.toolbarActions}>
            <Button variant="ghost" size="sm" icon="add" onClick={handleNewChat} disabled={messages.length === 0}>
              New Chat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="settings"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              Settings
            </Button>
          </div>
        </div>

        <div className={styles.chat} ref={scrollRef}>
          {loadError ? (
            <div className={styles.errorBox} role="alert">
              <p className={styles.errorTitle}>
                <Icon className="text-[14px]">error</Icon> Models unavailable
              </p>
              <p className={styles.errorBody}>{loadError}</p>
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div className={styles.empty}>
              <Icon className="text-[22px] text-[var(--text-3)]">science</Icon>
              <p className={styles.emptyTitle}>Start a conversation</p>
              <p className={styles.emptyHint}>
                {selectedModel
                  ? `Send a message to test ${selectedModel.name} through JRouter.`
                  : !loading && providers.length === 0
                    ? "No providers connected yet. Connect one from the Providers page to test models here."
                    : "Pick a model, then send your first message through JRouter."}
              </p>
            </div>
          ) : messages.map(renderMessage)}
        </div>

        <div className={styles.composerWrap}>
          {settingsOpen ? (
            <div className={styles.settingsPopover} ref={settingsRef} role="dialog" aria-label="Generation settings">
              <div className={styles.settingsHeader}>
                <span>Generation</span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                  className="cursor-pointer text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
                >
                  <Icon className="text-[14px]">close</Icon>
                </button>
              </div>

              <label className={styles.settingsField}>
                <span className={styles.settingsLabel}>Temperature</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  placeholder="provider default"
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
                  placeholder="provider default"
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
                  placeholder="provider default"
                  value={generation.topP}
                  onChange={handleGenerationChange("topP")}
                  className={styles.settingsInput}
                />
              </label>

              <p className={styles.settingsHint}>
                Applied to the next request. Empty fields use the provider default.
              </p>
            </div>
          ) : null}

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
            {isStreaming ? (
              <Button variant="secondary" size="sm" icon="stop" onClick={handleStop}>
                Stop
              </Button>
            ) : (
              <Button variant="contrast" size="sm" icon="send" onClick={sendMessage} disabled={!canSend}>
                Send
              </Button>
            )}
          </div>
        </div>
      </section>

      <ModelSelectModal
        className={controls.modelPicker}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectModel}
        selectedModel={selectedModel?.value}
        activeProviders={providers}
        modelAliases={modelAliases}
        title="Select Model"
        notice="Pick one model to chat with. Search by name, ID, or provider."
      />
    </div>
  );
}
