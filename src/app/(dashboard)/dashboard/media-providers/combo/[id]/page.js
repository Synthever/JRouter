"use client";
import Icon from "@/shared/components/Icon";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Toggle, ModelSelectModal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import styles from "../../media-providers.module.css";

// Parse "providerId/model" or just "providerId" → { providerId, model }
function parseModelEntry(entry) {
  if (typeof entry !== "string") return { providerId: "", model: "" };
  const idx = entry.indexOf("/");
  if (idx < 0) return { providerId: entry, model: "" };
  return { providerId: entry.slice(0, idx), model: entry.slice(idx + 1) };
}

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

const KIND_LABELS = {
  webSearch: "Web Search",
  webFetch: "Web Fetch",
  image: "Text to Image",
  tts: "Text To Speech",
};

const EXAMPLE_PATHS = {
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
};

const EXAMPLE_BODIES = {
  webSearch: (n) => ({ model: n, query: "What is the latest news about AI?", search_type: "web", max_results: 5 }),
  webFetch: (n) => ({ model: n, url: "https://example.com", format: "markdown" }),
  image: (n) => ({ model: n, prompt: "A cute cat playing piano", n: 1, size: "1024x1024" }),
  tts: (n) => ({ model: n, input: "Hello, this is a test.", voice: "alloy" }),
};

// Map combo.kind → listing route to go back to
function getListingHref(kind) {
  if (kind === "webSearch" || kind === "webFetch") return "/dashboard/media-providers/web";
  return `/dashboard/media-providers/${kind}`;
}

