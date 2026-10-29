"use client";
import Icon from "@/shared/components/Icon";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SegmentedControl, Tooltip } from "@/shared/components";
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
const MODE_STORAGE_KEY = "jrouter.playground.mode.v1";
const MODES = ["single", "compare", "json"];
const DEFAULT_PARAMS = { useDefaults: true, temperature: 0.7, maxTokens: 4096, topP: 0.95, stream: true, jsonMode: false };
const SUGGESTIONS = [
  "Explain your capabilities",
  "Write a short TypeScript example",
  "Compare REST and GraphQL",
];
const MODE_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "compare", label: "Compare" },
  { value: "json", label: "JSON API" },
];
const LANE_OPTIONS = [
  { value: "a", label: "Lane A" },
  { value: "b", label: "Lane B" },
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

  const [mode, setMode] = useState("single");
  const [activeLane, setActiveLane] = useState("a");
  // Which lane JSON mode mirrors; the request inspector itself lands in Task 9.
  const [jsonLane, setJsonLane] = useState("a");
  // One picker is open at a time, keyed by lane: null, "a" or "b".
  const [pickerFor, setPickerFor] = useState(null);
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [thinkingOpen, setThinkingOpen] = useState({});
  const [railOpen, setRailOpen] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);

  const paramsRef = useRef({ ...DEFAULT_PARAMS });
  const systemPromptRef = useRef("");
  const [input, setInput] = useState("");
  const restoreDraft = useCallback((text) => setInput((current) => current || text), []);
  const laneA = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
  const laneB = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
  const router = useRouter();

  const inputRef = useRef(null);
  const scrollRefs = useRef({ a: null, b: null });
  const atBottomRefs = useRef({ a: true, b: true });
  const { copied, copy } = useCopyToClipboard();

  // The rail owns the fields; both turn engines read them through the ref at send time.
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

  // The mode survives reloads. Browser-only restoration has to follow the server's
  // single-lane render, so it cannot be part of the initial state.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (MODES.includes(saved)) setMode(saved);
    } catch {
      // A blocked store just means the default single mode.
    }
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

  const changeMode = (next) => {
    if (!MODES.includes(next) || next === mode) return;
    setMode(next);
    setPickerFor(null);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // The mode still applies for this session when storage is blocked.
    }
  };

  const handleActiveLane = (key) => {
    setActiveLane(key);
    // The lane in view is also the lane JSON mode will inspect.
    setJsonLane(key);
  };

  // Compare renders both lanes; every other mode edits lane A (or the persisted
  // JSON lane), so all single-view chrome keeps one source of truth.
  const laneKeyInView = mode === "json" ? jsonLane : "a";
  const laneInView = laneKeyInView === "b" ? laneB : laneA;
  const lanes = mode === "compare"
    ? [{ key: "a", lane: laneA }, { key: "b", lane: laneB }]
    : [{ key: laneKeyInView, lane: laneInView }];
  const headerLane = lanes[0];
  const viewLane = mode === "compare" ? (activeLane === "b" ? laneB : laneA) : laneInView;
  const viewModel = viewLane.model;

  const handleLaneScroll = (key) => {
    const element = scrollRefs.current[key];
    if (!element) return;
    atBottomRefs.current[key] = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  const followLane = useCallback((key) => {
    const element = scrollRefs.current[key];
    if (element && atBottomRefs.current[key]) element.scrollTop = element.scrollHeight;
  }, []);

  // Follow new output only while the reader is already at the bottom, so scrolling
  // back through a long answer is not yanked away by incoming tokens.
  useEffect(() => { followLane("a"); }, [laneA.messages, followLane]);
  useEffect(() => { followLane("b"); }, [laneB.messages, followLane]);
  // A lane hidden below 1100px has no box to scroll until the tabs reveal it.
  useEffect(() => { followLane(activeLane); }, [activeLane, followLane]);

  const openPicker = (key) => {
    if (mode === "compare") handleActiveLane(key);
    setPickerFor(key);
  };

  const togglePicker = (key) => {
    if (pickerFor === key) {
      setPickerFor(null);
      return;
    }
    openPicker(key);
  };

  // Header telemetry: the target's real context window (from the model catalog)
  // and the exact request the last turn in view sent, replayed as a cURL.
  const caps = useModelCaps();
  const contextWindow = viewModel ? caps.getCaps(viewModel.value)?.contextWindow || 0 : 0;
  const headerCurl = viewLane.lastTurn?.request ? buildCurl(viewLane.lastTurn.request) : "";

  const composerTargets = lanes;
  const composerBusy = laneA.isStreaming || laneB.isStreaming;
  const missingTarget = composerTargets.find((entry) => !entry.lane.model) || null;
  const canSend = !composerBusy && !missingTarget && input.trim().length > 0;
  const hasMessages = laneA.messages.length > 0 || laneB.messages.length > 0;

  // One composer feeds every lane in view, so a compare turn is a single prompt
  // broadcast to both targets.
  const submit = () => {
    const text = input.trim();
    if (!text || composerBusy) return;
    const ready = composerTargets.filter((entry) => entry.lane.model);
    if (ready.length === 0) return;
    setInput("");
    ready.forEach((entry) => {
      // A send always jumps to the new turn, even if the reader had scrolled back.
      atBottomRefs.current[entry.key] = true;
      entry.lane.send(text);
    });
    inputRef.current?.focus();
  };

  const stopAll = () => {
    laneA.stop();
    laneB.stop();
  };

  // Reset session clears both transcripts, the draft and any open overlay.
  const handleResetSession = () => {
    laneA.reset();
    laneB.reset();
    setInput("");
    setThinkingOpen({});
    setPickerFor(null);
    atBottomRefs.current = { a: true, b: true };
    inputRef.current?.focus();
  };

  // Clear thread drops the conversations but keeps the draft and the targets.
  const handleClearThread = () => {
    laneA.reset();
    laneB.reset();
    setThinkingOpen({});
    atBottomRefs.current = { a: true, b: true };
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
    if (canSend) submit();
  };

  const handleSuggestion = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const toggleThinking = (messageId) => {
    setThinkingOpen((previous) => ({ ...previous, [messageId]: !previous[messageId] }));
  };

  const modelCatalog = useModelCatalog({ isOpen: pickerFor !== null, activeProviders: providers, modelAliases });
  const hasCatalog = modelCatalog.filteredCombos.length
    + Object.values(modelCatalog.visibleGroups).reduce((total, group) => total + group.models.length, 0) > 0;

  const emptyHintFor = (lane, key) => {
    if (mode === "compare") {
      return lane.model
        ? `Test ${lane.model.name} against lane ${key === "a" ? "B" : "A"}.`
        : `Pick a model for lane ${key.toUpperCase()}, then send a prompt to compare both.`;
    }
    return lane.model
      ? `Test ${lane.model.name} through JRouter.`
      : !loading && providers.length === 0
        ? "No providers connected yet. Connect one from the Providers page to test models here."
        : "Pick a model, then send your first message through JRouter.";
  };

  const composerPlaceholder = mode === "compare"
    ? laneA.model && laneB.model
      ? `Message ${laneA.model.name} and ${laneB.model.name}…`
      : "Pick a model for each lane to compare…"
    : viewModel
      ? `Message ${viewModel.name}...`
      : "Select a model to start…";

  // KPI props carry only values the APIs returned; nothing here is estimated.
  // `targets` is what is actually selected, so a half-filled compare reads one target.
  const targets = (mode === "compare" ? [laneA.model, laneB.model] : [headerLane.lane.model]).filter(Boolean);
  const primaryTarget = targets[0] || null;
  const cache = cacheShare(usageStats);
  const routePlanA = buildRoutePlan(laneA.model, combos, providers, settings?.comboStrategies || {});
  const routePlanB = buildRoutePlan(laneB.model, combos, providers, settings?.comboStrategies || {});
  // Single view follows the lane on screen; compare keeps the routing card on lane A
  // because the rail already lists both plans, one per lane.
  const viewPlan = mode === "compare"
    ? routePlanA
    : buildRoutePlan(headerLane.lane.model, combos, providers, settings?.comboStrategies || {});
  const routePlans = mode === "compare"
    ? [{ key: "a", plan: routePlanA }, { key: "b", plan: routePlanB }]
    : [{ key: "a", plan: viewPlan }];
  const saverNote = settings === null
    ? "Token saver status unavailable"
    : `Token saver: RTK ${settings.rtkEnabled ? "on" : "off"} · Headroom ${settings.headroomEnabled ? "on" : "off"}`;

  const statsProps = {
    targetLabel: targets.length > 1
      ? `${targets.length} targets`
      : primaryTarget
        ? shortModelName(primaryTarget.name)
        : "No target",
    targetNote: targets.length > 1
      ? targets.map((target) => target.providerName || "Unknown provider").join(" + ")
      : primaryTarget
        ? `${primaryTarget.providerName || "Unknown provider"} · ${primaryTarget.isCombo ? "combo" : "direct"}`
        : "Pick a model to start",
    targetStatus: targets.length ? (composerBusy ? "streaming" : "ready") : "idle",
    cachePercent: cache.percent,
    cacheNote: usageStats === null
      ? "Usage data unavailable"
      : cache.hasData
        ? `${formatCount(cache.cached)} cached tokens today`
        : "No prompt tokens today",
    saverNote,
    hasCache: cache.hasData,
    routeLabel: viewPlan.label,
    routeNote: viewPlan.summary,
    routeStrategy: viewPlan.strategy ? `${viewPlan.strategy} · from config` : "from config",
  };

  const systemCard = (
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
  );

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.title}>Playground</h1>
          <p className={styles.sub}>Test models, combos, prompt routing, and streaming latencies in real time.</p>
        </div>
        <div className={styles.introActions}>
          <SegmentedControl
            aria-label="Playground mode"
            value={mode}
            onChange={changeMode}
            options={MODE_OPTIONS}
          />
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
            {mode === "compare" ? (
              <SegmentedControl
                size="sm"
                aria-label="Active lane"
                value={activeLane}
                onChange={handleActiveLane}
                options={LANE_OPTIONS}
              />
            ) : (
              <div className={styles.modelTriggerWrap}>
                <button
                  type="button"
                  data-model-trigger
                  className={styles.modelTrigger}
                  onClick={() => togglePicker(headerLane.key)}
                  aria-haspopup="dialog"
                  aria-expanded={pickerFor === headerLane.key}
                >
                  <ModelIcon
                    providerId={headerLane.lane.model?.providerId}
                    providerName={headerLane.lane.model?.providerName}
                    providerColor={headerLane.lane.model?.providerColor}
                    isCombo={headerLane.lane.model?.isCombo}
                    size={18}
                  />
                  <span className={styles.modelTriggerText}>
                    <span className={styles.modelNameRow}>
                      <span className={styles.modelName}>
                        {headerLane.lane.model
                          ? headerLane.lane.model.name
                          : loading ? "Loading models…" : "Select a model"}
                      </span>
                      {headerLane.lane.model?.isCombo ? <span className={styles.modelBadge}>combo</span> : null}
                    </span>
                    <span className={styles.modelProvider}>
                      {headerLane.lane.model
                        ? headerLane.lane.model.providerName || headerLane.lane.model.value
                        : !loading && providers.length === 0
                          ? "No connected providers"
                          : "Choose from connected providers"}
                    </span>
                  </span>
                  <Icon className={styles.chevron}>{pickerFor === headerLane.key ? "expand_less" : "expand_more"}</Icon>
                </button>

                <ModelPickerPopover
                  isOpen={pickerFor === headerLane.key}
                  onClose={() => setPickerFor(null)}
                  onSelect={(model) => {
                    headerLane.lane.selectModel(model);
                    setPickerFor(null);
                    inputRef.current?.focus();
                  }}
                  selectedModel={headerLane.lane.model?.value}
                  activeProviders={providers}
                  modelAliases={modelAliases}
                />
              </div>
            )}

            <div className={styles.pills}>
              {mode === "compare" ? <span className={styles.pill}>lane {activeLane}</span> : null}
              {viewModel?.isCombo ? <span className={styles.pill}>combo</span> : null}
              {contextWindow ? <span className={styles.pill}>{formatContext(contextWindow)} ctx</span> : null}
              <span className={styles.pill} data-tone={composerBusy ? "live" : "idle"}>
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
                  disabled={!hasMessages}
                  aria-label="Clear thread"
                >
                  <Icon>delete</Icon>
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

          {loadError ? (
            <div className={styles.chatNotice}>
              <p className={styles.loadError} role="alert">
                <Icon>error</Icon>
                {loadError}
              </p>
            </div>
          ) : null}

          <div className={styles.lanes} data-mode={mode} data-active={activeLane}>
            {lanes.map(({ key, lane }) => (
              <section
                key={key}
                className={styles.lane}
                data-lane={key}
                aria-label={mode === "compare" ? `Lane ${key.toUpperCase()}` : undefined}
              >
                {mode === "compare" ? (
                  <div className={styles.laneHead}>
                    <span className={styles.laneLetter}>{key.toUpperCase()}</span>
                    <div className={styles.modelTriggerWrap}>
                      <button
                        type="button"
                        data-model-trigger
                        className={styles.modelTrigger}
                        onClick={() => togglePicker(key)}
                        aria-haspopup="dialog"
                        aria-expanded={pickerFor === key}
                        aria-label={`Lane ${key.toUpperCase()} model`}
                      >
                        <ModelIcon
                          providerId={lane.model?.providerId}
                          providerName={lane.model?.providerName}
                          providerColor={lane.model?.providerColor}
                          isCombo={lane.model?.isCombo}
                          size={18}
                        />
                        <span className={styles.modelTriggerText}>
                          <span className={styles.modelNameRow}>
                            <span className={styles.modelName}>
                              {lane.model ? lane.model.name : loading ? "Loading models…" : "Select a model"}
                            </span>
                            {lane.model?.isCombo ? <span className={styles.modelBadge}>combo</span> : null}
                          </span>
                          <span className={styles.modelProvider}>
                            {lane.model
                              ? lane.model.providerName || lane.model.value
                              : "Choose from connected providers"}
                          </span>
                        </span>
                        <Icon className={styles.chevron}>{pickerFor === key ? "expand_less" : "expand_more"}</Icon>
                      </button>

                      <ModelPickerPopover
                        isOpen={pickerFor === key}
                        onClose={() => setPickerFor(null)}
                        onSelect={(model) => {
                          lane.selectModel(model);
                          setPickerFor(null);
                          inputRef.current?.focus();
                        }}
                        selectedModel={lane.model?.value}
                        activeProviders={providers}
                        modelAliases={modelAliases}
                      />
                    </div>
                    <span className={styles.laneStatus}>
                      {lane.isStreaming ? "streaming" : lane.model ? "ready" : "no model"}
                    </span>
                  </div>
                ) : null}

                <div
                  className={styles.laneBody}
                  ref={(element) => { scrollRefs.current[key] = element; }}
                  onScroll={() => handleLaneScroll(key)}
                  role="region"
                  aria-label={mode === "compare" ? `Lane ${key.toUpperCase()} conversation` : "Conversation"}
                  tabIndex={0}
                >
                  {mode !== "compare" ? systemCard : null}

                  <div className={styles.canvas}>
                    {lane.messages.length === 0 ? (
                      <div className={styles.empty}>
                        <span className={styles.emptyIcon}>
                          <Icon>science</Icon>
                        </span>
                        <p className={styles.emptyTitle}>
                          {mode === "compare" ? `Lane ${key.toUpperCase()}` : "Start a conversation"}
                        </p>
                        <p className={styles.emptyHint}>{emptyHintFor(lane, key)}</p>
                        {lane.model && hasCatalog ? (
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
                        messages={lane.messages}
                        thinkingOpen={thinkingOpen}
                        onToggleThinking={toggleThinking}
                        copied={copied}
                        onCopy={copyMessage}
                        onRetry={lane.retry}
                      />
                    )}
                  </div>
                </div>
              </section>
            ))}
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
                placeholder={composerPlaceholder}
                aria-label="Message"
              />

              <div className={styles.composerBar}>
                <div className={styles.composerContexts}>
                  {composerTargets.map(({ key, lane }) => (
                    lane.model ? (
                      <span key={key} className={styles.composerContext}>
                        <ModelIcon
                          providerId={lane.model.providerId}
                          providerName={lane.model.providerName}
                          providerColor={lane.model.providerColor}
                          isCombo={lane.model.isCombo}
                          size={13}
                        />
                        <span className={styles.composerContextName}>
                          {mode === "compare" ? `${key.toUpperCase()} · ` : ""}
                          {lane.model.providerName || lane.model.name}
                        </span>
                      </span>
                    ) : null
                  ))}

                  {missingTarget ? (
                    <button
                      type="button"
                      className={styles.suggestion}
                      onClick={() => openPicker(missingTarget.key)}
                      aria-label={`Select a model for lane ${missingTarget.key.toUpperCase()}`}
                    >
                      Select a model
                    </button>
                  ) : null}
                </div>

                <span className={styles.composerButtons}>
                  {composerBusy ? (
                    <Tooltip text="Stop generating">
                      <button
                        type="button"
                        className={styles.sendButton}
                        data-mode="stop"
                        onClick={stopAll}
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
                        onClick={submit}
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
              routePlans={routePlans}
              lastTurn={viewLane.lastTurn}
              saver={{ label: saverNote }}
              onOpenTokenSaver={() => router.push("/dashboard/token-saver")}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
