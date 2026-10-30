"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/shared/components/Icon";
import styles from "./playground.module.css";

const BOTTOM_THRESHOLD = 80;

export default function PlaygroundTranscript({ messages, isStreaming, renderMessage, empty, loadError }) {
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const [showPill, setShowPill] = useState(false);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const syncAtBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD;
    setShowPill(!atBottomRef.current);
  }, []);

  // New output only pulls the reader down while they are already at the bottom.
  useEffect(() => {
    if (!atBottomRef.current) return;
    scrollToBottom();
    setShowPill(false);
  }, [messages, isStreaming, scrollToBottom]);

  return (
    <div className={styles.viewport}>
      <div
        ref={scrollRef}
        className={styles.transcript}
        role="log"
        aria-label="Conversation"
        tabIndex={0}
        onScroll={syncAtBottom}
      >
        <div className={styles.column}>
          {loadError ? (
            <p className={styles.loadError} role="alert">
              <Icon>error</Icon>
              {loadError}
            </p>
          ) : null}
          {messages.length === 0 ? empty : messages.map(renderMessage)}
        </div>
      </div>

      <button
        type="button"
        className={styles.scrollPill}
        hidden={!showPill}
        onClick={() => {
          atBottomRef.current = true;
          scrollToBottom();
          setShowPill(false);
        }}
      >
        <Icon>arrow_downward</Icon>
        <span>Scroll to bottom</span>
      </button>
    </div>
  );
}

PlaygroundTranscript.propTypes = {
  messages: PropTypes.array.isRequired,
  isStreaming: PropTypes.bool,
  renderMessage: PropTypes.func.isRequired,
  empty: PropTypes.node.isRequired,
  loadError: PropTypes.string,
};