export default function ComboDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [combo, setCombo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [providers, setProviders] = useState([]);
  const [roundRobin, setRoundRobin] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [logs, setLogs] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connections, setConnections] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  const fetchAll = async () => {
    try {
      const [comboRes, settingsRes, logsRes, keysRes, connsRes, aliasesRes] = await Promise.all([
        fetch(`/api/combos/${id}`, { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/usage/logs", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/models/alias", { cache: "no-store" }),
      ]);
      if (aliasesRes.ok) setModelAliases((await aliasesRes.json()).aliases || {});
      if (keysRes.ok) {
        const k = await keysRes.json();
        setApiKey((k.keys || []).find((x) => x.isActive !== false)?.key || "");
      }
      if (connsRes.ok) setConnections(((await connsRes.json()).connections || []).filter((x) => x.isActive !== false));
      if (!comboRes.ok) { setCombo(null); setLoading(false); return; }
      const c = await comboRes.json();
      setCombo(c);
      setName(c.name);
      setProviders(c.models || []);
      const s = settingsRes.ok ? await settingsRes.json() : {};
      setRoundRobin(s.comboStrategies?.[c.name]?.fallbackStrategy === "round-robin");
      const allLogs = logsRes.ok ? await logsRes.json() : [];
      setLogs(allLogs.filter((l) => typeof l === "string" && l.includes(c.name)).slice(0, 50));
    } catch { /* noop */ }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateName = (v) => {
    if (!v.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(v)) { setNameError("Only letters, numbers, -, _ and ."); return false; }
    setNameError("");
    return true;
  };

  const saveCombo = async (patch) => {
    const res = await fetch(`/api/combos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to save"); return false; }
    return true;
  };

  const handleSaveName = async () => {
    if (!validateName(name)) return;
    if (name === combo.name) return;
    const ok = await saveCombo({ name });
    if (ok) await fetchAll();
  };

  const handleAddModel = async (model) => {
    const value = model?.value || model;
    if (!value || providers.includes(value)) return;
    const next = [...providers, value];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleDeselectModel = async (model) => {
    const value = model?.value || model;
    if (!value || !providers.includes(value)) return;
    const next = providers.filter((p) => p !== value);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleRemoveProvider = async (idx) => {
    const next = providers.filter((_, i) => i !== idx);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleMove = async (idx, dir) => {
    const next = [...providers];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleToggleRoundRobin = async (enabled) => {
    setRoundRobin(enabled);
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const s = settingsRes.ok ? await settingsRes.json() : {};
    const updated = { ...(s.comboStrategies || {}) };
    if (enabled) updated[combo.name] = { fallbackStrategy: "round-robin" };
    else delete updated[combo.name];
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated }),
    });
  };

  const handleDelete = async () => {
    if (!confirm(`Delete combo "${combo.name}"?`)) return;
    const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
    if (res.ok) router.push(getListingHref(combo.kind));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    if (testResult?.audioUrl) { try { URL.revokeObjectURL(testResult.audioUrl); } catch {} }
    if (testResult?.imageUrl?.startsWith("blob:")) { try { URL.revokeObjectURL(testResult.imageUrl); } catch {} }
    const start = Date.now();
    try {
      const path = EXAMPLE_PATHS[combo.kind];
      const body = EXAMPLE_BODIES[combo.kind](combo.name);
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setTestError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        setTestResult({ json: JSON.stringify(d, null, 2), latencyMs });
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      // Binary image
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        setTestResult({ imageUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // Binary audio
      if (ctype.startsWith("audio/") || ctype === "application/octet-stream") {
        const blob = await res.blob();
        setTestResult({ audioUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // JSON — could be image (data[0].b64_json/url) or generic
      const data = await res.json();
      const first = data?.data?.[0];
      const imageUrl = first?.b64_json
        ? `data:image/png;base64,${first.b64_json}`
        : (first?.url || "");
      setTestResult({ json: JSON.stringify(maskB64(data), null, 2), imageUrl, latencyMs });
    } catch (e) {
      setTestError(e.message || "Network error");
    }
    setTesting(false);
  };

  // Mask large b64_json strings to keep JSON view readable
  function maskB64(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = (k === "b64_json" && typeof v === "string" && v.length > 100)
        ? `<${v.length} chars base64>`
        : maskB64(v);
    }
    return out;
  }

  if (loading) {
    return (
      <div className={`dashboard-surface ${styles.page}`}>
        <section className={styles.panel}>
          <div className={styles.loading} />
        </section>
      </div>
    );
  }
  if (!combo) return notFound();

  const kindLabel = KIND_LABELS[combo.kind] || MEDIA_PROVIDER_KINDS.find((k) => k.id === combo.kind)?.label || "Combo";
  const examplePath = EXAMPLE_PATHS[combo.kind];
  const exampleBody = combo.kind && EXAMPLE_BODIES[combo.kind] ? EXAMPLE_BODIES[combo.kind](combo.name) : null;
  const curlExample = examplePath
    ? `curl -X POST http://localhost:20128${examplePath} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\\n  -d '${JSON.stringify(exampleBody)}'`
    : "";
  const backHref = getListingHref(combo.kind);

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <div>
        <Link href={backHref} className={styles.backLink}>
          <Icon className="text-[16px]">arrow_back</Icon>
          {kindLabel}
        </Link>
      </div>

      <header className={styles.detailHead}>
        <span className={styles.detailLogo} style={{ backgroundColor: "var(--surface-2)" }}>
          <Icon className="text-[24px]" style={{ color: "var(--text-2)" }}>layers</Icon>
        </span>

        <div className={styles.detailIdentity}>
          <div className={styles.detailNameRow}>
            <h1 className={styles.detailTitle}>{combo.name}</h1>
          </div>
          <div className={styles.detailBadges}>
            <span className={`${styles.badge} ${styles.badgeCurrent}`}>{combo.kind ? kindLabel : "Combo"}</span>
            {combo.kind && <span className={styles.badge}>{combo.kind}</span>}
            <span className={styles.badge}>{providers.length} providers</span>
            {roundRobin && <span className={`${styles.badge} ${styles.badgeOn}`}>Round robin</span>}
          </div>
          <p className={styles.detailSub}>
            {examplePath ? `POST ${examplePath}` : "Text combo — not routed by a media kind"}
          </p>
        </div>

        <div className={styles.detailActions}>
          <Button size="sm" variant="danger" icon="delete" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </header>

      <section className={styles.panel} aria-labelledby="combo-settings-heading">
        <div className={styles.panelHead}>
          <div className="min-w-0">
            <h2 id="combo-settings-heading" className={styles.panelTitle}>
              <Icon className={styles.panelIcon}>settings</Icon> Settings
            </h2>
            <p className={styles.panelDesc}>The combo name is the model id clients send; changing it breaks saved callers.</p>
          </div>
        </div>

        <div className={styles.rowList}>
          <div className={styles.settingsRow}>
            <div className={styles.settingsBody}>
              <p className={styles.settingsTitle}>Combo Name</p>
              <p className={styles.settingsDesc}>Only letters, numbers, -, _ and .</p>
              {nameError && <p className={styles.fieldErrorText}>{nameError}</p>}
            </div>
            <div className={styles.fieldControl} style={{ flex: "0 1 320px" }}>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); validateName(e.target.value); }}
                onBlur={handleSaveName}
                aria-label="Combo name"
                aria-invalid={!!nameError}
                className={`${styles.input} ${styles.inputMono} ${nameError ? styles.inputError : ""}`}
              />
            </div>
          </div>

          <div className={styles.settingsRow}>
            <div className={styles.settingsBody}>
              <p className={styles.settingsTitle}>Round Robin</p>
              <p className={styles.settingsDesc}>Rotate providers across requests instead of strict fallback order.</p>
            </div>
            <Toggle checked={roundRobin} onChange={handleToggleRoundRobin} aria-label="Round robin" />
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="combo-providers-heading">
        <div className={styles.panelHead}>
          <div className="min-w-0">
            <h2 id="combo-providers-heading" className={styles.panelTitle}>
              <Icon className={styles.panelIcon}>layers</Icon> Providers
              <small>{providers.length}</small>
            </h2>
            <p className={styles.panelDesc}>Tried in order (top-down) or rotated when round-robin is on.</p>
          </div>
          <div className={styles.panelActions}>
            <Button size="sm" variant="outline" icon="add" onClick={() => setShowPicker(true)}>
              Add Provider
            </Button>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className={styles.empty}>
            <p>No providers yet.</p>
            <div className={styles.emptyActions}>
              <Button size="sm" variant="outline" icon="add" onClick={() => setShowPicker(true)}>
                Add Provider
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.rowList}>
            {providers.map((entry, idx) => {
              const { providerId, model } = parseModelEntry(entry);
              const p = AI_PROVIDERS[providerId];
              return (
                <div key={`${entry}-${idx}`} className={styles.rowItem}>
                  <div className={styles.rowMain}>
                    <div className={styles.reorder}>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, -1)}
                        disabled={idx === 0}
                        className={styles.iconBtn}
                        title="Move up"
                        aria-label={`Move ${providerId} up`}
                      >
                        <Icon className="text-[16px]">keyboard_arrow_up</Icon>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === providers.length - 1}
                        className={styles.iconBtn}
                        title="Move down"
                        aria-label={`Move ${providerId} down`}
                      >
                        <Icon className="text-[16px]">keyboard_arrow_down</Icon>
                      </button>
                    </div>

                    <span className={styles.indexNum}>{idx + 1}</span>

                    <span className={styles.logoTile}>
                      <ProviderIcon
                        src={`/providers/${providerId}.png`}
                        alt={p?.name || providerId}
                        size={22}
                        className="object-contain"
                        fallbackText={p?.textIcon || providerId.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </span>

                    <div className={styles.rowBody}>
                      <p className={styles.rowTitle}>{p?.name || providerId}</p>
                      <div className={styles.rowMeta}>
                        <code className={styles.metaMono}>{model || providerId}</code>
                        {!p && <span className={styles.metaText}>unknown provider</span>}
                      </div>
                    </div>
                  </div>

                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      onClick={() => handleRemoveProvider(idx)}
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      title="Remove"
                      aria-label={`Remove ${model || providerId}`}
                    >
                      <Icon className="text-[16px]">close</Icon>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {combo.kind && examplePath && (
        <section className={styles.panel} aria-labelledby="combo-test-heading">
          <div className={styles.panelHead}>
            <div className="min-w-0">
              <h2 id="combo-test-heading" className={styles.panelTitle}>
                <Icon className={styles.panelIcon}>terminal</Icon> Test
              </h2>
              <p className={styles.panelDesc}>One request through the combo — press Run to see which provider answers.</p>
            </div>
            <div className={styles.panelActions}>
              <Button
                size="sm"
                icon="play_arrow"
                onClick={handleTest}
                disabled={testing || providers.length === 0}
              >
                {testing ? "Running…" : "Run"}
              </Button>
            </div>
          </div>

          <div className={styles.examplePanes}>
            <div>
              <div className={styles.codeHead}>
                <span className={styles.codeTitle}>Request</span>
                {testResult?.latencyMs != null && (
                  <span className={styles.codeMeta}>⚡ {testResult.latencyMs}ms</span>
                )}
              </div>
              <pre className={styles.codeBlock}>{curlExample}</pre>
            </div>

            <div>
              <div className={styles.codeHead}>
                <span className={styles.codeTitle}>Response</span>
                {testResult?.imageUrl && (
                  <a href={testResult.imageUrl} download="image.png" className={styles.copyBtn}>
                    <Icon className="text-[14px]">download</Icon>
                    Download
                  </a>
                )}
                {testResult?.audioUrl && (
                  <a href={testResult.audioUrl} download="speech.mp3" className={styles.copyBtn}>
                    <Icon className="text-[14px]">download</Icon>
                    Download
                  </a>
                )}
              </div>

              {!testResult && !testError && (
                <pre className={`${styles.codeBlock} ${styles.codeBlockMuted}`}>
                  {"// No request sent yet — press Run."}
                </pre>
              )}

              {testError && <p className={styles.noticeError}>{testError}</p>}

              {testResult?.imageUrl && (
                <div className={styles.mediaPreview}>
                  <img
                    src={testResult.imageUrl}
                    alt="Generated"
                    className={styles.mediaPrevImg}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              )}

              {testResult?.audioUrl && (
                <div className={styles.mediaPreview}>
                  <audio controls src={testResult.audioUrl} className={styles.mediaPrevAudio} />
                </div>
              )}

              {testResult?.json && <pre className={styles.codeBlock}>{testResult.json}</pre>}
            </div>
          </div>
        </section>
      )}

      <section className={styles.panel} aria-labelledby="combo-logs-heading">
        <div className={styles.panelHead}>
          <div className="min-w-0">
            <h2 id="combo-logs-heading" className={styles.panelTitle}>
              <Icon className={styles.panelIcon}>history</Icon> Usage
              <small>{logs.length}</small>
            </h2>
            <p className={styles.panelDesc}>Recent gateway log lines that mention this combo name.</p>
          </div>
        </div>

        {logs.length === 0 ? (
          <p className={styles.emptyText}>No usage yet.</p>
        ) : (
          <pre className={styles.codeBlock} style={{ maxHeight: 400 }}>{logs.join("\n")}</pre>
        )}
      </section>

      {showPicker && (
        <ModelSelectModal
          isOpen={showPicker}
          onClose={() => setShowPicker(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={connections}
          modelAliases={modelAliases}
          title={`Add ${kindLabel} Model`}
          kindFilter={combo.kind}
          addedModelValues={providers}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}
