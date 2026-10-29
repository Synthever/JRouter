"use client";
import Icon from "@/shared/components/Icon";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tooltip } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import ModelIcon from "./PlaygroundModelIcon";
import PlaygroundStats from "./PlaygroundStats";
import PlaygroundRail from "./PlaygroundRail";
import PlaygroundTranscript from "./PlaygroundTranscript";
import ModelPickerPopover from "./ModelPickerPopover";
import {
  buildCurl,
  buildRoutePlan,
  cacheShare,
  estimateTokens,
  formatContext,
  formatCount,
  shortModelName,
} from "./playgroundUtils.js";
import usePlaygroundLane from "./usePlaygroundLane.js";
import styles from "./playground.module.css";

const MAX_COMPOSER_HEIGHT = 200;
const DEFAULT_PARAMS = { useDefaults: true, temperature: 0.7, maxTokens: 4096, topP: 0.95, stream: true, jsonMode: false };
const SUGGESTIONS = [
  "Explain your capabilities",
  "Write a short TypeScript example",
  "Compare REST and GraphQL",
];

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
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [thinkingOpen, setThinkingOpen] = useState({});
  const [railOpen, setRailOpen] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);

  const paramsRef = useRef({ ...DEFAULT_PARAMS });
  const systemPromptRef = useRef("");
  const [input, setInput] = useState("");
  const restoreDraft = useCallback((text) => setInput((current) => current || text), []);
  const lane = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
  const { model: selectedModel, messages, isStreaming, lastTurn, send, stop, retry, reset: resetLane } = lane;
  const router = useRouter();

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const { copied, copy } = useCopyToClipboard();

  // Header telemetry: the selected target's real context window (from the model
  // catalog) and the exact request the last turn sent, replayed as a cURL.
  const caps = useModelCaps();
  const contextWindow = selectedModel ? caps.getCaps(selectedModel.value)?.contextWindow || 0 : 0;
  const headerCurl = lastTurn?.request ? buildCurl(lastTurn.request) : "";

  // The rail owns the fields; the turn engine reads them through the ref at send time.
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Same contract for the system instructions card above the transcript.
  useEffect(() => {
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);

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

  // Clear thread drops the conversation but keeps the draft and the target.
  const handleClearThread = () => {
    resetLane();
    setThinkingOpen({});
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

            <div className={styles.pills}>
              {selectedModel?.isCombo ? <span className={styles.pill}>combo</span> : null}
              {contextWindow ? <span className={styles.pill}>{formatContext(contextWindow)} ctx</span> : null}
              <span className={styles.pill} data-tone={isStreaming ? "live" : "idle"}>
                {params.stream ? "SSE stream" : "JSON"}
              </span>
            </div>

            <div className={styles.toolbarActions}>
              <Tooltip text="Copy as cURL">
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => copy(headerCurl, "curl")}
                  disabled={!headerCurl}
                  aria-label="Copy request as cURL"
                >
                  <Icon>terminal</Icon>
                </button>
              </Tooltip>

              <Tooltip text="Clear thread">
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={handleClearThread}
                  disabled={messages.length === 0}
                  aria-label="Clear thread"
                >
                  <Icon>delete</Icon>
                </button>
              </Tooltip>

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

              <Tooltip text={railOpen ? "Hide parameters" : "Show parameters"}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setRailOpen((open) => !open)}
                  aria-expanded={railOpen}
                  aria-label="Toggle execution rail"
                >
                  <Icon>settings</Icon>
                </button>
              </Tooltip>
            </div>
          </div>

          <div className={styles.chatBody} ref={scrollRef} onScroll={handleScroll} role="region" aria-label="Conversation" tabIndex={0}>
            <details
              className={styles.systemCard}
              open={systemOpen}
              onToggle={(event) => setSystemOpen(event.currentTarget.open)}
            >
              <summary className={styles.systemHead}>
                <span className={styles.systemTitle}><Icon>article</Icon> System instructions</span>
                <span className={styles.systemMeta}>
                  {systemPrompt.trim() ? `~${estimateTokens(systemPrompt)} tokens` : "empty"}
                  <Icon className={styles.chevronSmall}>{systemOpen ? "expand_less" : "expand_more"}</Icon>
                </span>
              </summary>
              <textarea
                className={styles.systemInput}
                rows={3}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="Sent as the first message of every request."
                aria-label="System instructions"
              />
            </details>

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
              ) : (
                <PlaygroundTranscript
                  messages={messages}
                  thinkingOpen={thinkingOpen}
                  onToggleThinking={toggleThinking}
                  copied={copied}
                  onCopy={copyMessage}
                  onRetry={handleRetry}
                />
              )}
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
            <PlaygroundRail
              params={params}
              onParamsChange={setParams}
              onResetParams={() => setParams({ ...DEFAULT_PARAMS })}
              routePlans={[{ key: "a", plan: routePlan }]}
              lastTurn={lastTurn}
              saver={{ label: saverNote }}
              onOpenTokenSaver={() => router.push("/dashboard/token-saver")}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
