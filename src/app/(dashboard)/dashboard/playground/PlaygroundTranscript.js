"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import { Button } from "@/shared/components";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import ModelIcon from "./PlaygroundModelIcon";
import { buildMetricParts, formatLatency } from "./playgroundUtils.js";
import styles from "./playground.module.css";

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

/**
 * The conversation body: bubbles, reasoning accordions, live activity, errors and
 * the telemetry row under each answer. Purely presentational — every action is
 * raised to the page so the turn engine stays the only thing that talks to it.
 */
export default function PlaygroundTranscript({
  messages,
  thinkingOpen,
  onToggleThinking,
  copied,
  onCopy,
  onRetry,
}) {
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
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => onRetry(message.id)}>
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
                  onClick={() => onToggleThinking(message.id)}
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
              onClick={() => onCopy(message)}
              disabled={!message.content && !message.reasoning}
            >
              <Icon>{copied === message.id ? "check" : "content_copy"}</Icon>
              {copied === message.id ? "Copied" : "Copy"}
            </button>
            {canRetry ? (
              <button type="button" className={styles.actionButton} onClick={() => onRetry(message.id)}>
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

  return messages.map(renderMessage);
}

PlaygroundTranscript.propTypes = {
  messages: PropTypes.array.isRequired,
  thinkingOpen: PropTypes.object.isRequired,
  onToggleThinking: PropTypes.func.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
};
