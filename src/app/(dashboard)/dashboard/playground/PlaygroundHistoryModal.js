"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/Modal";
import { relativeTime } from "./playgroundUtils";
import styles from "./playground-dialogs.module.css";

export default function PlaygroundHistoryModal({ isOpen, onClose, sessions, activeId, onSelect, onNew, onDuplicate, onDelete }) {
  const [query, setQuery] = useState("");
  const [armedId, setArmedId] = useState("");

  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a closed dialog must not leak its search or an armed delete into the next open
      setQuery("");
      setArmedId("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!armedId) return undefined;
    const timer = setTimeout(() => setArmedId(""), 3000);
    return () => clearTimeout(timer);
  }, [armedId]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((session) => {
        if (!needle) return true;
        const haystack = [session.title, session.model?.name || "", ...session.messages.map((message) => message.content)].join(" ").toLowerCase();
        return haystack.includes(needle);
      });
  }, [sessions, query]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conversations" bare trapFocus className={styles.historyDialog}>
      <div className={styles.historyHead}>
        <span className={styles.historyTile}><Icon>chat</Icon></span>
        <div className={styles.historyTitle}>
          <h2>Conversations ({sessions.length})</h2>
          <p className={styles.historySub}>Switch or manage saved chat sessions</p>
        </div>
        <button type="button" className={styles.historyNew} onClick={onNew}>
          <Icon>add</Icon>
          New
        </button>
        <button type="button" className={styles.historyClose} onClick={onClose} aria-label="Close conversations">
          <Icon>close</Icon>
        </button>
      </div>

      <label className={styles.historySearch}>
        <Icon>search</Icon>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats by title, model, or content…"
          aria-label="Search chats"
        />
      </label>

      <div className={styles.historyList}>
        {rows.length === 0 ? (
          <p className={styles.historyEmpty}>No chats match “{query.trim()}”.</p>
        ) : rows.map((session) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            className={`${styles.historyRow} ${session.id === activeId ? styles.historyRowActive : ""}`}
            onClick={() => onSelect(session.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(session.id);
              }
            }}
          >
            <div className={styles.historyMetaWrap}>
              <b>
                {session.title}
                {session.id === activeId ? <span className={styles.activeBadge}>Active</span> : null}
              </b>
              <div className={styles.historyMeta}>
                <span><Icon>smart_toy</Icon>{session.model?.name || "No model"}</span>
                <span>{session.messages.length} msg{session.messages.length === 1 ? "" : "s"}</span>
                <span>{relativeTime(session.updatedAt)}</span>
              </div>
            </div>

            <div className={styles.historyActions}>
              <button
                type="button"
                className={styles.historyAction}
                aria-label={`Duplicate ${session.title}`}
                onClick={(event) => { event.stopPropagation(); onDuplicate(session); }}
              >
                <Icon>content_copy</Icon>
              </button>
              <button
                type="button"
                className={armedId === session.id ? styles.historyConfirm : styles.historyAction}
                aria-label={armedId === session.id ? "Confirm delete" : `Delete ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (armedId !== session.id) {
                    setArmedId(session.id);
                    return;
                  }
                  setArmedId("");
                  onDelete(session.id);
                }}
              >
                {armedId === session.id ? "Confirm" : <Icon>delete</Icon>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

PlaygroundHistoryModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  sessions: PropTypes.array.isRequired,
  activeId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  onNew: PropTypes.func.isRequired,
  onDuplicate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
