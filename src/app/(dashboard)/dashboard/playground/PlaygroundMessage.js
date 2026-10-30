"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import PlaygroundModelIcon from "./PlaygroundModelIcon";
import { buildMetaParts, formatSeconds } from "./playgroundUtils";
import styles from "./playground.module.css";

function statusLabel(message) {
  if (message.status === "streaming") {
    if (message.content) return "writing…";
    if (message.reasoning) return "thinking…";
    return "waiting…";
  }
  if (message.elapsedMs) return `for ${formatSeconds(message.elapsedMs)}`;
  return "";
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
  if (message.role === "divider") {
    return <p className={styles.divider}>{message.content}</p>;
  }

  if (message.role === "user") {
    return (
      <div className={`${styles.row} ${styles.rowUser}`}>
        <div className={styles.userBubble}>{message.content}</div>
        <div className={styles.userMeta}>
          <span>YOU</span>
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
  const isWaiting = message.status === "streaming" && !message.content && !message.reasoning;
  const isThinking = message.status === "streaming" && !!message.reasoning && !message.content;
  const showActions = message.status !== "streaming" && message.status !== "error";
  const parts = message.meta ? buildMetaParts(message.meta) : [];
  const thoughtLabel = isThinking
    ? "Thinking…"
    : message.thinkingMs
      ? `Thought for ${formatSeconds(message.thinkingMs)}`
      : "Thoughts";

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
        <span className={styles.assistantStatus}>
          {isWaiting ? <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span> : null}
          {status}
        </span>

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

      {message.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorHead}><Icon>error</Icon> Request failed</p>
          <p className={styles.errorBody}>{message.error || "Request failed."}</p>
          <button type="button" className={styles.retryButton} onClick={() => onRetry(message.id)}>
            <Icon>refresh</Icon>
            Retry
          </button>
        </div>
      ) : (
        <>
          {message.reasoning ? (
            <div className={styles.thinking}>
              <button
                type="button"
                className={styles.thinkingToggle}
                onClick={() => onToggleThinking(message.id)}
                aria-expanded={thinkingOpen}
              >
                <Icon>stars</Icon>
                {thoughtLabel}
                <Icon className={styles.chevronSmall}>{thinkingOpen ? "expand_less" : "expand_more"}</Icon>
              </button>
              {thinkingOpen ? <div className={styles.thinkingBody}>{message.reasoning}</div> : null}
            </div>
          ) : null}

          {message.content ? (
            <div className={styles.assistantBody}>
              {raw ? (
                <pre className={styles.rawBody}>{message.content}</pre>
              ) : (
                <PlaygroundMarkdown content={message.content} />
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
