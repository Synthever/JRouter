"use client";
import Icon from "@/shared/components/Icon";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import PlaygroundStats from "./PlaygroundStats";
import ModelPickerPopover from "./ModelPickerPopover";
import {
  buildMetricParts,
  buildRoutePlan,
  cacheShare,
  formatCount,
  formatLatency,
  shortModelName,
} from "./playgroundUtils.js";
import usePlaygroundLane from "./usePlaygroundLane.js";
import styles from "./playground.module.css";

const MAX_COMPOSER_HEIGHT = 200;
const SUGGESTIONS = [
  "Explain your capabilities",
  "Write a short TypeScript example",
  "Compare REST and GraphQL",
];

function providerInitials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
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
  const [combos, setCombos] = useState([]);
  const [usageStats, setUsageStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generation, setGeneration] = useState({ temperature: "", maxTokens: "", topP: "" });
  const [thinkingOpen, setThinkingOpen] = useState({});
  // The rail is always mounted in this task; Task 6 adds the toggle that uses setRailOpen.
  const [railOpen, setRailOpen] = useState(true);

  const paramsRef = useRef({ useDefaults: true, temperature: "0.7", maxTokens: "4096", topP: "0.95", stream: true, jsonMode: false });
  const systemPromptRef = useRef("");
  const [input, setInput] = useState("");
  const restoreDraft = useCallback((text) => setInput((current) => current || text), []);
  const lane = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
  const { model: selectedModel, messages, isStreaming, send, stop, retry, reset: resetLane } = lane;

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const settingsRef = useRef(null);
  const atBottomRef = useRef(true);
  const { copied, copy } = useCopyToClipboard();

  // The settings popover still owns the fields; the hook reads them through the ref.
  useEffect(() => {
    paramsRef.current = {
      useDefaults: !generation.temperature && !generation.maxTokens && !generation.topP,
      temperature: generation.temperature,
      maxTokens: generation.maxTokens,
      topP: generation.topP,
      stream: true,
      jsonMode: false,
    };
  }, [generation]);

  // One mount loader: picker sources plus the KPI sources. Requests are isolated
  // with allSettled, so a failing card never blocks the chat or the picker.
  useEffect(() => {
    let cancelled = false;

    async function readJson(result) {
      if (result.status !== "fulfilled" || !result.value.ok) return null;
      return result.value.json().catch(() => null);
    }

    async function load() {
      try {
        const results = await Promise.allSettled([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models/alias", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
          fetch("/api/combos", { cache: "no-store" }),
          fetch("/api/usage/stats?period=today", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
        ]);
        const [providersData, aliasesData, keysData, combosData, usageData, settingsData] =
          await Promise.all(results.map(readJson));
        if (cancelled) return;

        setProviders(
          Array.isArray(providersData?.connections)
            ? providersData.connections.filter((connection) => connection?.isActive !== false)
            : []
        );
        setModelAliases(aliasesData?.aliases && typeof aliasesData.aliases === "object" ? aliasesData.aliases : {});
        setApiKey((keysData?.keys || []).find((key) => key.isActive !== false)?.key || "");
        setCombos(Array.isArray(combosData?.combos) ? combosData.combos : []);
        setUsageStats(usageData && typeof usageData === "object" && !Array.isArray(usageData) ? usageData : null);
        setSettings(settingsData && typeof settingsData === "object" && !Array.isArray(settingsData) ? settingsData : null);
        if (!providersData) setLoadError("Providers could not be loaded. Reload the page to try again.");
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

  const canSend = !isStreaming && !!selectedModel && input.trim().length > 0;

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  // Follow the new turn only when a turn actually started; focus lands back in the composer.
  const followTurn = useCallback((turn) => {
    if (!turn) return;
    atBottomRef.current = true;
    Promise.resolve(turn).catch(() => {}).finally(() => inputRef.current?.focus());
  }, []);

  const handleNewChat = () => {
    resetLane();
    setInput("");
    setThinkingOpen({});
    setSettingsOpen(false);
    setPickerOpen(false);
    atBottomRef.current = true;
    inputRef.current?.focus();
  };

  // Reset session clears the transcript and any open overlay, leaving the draft alone.
  const handleResetSession = () => {
    resetLane();
    setThinkingOpen({});
    setPickerOpen(false);
    atBottomRef.current = true;
  };

  const handleSelectModel = (next) => {
    if (!next?.value) return;
    lane.selectModel(next);
    setPickerOpen(false);
    inputRef.current?.focus();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !selectedModel || isStreaming) return;
    const turn = send(text);
    if (!turn) return;
    setInput("");
    followTurn(turn);
  };

  // Replay the same question against the model that answered it.
  const handleRetry = (assistantId) => {
    followTurn(retry(assistantId));
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
    if (canSend) handleSend();
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
    const reasoningMs = message.firstTokenMs ?? message.totalMs;
    const reasoningSeconds = Number.isFinite(reasoningMs) ? Math.max(1, Math.round(reasoningMs / 1000)) : 0;
    const isStreamingMessage = message.status === "streaming";
    const isWaiting = isStreamingMessage && !message.content && !message.reasoning;
    const isAnswering = isStreamingMessage && !!message.content;
    const metaParts = message.meta
      ? buildMetricParts({
        firstTokenMs: message.firstTokenMs,
        totalMs: message.totalMs,
        usage: message.meta.usage,
        finishReason: message.meta.finishReason,
        reportedModel: message.meta.reportedModel,
        requestedModel: message.meta.requestedModel,
        stopped: message.meta.stopped,
      })
      : [];
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

  // KPI props carry only values the APIs returned; nothing here is estimated.
  const targets = [selectedModel].filter(Boolean);
  const primaryTarget = targets[0] || null;
  const cache = cacheShare(usageStats);
  const routePlan = buildRoutePlan(primaryTarget, combos, providers, settings?.comboStrategies || {});
  const saverNote = settings === null
    ? "Token saver status unavailable"
    : `Token saver: RTK ${settings.rtkEnabled ? "on" : "off"} · Headroom ${settings.headroomEnabled ? "on" : "off"}`;

  const statsProps = {
    targetLabel: primaryTarget ? shortModelName(primaryTarget.name) : "No target",
    targetNote: primaryTarget
      ? `${primaryTarget.providerName || "Unknown provider"} · ${primaryTarget.isCombo ? "combo" : "direct"}`
      : "Pick a model to start",
    targetStatus: primaryTarget ? (isStreaming ? "streaming" : "ready") : "idle",
    cachePercent: cache.percent,
    cacheNote: usageStats === null
      ? "Usage data unavailable"
      : cache.hasData
        ? `${formatCount(cache.cached)} cached tokens today`
        : "No prompt tokens today",
    saverNote,
    hasCache: cache.hasData,
    routeLabel: routePlan.label,
    routeNote: routePlan.summary,
    routeStrategy: routePlan.strategy ? `${routePlan.strategy} · from config` : "from config",
  };

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.title}>Playground</h1>
          <p className={styles.sub}>Test models, combos, prompt routing, and streaming latencies in real time.</p>
        </div>
        <div className={styles.introActions}>
          <Button variant="secondary" size="sm" icon="refresh" onClick={handleResetSession}>
            Reset session
          </Button>
        </div>
      </header>

      <div className={styles.statsSlot}>
        <PlaygroundStats {...statsProps} />
      </div>

      <div className={styles.workbench} data-rail={railOpen ? "open" : "closed"}>
        <section className={styles.chat} aria-label="Playground chat">
          <div className={styles.chatHeader}>
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

          <div className={styles.chatBody} ref={scrollRef} onScroll={handleScroll} role="region" aria-label="Conversation" tabIndex={0}>
            <div className={styles.canvas}>
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

          <div className={styles.composerWrap}>
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
                        onClick={stop}
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
                        onClick={handleSend}
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
        </section>

        {railOpen ? (
          <aside className={styles.rail} aria-label="Execution parameters">
            {/* PlaygroundRail mounts here in Task 6; the settings popover lives in the header until then. */}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
