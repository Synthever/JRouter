"use client";

import { useEffect, useState } from "react";
import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import PlaygroundModelIcon from "./PlaygroundModelIcon";
import useStreamReveal from "./useStreamReveal";
import { buildMetaParts, formatSeconds } from "./playgroundUtils";
import styles from "./playground.module.css";

// Chevron wavefront: each cell's delay is its column plus its distance from the
// middle row, so the bright front sweeps left→right as a chevron.
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const col = index % 3;
  return (col + Math.abs(row - 1)) * 90;
});

function statusLabel(message) {
  if (message.status === "streaming") {
    if (message.content) return "writing…";
    if (message.reasoning) return "thinking…";
    return "Generating";
  }
  if (message.elapsedMs) return `for ${formatSeconds(message.elapsedMs)}`;
  return "";
}

function useElapsed(startedAt, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  if (!active || !startedAt) return "";
  const total = Math.max(0, now - startedAt) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function PixelLoader() {
  return (
    <span className={styles.pixelLoader} aria-hidden="true">
      {CHEVRON_DELAYS.map((delay, index) => (
        <i key={index} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

// Reasoning arrives as one growing string, so the trace is derived from it:
// the last line is the step in flight, everything before it is done.
function reasoningSteps(reasoning) {
  return reasoning
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6);
}

function ThinkingTrace({ reasoning, working, summary, open, onToggle }) {
  const steps = reasoningSteps(reasoning);
  const visible = working ? steps : steps.slice(0, 3);
  const more = steps.length - visible.length;

  return (
    <div className={styles.thinking}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon className={styles.thinkingGlyph} data-working={working ? "true" : undefined}>stars</Icon>
        {working ? (
          <span className={styles.statusLabel}>{summary}</span>
        ) : (
          <span className={styles.thinkingDone}>{summary}</span>
        )}
        <Icon className={styles.chevronSmall}>{open ? "expand_less" : "expand_more"}</Icon>
      </button>

      <div className={styles.thinkingTrace} data-open={open ? "true" : undefined}>
        <div className={styles.thinkingTraceInner}>
          <div className={styles.thinkingSteps}>
            {visible.map((step, index) => {
              const pending = working && index === visible.length - 1;
              return (
                <div key={`${index}-${step}`} className={styles.thinkingStep}>
                  {pending ? (
                    <span className={styles.thinkingSpinner} aria-hidden="true" />
                  ) : (
                    <Icon className={styles.thinkingCheck}>check</Icon>
                  )}
                  <span className={styles.thinkingStepText}>{step}</span>
                </div>
              );
            })}
            {more > 0 ? <span className={styles.thinkingMore}>+{more} more</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlaygroundMessage({
  message,
  isLast,
  isStreaming,
  thinkingOpen,
  raw,
  copied,
  onCopy,
  onDelete,
  onRetry,
  onToggleThinking,
  onToggleRaw,
  onFollowUp,
}) {
  const reveal = useStreamReveal(
    message.content,
    message.role === "assistant" && isStreaming && message.status === "streaming",
  );
  const elapsed = useElapsed(message.startedAt, message.status === "streaming");

  if (message.role === "divider") {
    return <p className={styles.divider}>{message.content}</p>;
  }

  if (message.role === "user") {
    return (
      <div className={`${styles.row} ${styles.rowUser}`}>
        <div className={styles.userBubble}>{message.content}</div>
        <div className={styles.userMeta}>
          <button type="button" className={styles.iconAction} onClick={() => onCopy(message)} aria-label="Copy message">
            <Icon>{copied ? "check" : "content_copy"}</Icon>
          </button>
          <button type="button" className={styles.iconAction} onClick={() => onDelete(message.id)} aria-label="Delete message">
            <Icon>delete</Icon>
          </button>
        </div>
      </div>
    );
  }

  const status = statusLabel(message);
  const isThinking = message.status === "streaming" && !!message.reasoning && !message.content;
  const showActions = message.status !== "streaming" && message.status !== "error";
  const parts = message.meta ? buildMetaParts(message.meta) : [];
  const thoughtLabel = isThinking
    ? "Thinking…"
    : message.thinkingMs
      ? `Thought for ${formatSeconds(message.thinkingMs)}`
      : "Thoughts";
  const bodyContent = raw ? message.content : reveal;
  // While reasoning streams, the trace header carries the status; showing the
  // stream status line too would print "thinking…" twice.
  const showStreamStatus = message.status === "streaming" && !isThinking;

  return (
    <article className={styles.assistantCard}>
      <header className={styles.assistantHead}>
        <span className={styles.modelTile}>
          <PlaygroundModelIcon
            providerId={message.providerId}
            providerName={message.providerName}
            isCombo={message.isCombo}
            size={18}
          />
        </span>
        <b className={styles.assistantName}>{message.modelName || "Assistant"}</b>
        {message.isCombo || message.providerName ? (
          <span className={styles.assistantTag}>{message.isCombo ? "combo" : message.providerName}</span>
        ) : null}
        {message.status === "streaming" ? null : (
          <span className={styles.assistantStatus}>{status}</span>
        )}

        {showActions ? (
          <div className={styles.actions}>
            {isLast ? (
              <button type="button" className={styles.actionButton} onClick={() => onRetry(message.id)}>
                <Icon>refresh</Icon>
                <span>Retry</span>
              </button>
            ) : null}
            <button type="button" className={styles.actionButton} onClick={() => onToggleRaw(message.id)}>
              <Icon>code</Icon>
              <span>{raw ? "Rendered" : "Raw"}</span>
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onCopy(message)}
              disabled={!message.content && !message.reasoning}
            >
              <Icon>{copied ? "check" : "content_copy"}</Icon>
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" className={styles.iconAction} onClick={() => onDelete(message.id)} aria-label="Delete reply">
              <Icon>delete</Icon>
            </button>
          </div>
        ) : null}
      </header>

      {showStreamStatus ? (
        <div className={styles.streamStatus} role="status">
          <PixelLoader />
          <span className={styles.statusLabel}>{status}</span>
          {elapsed ? <span className={styles.statusElapsed}>{elapsed}</span> : null}
        </div>
      ) : null}

      {message.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorHead}><Icon>error</Icon> Request failed</p>
          <p className={styles.errorBody}>{message.error || "Request failed."}</p>
          {isLast ? (
            <button type="button" className={styles.retryButton} onClick={() => onRetry(message.id)}>
              <Icon>refresh</Icon>
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {message.reasoning ? (
            <ThinkingTrace
              reasoning={message.reasoning}
              working={isThinking}
              summary={thoughtLabel}
              open={thinkingOpen}
              onToggle={() => onToggleThinking(message.id)}
            />
          ) : null}

          {bodyContent ? (
            <div className={styles.assistantBody}>
              {raw ? (
                <pre className={styles.rawBody}>{bodyContent}</pre>
              ) : (
                <PlaygroundMarkdown content={bodyContent} />
              )}
              {isStreaming && message.status === "streaming" && message.content ? (
                <span className={styles.caret} aria-hidden="true">▍</span>
              ) : null}
            </div>
          ) : null}

          {!message.content && !message.reasoning && message.status !== "streaming" ? (
            <p className={styles.note}>
              {message.meta?.stopped ? "Stopped before any output." : "The model returned no text."}
            </p>
          ) : null}

          {!message.content && message.reasoning && message.status !== "streaming" ? (
            <p className={styles.note}>This model returned reasoning only.</p>
          ) : null}
        </>
      )}

      {isLast && !isStreaming && message.status === "done" && message.followUps?.length ? (
        <div className={styles.followUps}>
          {message.followUps.map((question, index) => (
            <button
              key={`${question}-${index}`}
              type="button"
              className={styles.followUp}
              onClick={() => onFollowUp(question)}
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}

      {parts.length > 0 ? (
        <p className={styles.meta}>
          {parts.map((part, index) => (
            <span key={`${part}-${index}`}>
              {index > 0 ? <span className={styles.metaSep}>·</span> : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

PlaygroundMessage.propTypes = {
  message: PropTypes.object.isRequired,
  isLast: PropTypes.bool,
  isStreaming: PropTypes.bool,
  thinkingOpen: PropTypes.bool,
  raw: PropTypes.bool,
  copied: PropTypes.bool,
  onCopy: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  onToggleThinking: PropTypes.func.isRequired,
  onToggleRaw: PropTypes.func.isRequired,
  onFollowUp: PropTypes.func.isRequired,
};
