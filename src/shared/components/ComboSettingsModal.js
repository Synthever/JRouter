"use client";

import { useId, useRef, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import Select from "./Select";
import Toggle from "./Toggle";
import controls from "./DashboardControls.module.css";
import styles from "./ComboSettingsModal.module.css";
import { applyComboPromptInjection, COMBO_PROMPT_VARIABLES, normalizeComboPromptSettings } from "@/lib/comboPromptInjection";

const STRATEGIES = [
  { value: "prepend", label: "Prepend (recommended)" },
  { value: "append", label: "Append" },
  { value: "replace", label: "Replace" },
];

export default function ComboSettingsModal({ combo, onClose, onSave }) {
  const id = useId();
  const [settings, setSettings] = useState(() => normalizeComboPromptSettings(combo));
  const [samplePrompt, setSamplePrompt] = useState("You are an expert TypeScript developer.");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const patch = (field, value) => setSettings((previous) => ({ ...previous, [field]: value }));

  const handlePromptFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      // Strip a UTF-8 BOM so Windows-saved .txt files do not leak it into the prompt.
      const text = (await file.text()).replace(/^\uFEFF/, "");
      setSettings((previous) => ({ ...previous, systemPrompt: text || null }));
      setError("");
    } catch {
      setError("Failed to read the selected file. Please upload a .txt file.");
    }
  };
  const clientMessage = { role: "system", content: samplePrompt };
  const preview = applyComboPromptInjection(
    { model: combo.name, messages: samplePrompt ? [clientMessage] : [] },
    { ...combo, ...settings },
    { requestedModel: combo.name },
  ).messages;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(settings);
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Failed to save combo settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      trapFocus
      title="Combo Settings"
      size="xl"
      className={`${controls.dialog} ${styles.dialog}`}
      onClose={() => !saving && onClose()}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contrast" onClick={save} loading={saving} disabled={saving}>Save Settings</Button>
      </>}
    >
      <div className={styles.heading}>
        <code className={styles.comboName}>{combo.name}</code>
        <h3>Model Behavior</h3>
        <p>Apply reusable system instructions to requests through this combo.</p>
      </div>
      <fieldset className={styles.fields} disabled={saving}>
        <Toggle
          label="Enable Prompt Injection"
          aria-label="Enable Prompt Injection"
          checked={settings.promptInjectionEnabled}
          onChange={(value) => patch("promptInjectionEnabled", value)}
        />
        <Select
          label="Injection Strategy"
          options={STRATEGIES}
          value={settings.promptInjectionMode}
          onChange={(event) => patch("promptInjectionMode", event.target.value)}
          hint={settings.promptInjectionMode === "replace"
            ? "Client system and developer instructions will be ignored when Replace mode is enabled."
            : settings.promptInjectionMode === "append"
              ? "Preserves client instructions and adds the combo prompt after them."
              : "Adds the combo prompt before the preserved client instructions."}
        />
        <Input
          label="Public Identity"
          placeholder="Claude Sonnet"
          value={settings.displayIdentity ?? ""}
          onChange={(event) => patch("displayIdentity", event.target.value || null)}
          hint="Optional persona name. Routing and usage keep the actual model and provider."
        />
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <label htmlFor={`${id}-prompt`}>System / Persona Prompt</label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon="upload_file"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload .txt
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={handlePromptFileUpload}
            />
          </div>
          <textarea
            id={`${id}-prompt`}
            rows={8}
            value={settings.systemPrompt ?? ""}
            placeholder={"You are {{display_name}}.\n\nAlways follow the configured persona and application behavior."}
            onChange={(event) => patch("systemPrompt", event.target.value || null)}
            aria-describedby={`${id}-variables ${id}-empty`}
            spellCheck={false}
          />
          <p id={`${id}-variables`} className={styles.help}>
            {settings.systemPrompt?.length ? `${settings.systemPrompt.length.toLocaleString()} characters · ` : ""}
            Available variables: {COMBO_PROMPT_VARIABLES.map((variable, index) => <span key={variable}>{index > 0 && ", "}<code>{`{{${variable}}}`}</code></span>)}
          </p>
          <p id={`${id}-empty`} className={styles.help}>
            {settings.promptInjectionEnabled && !settings.systemPrompt?.trim()
              ? "The prompt is empty. Requests will keep their original instructions."
              : "Unknown variables stay as literal text. Public Identity defaults to the combo name."}
          </p>
        </div>
        <details className={styles.preview} open>
          <summary>Preview Final Prompt</summary>
          <div className={styles.previewBody}>
            <div className={styles.field}>
              <label htmlFor={`${id}-sample`}>Sample Client System Prompt</label>
              <textarea id={`${id}-sample`} rows={3} value={samplePrompt} onChange={(event) => setSamplePrompt(event.target.value)} />
            </div>
            <p className={styles.help}>Requested model: <code>{combo.name}</code></p>
            <div className={styles.composition} aria-live="polite" aria-label="Final prompt composition">
              {preview.length ? preview.map((message, index) => (
                <section key={index} className={styles.previewSection}>
                  <h4>{message === clientMessage ? "Client System Prompt" : "JRouter Injection"}</h4>
                  <pre>{message.content}</pre>
                </section>
              )) : <p className={styles.help}>No system instructions.</p>}
            </div>
            {!settings.promptInjectionEnabled && <p className={styles.help}>Prompt injection is disabled. Only client instructions will be sent.</p>}
          </div>
        </details>
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Modal>
  );
}
