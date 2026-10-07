"use client";
import { useState } from "react";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Toggle from "@/shared/components/Toggle";
import { readJson } from "./format";
import styles from "../health.module.css";

const intervals = [[60, "1 minute"], [300, "5 minutes"], [600, "10 minutes"], [900, "15 minutes"], [1800, "30 minutes"], [3600, "1 hour"]];
export default function HealthSettings({ model, onSaved }) {
  const [config, setConfig] = useState(model.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const update = (key, value) => { setConfig((previous) => ({ ...previous, [key]: value })); setMessage(""); };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const data = await readJson(await fetch(`/api/model-health/config?${new URLSearchParams({ modelId: model.id })}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }));
      setConfig(data.config); setMessage("Health settings saved"); onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return <section className={styles.settings}><h3 className={styles.sectionTitle}>Health Check Settings</h3><p className={styles.muted}>Scheduled probes use a small inference request and may consume provider quota. Manual tests work while scheduling is disabled.</p>
    <form onSubmit={save} className={styles.form}>
      <Toggle label="Enable Health Check" checked={config.enabled} onChange={(value) => update("enabled", value)} disabled={saving} aria-label="Enable Health Check" size="sm" />
      <div className={styles.fieldGrid}><label className={styles.field}>Check Interval<select value={config.intervalSeconds} onChange={(event) => update("intervalSeconds", Number(event.target.value))} disabled={saving}>{intervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <Input label="Timeout (seconds)" type="number" min="1" max="60" step="1" required value={config.timeoutSeconds} onChange={(event) => update("timeoutSeconds", Number(event.target.value))} disabled={saving} />
        <Input label="Failure Threshold" type="number" min="1" max="20" step="1" required value={config.failureThreshold} onChange={(event) => update("failureThreshold", Number(event.target.value))} disabled={saving} />
        <Input label="Recovery Threshold" type="number" min="1" max="20" step="1" required value={config.recoveryThreshold} onChange={(event) => update("recoveryThreshold", Number(event.target.value))} disabled={saving} />
      </div>
      <Toggle label="Include in Routing Health" checked={config.includeInRouting} onChange={(value) => update("includeInRouting", value)} disabled={saving} aria-label="Include in Routing Health" size="sm" />
      <p className={styles.muted}>Exposes this model’s status to routing health consumers. Current routing weights are unchanged.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.healthy}>{message}</p>}
      <div><Button type="submit" variant="contrast" loading={saving}>{saving ? "Saving..." : "Save Settings"}</Button></div>
    </form>
  </section>;
}
