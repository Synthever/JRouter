"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_TITLE_CHARS,
  SESSIONS_KEY,
  persistSessions,
  readStorage,
  restoreSessions,
} from "./playgroundUtils";

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createSession(model = null) {
  return { id: createId(), title: "New chat", model, messages: [], updatedAt: Date.now() };
}

// One conversation store for the page: hydrate from localStorage on mount,
// write through on every change, and keep the CRUD surface the UI needs.
export default function usePlaygroundSessions() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStorage(SESSIONS_KEY, (value) => restoreSessions(value) !== null);
    const restored = restoreSessions(stored);
    if (restored) {
      // Hydrate once after mount: localStorage is unreadable during the server
      // render, so a lazy initializer would desync hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage hydration
      setSessions(restored.conversations);
      setActiveId(restored.activeId);
    } else {
      const first = createSession();
      setSessions([first]);
      setActiveId(first.id);
    }
    setHydrated(true);
  }, []);

  // Streaming patches land every few dozen milliseconds; debounce the write so
  // localStorage is not serialized on every token.
  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => persistSessions({ activeId, conversations: sessions }), 600);
    return () => clearTimeout(timer);
  }, [hydrated, activeId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) || sessions[0] || null,
    [sessions, activeId],
  );

  const updateSession = useCallback((id, updater) => {
    setSessions((current) => current.map((session) => (
      session.id === id ? { ...updater(session), updatedAt: Date.now() } : session
    )));
  }, []);

  const newSession = useCallback((model) => {
    const session = createSession(model);
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    return session;
  }, []);

  const duplicateSession = useCallback((source) => {
    if (!source) return;
    const copy = {
      ...source,
      id: createId(),
      title: `${source.title} (copy)`.slice(0, MAX_TITLE_CHARS),
      messages: source.messages.map((message) => ({ ...message, id: createId() })),
      updatedAt: Date.now(),
    };
    setSessions((current) => [copy, ...current]);
    setActiveId(copy.id);
  }, []);

  const deleteSession = useCallback((id) => {
    const remaining = sessions.filter((session) => session.id !== id);
    if (remaining.length === 0) {
      const fresh = createSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setSessions(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  }, [sessions, activeId]);

  return {
    sessions,
    activeId,
    activeSession,
    setActiveId,
    newSession,
    duplicateSession,
    deleteSession,
    updateSession,
  };
}
