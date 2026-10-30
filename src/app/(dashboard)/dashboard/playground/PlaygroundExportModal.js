"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import Modal from "@/shared/components/Modal";
import { renderCurl, renderJavaScript, renderPython } from "./playgroundUtils";
import styles from "./playground-dialogs.module.css";

const TABS = [
  { key: "curl", label: "cURL" },
  { key: "javascript", label: "JavaScript" },
  { key: "python", label: "Python" },
];

function buildCode(tab, body) {
  const origin = typeof window === "undefined" ? "http://localhost:20128" : window.location.origin;
  if (tab === "javascript") return renderJavaScript(body, origin);
  if (tab === "python") return renderPython(body, origin);
  return renderCurl(body, origin);
}

export default function PlaygroundExportModal({ isOpen, onClose, body, onCopy }) {
  const [tab, setTab] = useState("curl");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every open starts on cURL again
    if (!isOpen) setTab("curl");
  }, [isOpen]);

  const code = buildCode(tab, body);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export code" size="full" className={styles.exportDialog}>
      <p className={styles.exportLead}>The request for this conversation, with your current settings.</p>

      <div className={styles.exportTabs} role="group" aria-label="Language">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={tab === entry.key}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <pre className={styles.exportCode}>{code}</pre>

      <div className={styles.exportActions}>
        <button type="button" className={styles.exportSecondary} onClick={onClose}>Close</button>
        <button type="button" className={styles.exportPrimary} onClick={() => onCopy(code)}>
          <Icon>content_copy</Icon>
          Copy
        </button>
      </div>
    </Modal>
  );
}

PlaygroundExportModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  body: PropTypes.object.isRequired,
  onCopy: PropTypes.func.isRequired,
};
