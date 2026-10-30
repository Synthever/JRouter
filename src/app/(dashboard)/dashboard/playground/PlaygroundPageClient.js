"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useHeaderTitleStore } from "@/store/headerTitleStore";
import { useNotificationStore } from "@/store/notificationStore";
import ModelPickerPopover from "./ModelPickerPopover";
import PlaygroundComposer from "./PlaygroundComposer";
import PlaygroundEmpty from "./PlaygroundEmpty";
import PlaygroundExportModal from "./PlaygroundExportModal";
import PlaygroundHistoryModal from "./PlaygroundHistoryModal";
import PlaygroundMessage from "./PlaygroundMessage";
import PlaygroundSettingsPopover from "./PlaygroundSettingsPopover";
import PlaygroundTranscript from "./PlaygroundTranscript";
import usePlaygroundChat from "./usePlaygroundChat";
import usePlaygroundHints from "./usePlaygroundHints";
import usePlaygroundSessions from "./usePlaygroundSessions";
import {
  DEFAULT_SETTINGS,
  FAVORITES_KEY,
  SETTINGS_KEY,
  buildExportBody,
  localTitle,
  normalizeSettings,
  readStorage,
  writeStorage,
} from "./playgroundUtils";
import styles from "./playground.module.css";

const DIVIDER_PREFIX = "Model switched to ";

