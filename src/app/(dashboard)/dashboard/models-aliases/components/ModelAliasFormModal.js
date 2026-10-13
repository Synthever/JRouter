"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import ModelAliasMembers from "./ModelAliasMembers";
import { createAliasDraft, orderedDraftMembers, validateAliasDraft } from "./modelAliasForm";
import styles from "../models-aliases.module.css";

export default function ModelAliasFormModal({ alias, providerMetadata = {}, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => createAliasDraft(alias));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [inputs, setInputs] = useState({ activeProviders: [], modelAliases: {}, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  const alive = useRef(true); const request = useRef(null); const busy = useRef(false); const uploadSequence = useRef(0); const fileInput = useRef(null);
  const validation = validateAliasDraft(draft);
  const change = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setInputs(previous => ({ ...previous, loading: true, error: "" }));
      try {
        const [providers, aliases] = await Promise.all(["/api/providers", "/api/models/alias"].map(async url => {
          const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error(); return response.json();
        }));
        if (!Array.isArray(providers.connections) || !aliases.aliases || typeof aliases.aliases !== "object" || Array.isArray(aliases.aliases)) throw new Error();
        if (!controller.signal.aborted) setInputs({ activeProviders: providers.connections.filter(provider => provider.isActive !== false), modelAliases: aliases.aliases, loading: false, error: "" });
      } catch { if (!controller.signal.aborted) setInputs(previous => ({ ...previous, loading: false, error: "Unable to load configured providers. Retry the member catalog." })); }
    });
    return () => controller.abort();
  }, [revision]);
  const save = async event => {
    event.preventDefault(); if (!validation.valid || busy.current) return;
    busy.current = true; setSaving(true); setError(""); const controller = new AbortController(); request.current = controller;
    let feedback = "Unable to save Models Alias. Your draft is preserved. Retry saving.";
    try {
      const response = await fetch(alias ? `/api/models-aliases/${encodeURIComponent(alias.id)}` : "/api/models-aliases", {
        method: alias ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validation.config), signal: controller.signal,
      });
      if (!response.ok) {
        feedback = response.status === 409 ? "An alias or Combo already uses this name. Choose another name."
          : response.status === 401 ? "Session expired. Sign in again before saving."
          : response.status === 400 ? "Configuration or members are unavailable. Review the fields and retry." : "Unable to save Models Alias. Your draft is preserved. Retry saving.";
        throw new Error();
      }
      const saved = await response.json();
      feedback = "Server returned an invalid saved configuration. Refresh before retrying.";
      if (typeof saved?.id !== "string" || !validateAliasDraft(createAliasDraft(saved)).valid) throw new Error();
      if (alive.current && !controller.signal.aborted) onSaved(saved);
    } catch { if (alive.current && !controller.signal.aborted) setError(feedback); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const upload = async event => {
    const target = event.target; const file = target.files?.[0]; target.value = ""; if (!file) return;
    const sequence = ++uploadSequence.current; setUploadError("");
    try { const text = (await file.text()).replace(/^\uFEFF/, ""); if (alive.current && sequence === uploadSequence.current) change("systemPrompt", text || null); }
    catch { if (alive.current && sequence === uploadSequence.current) setUploadError("Unable to read this file. Previous prompt is preserved. Retry Upload .txt."); }
  };
  const order = orderedDraftMembers(draft);
  const options = order.map(id => ({ value: id, label: id }));
  const invalidPrimary = draft.primaryModel && !order.includes(draft.primaryModel);
  const invalidJudge = draft.judgeModel !== null && !order.includes(draft.judgeModel);
  return <Modal isOpen onClose={onClose} trapFocus showTrafficLights={false} size="full" title={alias ? "Edit Models Alias" : "Create Models Alias"} className={styles.dialog}>
    <form className={styles.form} onSubmit={save} noValidate>
      <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      <fieldset className={styles.fields} disabled={saving}>
        <Input id="alias-name" label="Name" value={draft.name} onChange={event => change("name", event.target.value)} error={validation.errors.name} />
        <div className={styles.help}>Public ID <code className={styles.publicId} data-i18n-skip>{`jrouter/${draft.name}`}</code></div>
        <ModelAliasMembers draft={draft} onChange={setDraft} providerMetadata={providerMetadata} activeProviders={inputs.activeProviders} modelAliases={inputs.modelAliases}
          disabled={saving || inputs.loading} catalogError={inputs.error} onRetry={() => setRevision(value => value + 1)} />
        {validation.errors.models ? <p role="alert" className={styles.error}>{validation.errors.models}</p> : null}
        <Select id="alias-primary" label="Primary member" value={draft.primaryModel} onChange={event => change("primaryModel", event.target.value)}
          options={invalidPrimary ? [{ value: draft.primaryModel, label: `${draft.primaryModel} (removed, choose replacement)` }, ...options] : options} error={validation.errors.primaryModel} />
        <div className={styles.columns}>
          <Select id="alias-strategy" label="Strategy" value={draft.strategy} onChange={event => change("strategy", event.target.value)} options={["fallback", "round-robin", "fusion"].map(value => ({ value, label: value }))} />
          <Input id="alias-deadline" label="Initial-response deadline (seconds)" type="number" min="0.001" max="2147483.647" step="any" value={draft.initialResponseTimeoutSeconds}
            onChange={event => change("initialResponseTimeoutSeconds", event.target.value)} error={validation.errors.initialResponseTimeoutSeconds} />
        </div>
        {draft.strategy === "fusion" || invalidJudge ? <Select id="alias-judge" label="Fusion judge" value={draft.judgeModel ?? "__primary__"} onChange={event => change("judgeModel", event.target.value === "__primary__" ? null : event.target.value)}
          options={[{ value: "__primary__", label: "Use primary (default)" }, ...(invalidJudge ? [{ value: draft.judgeModel, label: `${draft.judgeModel} (removed, choose replacement)` }] : []), ...options]} error={validation.errors.judgeModel} /> : null}
        <section className={styles.group} aria-label="Prompt injection">
          <h3>Prompt injection</h3>
          <label className={styles.check}><input id="alias-enabled" type="checkbox" checked={draft.promptInjectionEnabled} onChange={event => change("promptInjectionEnabled", event.target.checked)} />Enable prompt injection</label>
          <Select id="alias-mode" label="Prompt mode" value={draft.promptInjectionMode} onChange={event => change("promptInjectionMode", event.target.value)} options={["prepend", "append", "replace"].map(value => ({ value, label: value }))} />
          <div className={styles.toolbar}><label htmlFor="alias-prompt">System / Persona Prompt</label><Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>Upload .txt</Button></div>
          <input ref={fileInput} type="file" accept=".txt,text/plain" hidden onChange={upload} />
          <textarea id="alias-prompt" rows={7} value={draft.systemPrompt ?? ""} onChange={event => { uploadSequence.current++; change("systemPrompt", event.target.value || null); }} />
          <p className={styles.help}>{(draft.systemPrompt ?? "").length} characters. File contents stay in the browser until Save.</p>
          {uploadError ? <p className={styles.error} role="alert">{uploadError}</p> : null}
          <Input id="alias-display" label="Display identity (optional)" value={draft.displayIdentity ?? ""} onChange={event => change("displayIdentity", event.target.value || null)} />
        </section>
      </fieldset>
      {validation.errors.configuration ? <p role="alert" className={styles.error}>{validation.errors.configuration}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="contrast" disabled={!validation.valid} loading={saving}>{saving ? "Saving..." : "Save"}</Button></div>
    </form>
  </Modal>;
}
