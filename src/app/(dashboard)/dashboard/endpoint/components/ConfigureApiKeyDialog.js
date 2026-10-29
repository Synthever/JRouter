"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import { useNotificationStore } from "@/store/notificationStore";
import { DEFAULT_KEY_POLICY, API_KEY_ENDPOINTS } from "@/shared/constants/apiKeyPolicy.js";
import { CONFIGURE_SECTIONS, GeneralSection, QuotaSettings, RequestSettings, RateLimitSettings, ModelRestrictions, EndpointPermissions, KeyRoleSection } from "./ApiKeySettingsSections";
import styles from "../endpoint.module.css";

const numericFields = ["maxTokensQuota", "maxCostUsd", "tokenMultiplier", "maxOutputTokens", "rateLimitRpm", "rateLimitTpm"];
function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toForm(key) {
  const form = { ...DEFAULT_KEY_POLICY, ...key, name: key.name || "", role: key.role === "user" ? "user" : "owner", expiresAt: localDateTime(key.expiresAt), allowedEndpoints: key.allowedEndpoints ?? API_KEY_ENDPOINTS.map((item) => item.value) };
  for (const field of numericFields) form[field] = String(form[field] ?? "");
  return form;
}
const scrollBehavior = () => (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export default function ConfigureApiKeyDialog({ keyId, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [keyInfo, setKeyInfo] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const bodyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/keys/${keyId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load key settings.");
        if (cancelled) return;
        setKeyInfo(data.key); setForm(toForm(data.key));
        const results = await Promise.allSettled([fetch("/api/providers").then((res) => res.json()), fetch("/api/models/alias").then((res) => res.json())]);
        if (cancelled) return;
        if (results[0].status === "fulfilled") setActiveProviders((results[0].value.connections || []).filter((connection) => connection.isActive !== false));
        if (results[1].status === "fulfilled") setModelAliases(results[1].value.aliases || {});
      } catch (failure) { if (!cancelled) setError(failure.message || "Unable to load key settings."); }
    }
    load();
    return () => { cancelled = true; };
  }, [keyId]);

  const close = useCallback(() => { if (!saving) onClose(); }, [saving, onClose]);
  function change(field, value) { setForm((previous) => ({ ...previous, [field]: value })); }
  function jumpTo(id) {
    const body = bodyRef.current;
    const target = body?.querySelector(`#${id}`);
    if (!body || !target) return;
    body.scrollTo({ top: Math.max(target.offsetTop - 4, 0), behavior: scrollBehavior() });
  }
  async function save(event) {
    event.preventDefault();
    if (saving || !form) return;
    setSaving(true); setError("");
    try {
      if (!form.name.trim()) throw new Error("Key name is required.");
      if (!(Number(form.tokenMultiplier) > 0)) throw new Error("Token / billing multiplier must be greater than 0.");
      const settings = Object.fromEntries([...Object.keys(DEFAULT_KEY_POLICY), "name"].map((field) => [field, form[field]]));
      settings.role = form.role;
      for (const field of numericFields) settings[field] = form[field].trim() === "" ? null : Number(form[field]);
      settings.expiresAt = form.expiresAt ? new Date(form.expiresAt).toISOString() : null;
      // Null includes endpoint families added in future releases. Preserve that
      // unrestricted default when every currently supported family is checked.
      if (settings.allowedEndpoints.length === API_KEY_ENDPOINTS.length) settings.allowedEndpoints = null;
      const response = await fetch(`/api/keys/${keyId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save key settings.");
      useNotificationStore.getState().success("API key settings saved.");
      onSaved(data.key); onClose();
    } catch (failure) {
      const message = failure.message || "Unable to save key settings.";
      setError(message); useNotificationStore.getState().error(message);
    } finally { setSaving(false); }
  }

  return (
    <Modal bare isOpen onClose={close} title="Configure API key" trapFocus closeOnOverlay={!saving} className={styles.configureDialog}>
      <form id="api-key-settings" onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className={styles.configureHeader}>
          <h2 className={styles.configureTitle}>Configure API key</h2>
          <button type="button" onClick={close} className={styles.configureClose} aria-label="Close" disabled={saving}>
            <Icon className="text-[18px]">close</Icon>
          </button>
        </div>

        <nav className={styles.configureNav} aria-label="Sections">
          {CONFIGURE_SECTIONS.map((section) => (
            <button key={section.id} type="button" className={styles.configureTab} onClick={() => jumpTo(section.id)}>{section.label}</button>
          ))}
        </nav>

        <div className={styles.configureBody} ref={bodyRef}>
          {!form ? (
            <p className={styles.configureStatus} role="status">{error ? "This key could not be loaded. Close this dialog and try Configure again." : "Loading key settings…"}</p>
          ) : (
            <fieldset disabled={saving} className="min-w-0 border-0 p-0">
              <GeneralSection form={form} onChange={change} keyInfo={keyInfo} />
              <QuotaSettings form={form} onChange={change} />
              <RequestSettings form={form} onChange={change} />
              <RateLimitSettings form={form} onChange={change} />
              <KeyRoleSection value={form.role} onChange={(value) => change("role", value)} />
              <ModelRestrictions form={form} onChange={change} activeProviders={activeProviders} modelAliases={modelAliases} />
              <EndpointPermissions values={form.allowedEndpoints} onChange={(values) => change("allowedEndpoints", values)} />
            </fieldset>
          )}
        </div>

        <div className={styles.configureFooter}>
          <span className={styles.configureError} role="alert">{error}</span>
          <button type="button" className={styles.ghostButton} onClick={close} disabled={saving}>Cancel</button>
          <button type="submit" className={styles.primaryButton} disabled={!form || saving}>{saving ? "Saving…" : "Save settings"}</button>
        </div>
      </form>
    </Modal>
  );
}