export default function PlaygroundPageClient() {
  const [providers, setProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);

  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState({});
  const [rawById, setRawById] = useState({});

  const textareaRef = useRef(null);
  const activeIdRef = useRef("");
  const { copied, copy } = useCopyToClipboard();
  const notify = useNotificationStore((state) => state.addNotification);
  const setCrumbs = useHeaderTitleStore((state) => state.setCrumbs);
  const clearCrumbs = useHeaderTitleStore((state) => state.clearCrumbs);

  const {
    sessions,
    activeId,
    activeSession,
    setActiveId,
    newSession,
    duplicateSession,
    deleteSession,
    updateSession,
  } = usePlaygroundSessions();

  const updateSessionMessages = useCallback((sessionId, updater) => {
    updateSession(sessionId, (session) => ({ ...session, messages: updater(session.messages) }));
  }, [updateSession]);

  const appendMessages = useCallback((sessionId, messages) => {
    updateSessionMessages(sessionId, (current) => [...current, ...messages]);
  }, [updateSessionMessages]);

  const patchMessage = useCallback((sessionId, messageId, patch) => {
    updateSessionMessages(sessionId, (current) => current.map((message) => (
      message.id === messageId ? { ...message, ...patch } : message
    )));
  }, [updateSessionMessages]);

  const applyTitle = useCallback((sessionId, title) => {
    updateSession(sessionId, (session) => ({ ...session, title }));
  }, [updateSession]);

  const applyFollowUps = useCallback((sessionId, assistantId, questions) => {
    updateSessionMessages(sessionId, (current) => current.map((message) => (
      message.id === assistantId ? { ...message, followUps: questions } : message
    )));
  }, [updateSessionMessages]);

  const { requestTitle, requestFollowUps, cancelAll } = usePlaygroundHints({
    apiKey,
    model: activeSession?.model || null,
    helper: settings.helper,
    onTitle: applyTitle,
    onFollowUps: applyFollowUps,
  });

  // Follow-ups run only for the turn that just finished and produced text.
  const finishTurn = useCallback(({ sessionId, assistantId, status, content, messages, stopped }) => {
    if (stopped || status !== "done" || !content || !content.trim() || !settings.helper) return;
    // A turn can finish after the reader moved on; never start a helper call for it.
    if (sessionId !== activeIdRef.current) return;
    requestFollowUps(sessionId, assistantId, messages);
  }, [requestFollowUps, settings.helper]);

  const { isStreaming, run, stop } = usePlaygroundChat({
    apiKey,
    settings,
    onAppend: appendMessages,
    onPatch: patchMessage,
    onFinish: finishTurn,
  });

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
            : [],
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
    const stored = readStorage(SETTINGS_KEY, (value) => !!value && typeof value === "object");
    // Hydrate once after mount: localStorage is unreadable during the server render,
    // so lazy initializers would desync hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage hydration
    if (stored) setSettings(normalizeSettings(stored));
    setSettingsHydrated(true);

    const storedFavorites = readStorage(FAVORITES_KEY, Array.isArray);
    if (storedFavorites) setFavorites(storedFavorites.filter((value) => typeof value === "string"));
    setFavoritesHydrated(true);
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (settingsHydrated) writeStorage(SETTINGS_KEY, settings);
  }, [settings, settingsHydrated]);

  useEffect(() => {
    if (favoritesHydrated) writeStorage(FAVORITES_KEY, favorites);
  }, [favorites, favoritesHydrated]);

  useEffect(() => {
    textareaRef.current?.focus();
    return () => cancelAll();
  }, [cancelAll]);

  function inputRefFocus() {
    textareaRef.current?.focus();
  }

  const title = activeSession?.title || "New chat";
  useEffect(() => {
    setCrumbs([
      { label: "Playground", href: "/dashboard/playground" },
      { label: title },
    ]);
    return () => clearCrumbs();
  }, [title, setCrumbs, clearCrumbs]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointerDown = (event) => {
      if (event.target.closest?.("[data-playground-settings]")) return;
      if (event.target.closest?.('[aria-label="Playground settings"]')) return;
      setSettingsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const messages = activeSession?.messages || [];
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const lastId = lastAssistant?.id;
  const canSend = !isStreaming && !!activeSession?.model && input.trim().length > 0;

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    if (!activeSession?.model) {
      setPickerOpen(true);
      notify({ type: "info", message: "Pick a model to send this message", duration: 3000 });
      return;
    }
    const sessionId = activeSession.id;
    const firstTurn = activeSession.title === "New chat";
    setInput("");
    if (firstTurn) applyTitle(sessionId, localTitle(text));
    run({ sessionId, question: text, history: activeSession.messages, model: activeSession.model });
    if (firstTurn && settings.helper) requestTitle(sessionId, text);
  };

  const handleFollowUp = (question) => {
    if (isStreaming || !activeSession?.model) return;
    run({
      sessionId: activeSession.id,
      question,
      history: activeSession.messages,
      model: activeSession.model,
    });
  };

  const handleRetry = (assistantId) => {
    if (isStreaming) return;
    const index = messages.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    let questionIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === "user") {
        questionIndex = cursor;
        break;
      }
    }
    if (questionIndex < 0) return;
    const answered = messages[index];
    const value = answered.meta?.requestedModel || activeSession?.model?.value || "";
    if (!value) return;
    // Drop the retried question and everything after it before the new turn appends,
    // so the replacement turn does not duplicate the question or keep the stale answer.
    updateSessionMessages(activeSession.id, () => messages.slice(0, questionIndex));
    run({
      sessionId: activeSession.id,
      question: messages[questionIndex].content,
      history: messages.slice(0, questionIndex),
      model: {
        value,
        name: answered.modelName || value,
        providerId: answered.providerId || "",
        providerName: answered.providerName || "",
        providerColor: activeSession?.model?.providerColor || "",
        isCombo: answered.isCombo === true,
      },
    });
  };

  const handleStop = () => stop();

  const handleDeleteMessage = (messageId) => {
    if (isStreaming) stop();
    updateSessionMessages(activeId, (current) => current.filter((message) => message.id !== messageId));
    notify({ type: "info", message: "Message deleted", duration: 2000 });
  };

  const handleCopy = (message) => {
    const text = message.content || message.reasoning || "";
    if (text) copy(text, message.id);
  };

  const handleToggleThinking = (messageId) => {
    setThinkingOpen((current) => ({ ...current, [messageId]: !current[messageId] }));
  };

  const handleToggleRaw = (messageId) => {
    setRawById((current) => ({ ...current, [messageId]: !current[messageId] }));
  };

  const handleSelectModel = (model) => {
    if (!model?.value || !activeSession) return;
    const previous = activeSession.model;
    const changed = previous?.value !== model.value;
    const next = {
      value: model.value,
      name: model.name || model.value,
      providerId: model.providerId || "",
      providerName: model.providerName || "",
      providerColor: model.providerColor || "",
      isCombo: model.isCombo === true,
    };
    updateSession(activeSession.id, (session) => ({
      ...session,
      model: next,
      // One divider per model change, not one per pick: A→B→C with no turn between
      // must not stack two adjacent dividers.
      messages: changed
        && session.messages.length > 0
        && session.messages[session.messages.length - 1]?.role !== "divider"
        ? [...session.messages, {
          id: `divider_${Date.now()}`,
          role: "divider",
          content: `${DIVIDER_PREFIX}${next.name}`,
        }]
        : session.messages,
    }));
    setPickerOpen(false);
    inputRefFocus();
  };

  const resetTransient = () => {
    setInput("");
    setThinkingOpen({});
    setRawById({});
    setPickerOpen(false);
    setSettingsOpen(false);
  };

  const handleNewChat = () => {
    stop();
    cancelAll();
    if (!activeSession || activeSession.messages.length === 0) {
      resetTransient();
      inputRefFocus();
      return;
    }
    newSession(activeSession.model || null);
    resetTransient();
    inputRefFocus();
  };

  const handleSelectSession = (id) => {
    if (id !== activeId) {
      stop();
      cancelAll();
      setActiveId(id);
      resetTransient();
    }
    setHistoryOpen(false);
  };

  const handleDuplicateSession = (session) => {
    // Duplicating while a turn streams would leave the original stream writing into
    // a session the reader is no longer looking at.
    stop();
    cancelAll();
    duplicateSession(session);
    resetTransient();
  };

  const handleDeleteSession = (id) => {
    if (id === activeId) {
      stop();
      cancelAll();
    }
    deleteSession(id);
  };

  const handleClear = () => {
    stop();
    cancelAll();
    updateSession(activeId, (session) => ({ ...session, messages: [], title: "New chat" }));
    resetTransient();
    setSettingsOpen(false);
    notify({ type: "success", message: "Conversation cleared", duration: 2000 });
  };

  const handleSettingsChange = (patch) => {
    setSettings((current) => normalizeSettings({ ...current, ...patch }));
  };

  const toggleFavorite = (value) => {
    setFavorites((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
  };

  const runCommand = (key) => {
    setInput("");
    if (key === "/new") handleNewChat();
    else if (key === "/clear") handleClear();
    else if (key === "/history") setHistoryOpen(true);
    else if (key === "/model") setPickerOpen(true);
    else if (key === "/settings") setSettingsOpen(true);
    else if (key === "/export") setExportOpen(true);
  };

  const exportBody = useMemo(
    () => buildExportBody(activeSession || { model: null, messages: [] }, settings),
    [activeSession, settings],
  );

  const emptyHint = !loading && providers.length === 0
    ? "No providers connected yet. Connect one from the Providers page to test models here."
    : activeSession?.model
      ? `Test ${activeSession.model.name} through JRouter.`
      : "Pick a model, then send your first message through JRouter.";

  const renderMessage = (message) => (
    <PlaygroundMessage
      key={message.id}
      message={message}
      isLast={message.id === lastId}
      isStreaming={message.status === "streaming"}
      thinkingOpen={!!thinkingOpen[message.id]}
      raw={!!rawById[message.id]}
      copied={copied === message.id}
      onCopy={handleCopy}
      onDelete={handleDeleteMessage}
      onRetry={handleRetry}
      onToggleThinking={handleToggleThinking}
      onToggleRaw={handleToggleRaw}
      onFollowUp={handleFollowUp}
    />
  );

  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="Playground">
        <PlaygroundTranscript
          messages={messages}
          isStreaming={isStreaming}
          renderMessage={renderMessage}
          loadError={loadError}
          empty={(
            <PlaygroundEmpty
              hint={emptyHint}
              showSuggestions={!!activeSession?.model && providers.length > 0}
              onSuggestion={(suggestion) => {
                setInput(suggestion);
                inputRefFocus();
              }}
            />
          )}
        />

        <PlaygroundComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          canSend={canSend}
          model={activeSession?.model || null}
          pickerOpen={pickerOpen}
          onOpenPicker={() => {
            setSettingsOpen(false);
            setPickerOpen((open) => !open);
          }}
          picker={(
            <ModelPickerPopover
              isOpen={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelect={handleSelectModel}
              selectedModel={activeSession?.model?.value || ""}
              activeProviders={providers}
              modelAliases={modelAliases}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
            />
          )}
          onOpenHistory={() => {
            setPickerOpen(false);
            setSettingsOpen(false);
            setHistoryOpen(true);
          }}
          historyCount={sessions.length}
          think={settings.think}
          onToggleThink={() => handleSettingsChange({ think: !settings.think })}
          settingsOpen={settingsOpen}
          onToggleSettings={() => {
            setPickerOpen(false);
            setSettingsOpen((open) => !open);
          }}
          settingsPanel={settingsOpen ? (
            <PlaygroundSettingsPopover
              settings={settings}
              onChange={handleSettingsChange}
              onClose={() => setSettingsOpen(false)}
              onExport={() => {
                setSettingsOpen(false);
                setExportOpen(true);
              }}
              onClear={handleClear}
            />
          ) : null}
          onCommand={runCommand}
          textareaRef={textareaRef}
        />
      </section>

      <PlaygroundHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelectSession}
        onNew={() => {
          setHistoryOpen(false);
          handleNewChat();
        }}
        onDuplicate={handleDuplicateSession}
        onDelete={handleDeleteSession}
      />

      <PlaygroundExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        body={exportBody}
        onCopy={(code) => {
          copy(code, "export");
          notify({ type: "success", message: "Code copied", duration: 2000 });
        }}
      />
    </div>
  );
}
