"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/shared/components/Icon";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import styles from "./console-log.module.css";

const LEVELS = ["all", "log", "info", "warn", "error", "debug"];
const LEVEL_LABELS = { all: "All", log: "Log", info: "Info", warn: "Warn", error: "Error", debug: "Debug" };
const LEVEL_PATTERN = /\[(LOG|INFO|WARN|WARNING|ERR|ERROR|DBG|DEBUG)\]/i;

function detectLevel(line) {
  const match = String(line).match(LEVEL_PATTERN);
  if (!match) return "log";
  const tag = match[1].toUpperCase();
  if (tag === "WARN" || tag === "WARNING") return "warn";
  if (tag === "ERR" || tag === "ERROR") return "error";
  if (tag === "DBG" || tag === "DEBUG") return "debug";
  if (tag === "INFO") return "info";
  return "log";
}

function LineText({ line }) {
  const match = String(line).match(LEVEL_PATTERN);
  if (!match || match.index == null) return <span className={styles.lineText}>{line}</span>;
  const before = line.slice(0, match.index);
  const after = line.slice(match.index + match[0].length);
  return (
    <span className={styles.lineText}>
      {before}
      <b className={styles.inlineTag} data-level={detectLevel(line)}>{match[1]}</b>
      {after}
    </span>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozenCount, setFrozenCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [clearArmed, setClearArmed] = useState(false);
  const logRef = useRef(null);
  const clearTimer = useRef(null);

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "init") {
        setLogs(message.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (message.type === "line") {
        setLogs((previous) => {
          const next = [...previous, message.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (message.type === "lines") {
        setLogs((previous) => {
          const next = [...previous, ...message.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (message.type === "clear") {
        setLogs([]);
        setFrozenCount(0);
      }
    };

    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const counts = useMemo(() => {
    const next = { all: logs.length, log: 0, info: 0, warn: 0, error: 0, debug: 0 };
    for (const line of logs) next[detectLevel(line)] += 1;
    return next;
  }, [logs]);

  const source = paused ? logs.slice(0, frozenCount) : logs;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return source
      .map((line, index) => ({ line, index, level: detectLevel(line) }))
      .filter((row) => level === "all" || row.level === level)
      .filter((row) => !needle || String(row.line).toLowerCase().includes(needle));
  }, [source, level, query]);

  // Follow the tail only while the reader is already at the bottom (and never
  // while paused) so reading history is not interrupted by new lines.
  useEffect(() => {
    const node = logRef.current;
    if (!node || paused || !atBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [visible, paused, atBottom]);

  const handleScroll = () => {
    const node = logRef.current;
    if (!node) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setAtBottom(bottom);
  };

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setAtBottom(true);
      return;
    }
    setFrozenCount(logs.length);
    setPaused(true);
  };

  const handleClear = async () => {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setClearArmed(false);
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
    } catch (error) {
      console.error("Failed to clear console logs:", error);
    }
  };

  const jumpToLatest = () => {
    const node = logRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setAtBottom(true);
  };

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <div className={styles.introCopy}>
          <h1 className={styles.title}>Console Log</h1>
          <p className={styles.sub}>Live server output from the gateway, streamed in real time.</p>
        </div>
        <span className={styles.status} data-live={connected ? "true" : "false"}>
          <i className={styles.statusDot} aria-hidden="true" />
          {connected ? "Live" : "Reconnecting"}
        </span>
      </header>

      <section className={styles.panel} aria-label="Console output">
        <div className={styles.toolbar}>
          <div className={styles.chips} role="group" aria-label="Filter by level">
            {LEVELS.map((value) => (
              <button
                key={value}
                type="button"
                className={styles.chip}
                aria-pressed={level === value}
                onClick={() => setLevel(value)}
              >
                {LEVEL_LABELS[value]}
                <em className={styles.chipCount}>{counts[value]}</em>
              </button>
            ))}
          </div>

          <div className={styles.tools}>
            <label className={styles.search}>
              <Icon className={styles.searchIcon}>search</Icon>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter output…"
                aria-label="Filter console output"
              />
            </label>
            <button type="button" className={styles.toolButton} aria-pressed={paused} onClick={togglePause}>
              <Icon>{paused ? "play_arrow" : "stop"}</Icon>
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className={`${styles.toolButton} ${clearArmed ? styles.clearArmed : ""}`}
              onClick={handleClear}
            >
              <Icon>delete</Icon>
              {clearArmed ? "Confirm clear" : "Clear"}
            </button>
          </div>
        </div>

        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>
            <i className={styles.panelDot} aria-hidden="true" />
            Live output
          </span>
          <span className={styles.panelMeta}>
            {paused ? `Paused at ${frozenCount}` : `${logs.length} / ${CONSOLE_LOG_CONFIG.maxLines} lines`}
          </span>
        </div>

        <div className={styles.terminalWrap}>
          <div
            ref={logRef}
            className={styles.terminal}
            role="log"
            aria-label="Console lines"
            aria-live="off"
            tabIndex={0}
            onScroll={handleScroll}
          >
            {visible.length === 0 ? (
              <div className={styles.empty}>
                <Icon className={styles.emptyIcon}>terminal</Icon>
                <p className={styles.emptyTitle}>
                  {logs.length === 0 ? "No console output yet" : "No lines match this filter"}
                </p>
                <p className={styles.emptyBody}>
                  {logs.length === 0
                    ? "Requests, provider calls and errors will appear here as the gateway runs."
                    : "Try another level or clear the search."}
                </p>
              </div>
            ) : (
              visible.map((row) => (
                <div key={`${row.index}-${row.line}`} className={styles.line} data-level={row.level}>
                  <span className={styles.lineNumber}>{row.index + 1}</span>
                  <span className={styles.levelTag} data-level={row.level}>{row.level}</span>
                  <LineText line={row.line} />
                </div>
              ))
            )}
          </div>
          {!atBottom && !paused ? (
            <button type="button" className={styles.jump} onClick={jumpToLatest}>
              <Icon>arrow_downward</Icon>
              Jump to latest
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
