"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect } from "react";
import { Button } from "@/shared/components";
import { getProviderAlias, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row } from "./exampleShared";
import styles from "../../../media-providers.module.css";

const DEFAULT_RESPONSE_EXAMPLE = `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.002301, -0.019212, 0.004815, -0.031249, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`;

export function EmbeddingExampleCard({ providerId, customAlias }) {
  const isCustom = isCustomEmbeddingProvider(providerId);
  const providerAlias = isCustom ? (customAlias || providerId) : getProviderAlias(providerId);
  const embeddingModels = isCustom ? [] : getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "embedding");

  const [selectedModel, setSelectedModel] = useState(embeddingModels[0]?.id ?? "");
  const [input, setInput] = useState("The quick brown fox jumps over the lazy dog");
  const [dimensions, setDimensions] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => { setApiKey((d.keys || []).find((k) => k.isActive !== false)?.key || ""); })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});
  }, []);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  // Build request body — include dimensions only if user provided a positive number
  const buildBody = () => {
    const body = { model: modelFull, input: input.trim() };
    const dim = Number(dimensions);
    if (dimensions && Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    return body;
  };

  const curlSnippet = `curl -X POST ${endpoint}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(buildBody())}'`;

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/embeddings", {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody()),
      });
      const latencyMs = Date.now() - start;
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message || data?.error || `HTTP ${res.status}`); return; }
      setResult({ data, latencyMs });
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Compact embedding array: first 4 values + count
  const formatResultJson = (data) => {
    if (!data) return DEFAULT_RESPONSE_EXAMPLE;
    const clone = JSON.parse(JSON.stringify(data));
    (clone.data || []).forEach((item) => {
      if (Array.isArray(item.embedding) && item.embedding.length > 4) {
        item.embedding = [...item.embedding.slice(0, 4).map((v) => parseFloat(v.toFixed(6))), `... (${item.embedding.length} dims)`];
      }
    });
    return JSON.stringify(clone, null, 2);
  };

  const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

  return (
    <section className={styles.panel} aria-labelledby="media-example-heading">
      <div className={styles.panelHead}>
        <div className="min-w-0">
          <h2 id="media-example-heading" className={styles.panelTitle}>
            <Icon className={styles.panelIcon}>terminal</Icon> Example
          </h2>
          <p className={styles.panelDesc}>
            POST this body to <code className={styles.metaMono}>/v1/embeddings</code> — or press Run to send it through the gateway.
          </p>
        </div>
        <div className={styles.panelActions}>
          <Button
            size="sm"
            icon="play_arrow"
            onClick={handleRun}
            disabled={running || !input.trim() || !modelFull}
          >
            {running ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      <div className={styles.fieldList}>
        <Row label="Model">
          {isCustom ? (
            <input
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="e.g. voyage-3, embed-english-v3.0, text-embedding-3-small"
              className={`${styles.input} ${styles.inputMono}`}
            />
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className={styles.input}
            >
              {embeddingModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          )}
        </Row>

        <Row label="Endpoint">
          <input
            value={endpoint}
            onChange={(e) => useTunnel ? setTunnelEndpoint(e.target.value) : setLocalEndpoint(e.target.value)}
            className={`${styles.input} ${styles.inputMono}`}
            placeholder="http://localhost:3000"
          />
          {tunnelEndpoint && (
            <button
              type="button"
              onClick={() => setUseTunnel((v) => !v)}
              title={useTunnel ? "Using tunnel" : "Using local"}
              className={`${styles.tunnelBtn} ${useTunnel ? styles.tunnelBtnOn : ""}`}
            >
              <Icon className="text-[14px]">wifi_tethering</Icon>
              Tunnel
            </button>
          )}
        </Row>

        <Row label="API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className={`${styles.input} ${styles.inputMono}`}
          />
        </Row>

        <Row label="Input">
          <div className={styles.inputWrap}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className={styles.input}
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className={styles.inputClear}
                aria-label="Clear input"
              >
                <Icon className="text-[14px]">close</Icon>
              </button>
            )}
          </div>
        </Row>

        <Row label="Dimensions">
          <input
            type="number"
            min="1"
            value={dimensions}
            onChange={(e) => setDimensions(e.target.value)}
            placeholder="optional, e.g. 512, 1024 (leave empty for default)"
            className={styles.input}
          />
        </Row>
      </div>

      <div className={styles.examplePanes}>
        <div>
          <div className={styles.codeHead}>
            <span className={styles.codeTitle}>Request</span>
            <button type="button" onClick={() => copyCurl(curlSnippet)} className={styles.copyBtn}>
              <Icon className="text-[14px]">{copiedCurl ? "check" : "content_copy"}</Icon>
              {copiedCurl ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className={styles.codeBlock}>{curlSnippet}</pre>
        </div>

        <div>
          <div className={styles.codeHead}>
            <span className={styles.codeTitle}>
              Response
              {result && <span className={styles.codeMeta}> ⚡ {result.latencyMs}ms</span>}
            </span>
            {result && (
              <button type="button" onClick={() => copyRes(resultJson)} className={styles.copyBtn}>
                <Icon className="text-[14px]">{copiedRes ? "check" : "content_copy"}</Icon>
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className={`${styles.codeBlock} ${result ? "" : styles.codeBlockMuted}`}>
            {formatResultJson(result?.data)}
          </pre>
          {error && <p className={styles.noticeError}>{error}</p>}
        </div>
      </div>
    </section>
  );
}
