"use client";

// JSON API mode: the exact request the active lane sent and the raw bytes that
// came back, with the headers masked and a reproduction cURL that carries the
// environment placeholder instead of the live gateway key.
import PropTypes from "prop-types";
import { useState } from "react";
import Icon from "@/shared/components/Icon";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildCurl, maskRequestHeaders } from "./playgroundUtils.js";
import styles from "./PlaygroundJsonView.module.css";

const TABS = [
  { value: "request", label: "Request" },
  { value: "response", label: "Response" },
  { value: "curl", label: "cURL" },
];

function CopyButton({ text = "", label }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button type="button" className={styles.copy} onClick={() => copy(text, label)} disabled={!text}>
      <Icon>{copied === label ? "check" : "content_copy"}</Icon>
      {copied === label ? "Copied" : "Copy"}
    </button>
  );
}

CopyButton.propTypes = {
  text: PropTypes.string,
  label: PropTypes.string.isRequired,
};

export default function PlaygroundJsonView({ turns, activeKey = "a", onSelectKey }) {
  const [tab, setTab] = useState("request");
  const active = turns.find((entry) => entry.key === activeKey) || turns[0] || null;
  const turn = active?.turn || null;
  const request = turn?.request || null;
  const response = turn?.response || null;
  const body = request ? JSON.stringify(request.body, null, 2) : "";
  const headers = request ? maskRequestHeaders(request.headers) : {};
  const curl = request ? buildCurl(request) : "";

  return (
    <section className={styles.panel} aria-label="JSON API inspector">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.method}>POST</span>
          <code className={styles.path}>/api/v1/chat/completions</code>
        </div>
        <div className={styles.controls}>
          {turns.length > 1 ? (
            <SegmentedControl
              size="sm"
              aria-label="Lane"
              value={active?.key}
              onChange={onSelectKey}
              options={turns.map((entry) => ({ value: entry.key, label: entry.label }))}
            />
          ) : null}
          <SegmentedControl size="sm" aria-label="Inspector tab" value={tab} onChange={setTab} options={TABS} />
        </div>
      </header>

      {!turn ? (
        <p className={styles.empty}>Send a request to inspect it.</p>
      ) : (
        <div className={styles.body}>
          {tab === "request" ? (
            <>
              <div className={styles.blockHead}>
                <span>Headers</span>
                <CopyButton text={JSON.stringify(headers, null, 2)} label="headers" />
              </div>
              <pre className={styles.code}>{JSON.stringify(headers, null, 2)}</pre>
              <div className={styles.blockHead}>
                <span>Body</span>
                <CopyButton text={body} label="body" />
              </div>
              <pre className={styles.code}>{body}</pre>
            </>
          ) : null}

          {tab === "response" ? (
            <>
              <div className={styles.facts}>
                <span>{response?.status ? `status ${response.status}` : "status —"}</span>
                <span>{response?.contentType || "unknown content-type"}</span>
                <span>{response?.frames ? `${response.frames} frames` : "buffered JSON"}</span>
                <span>{response?.durationMs ? `${response.durationMs}ms` : "—"}</span>
                {response?.truncated ? <span className={styles.warn}>truncated at 256 KB</span> : null}
              </div>
              <pre className={styles.code}>{response?.rawText || "Empty body."}</pre>
            </>
          ) : null}

          {tab === "curl" ? (
            <>
              <div className={styles.blockHead}>
                <span>Reproduce with the gateway key in your environment</span>
                <CopyButton text={curl} label="curl" />
              </div>
              <pre className={styles.code}>{curl}</pre>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

PlaygroundJsonView.propTypes = {
  turns: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      turn: PropTypes.object,
    }),
  ).isRequired,
  activeKey: PropTypes.string,
  onSelectKey: PropTypes.func.isRequired,
};

