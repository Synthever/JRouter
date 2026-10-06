"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { DEFAULT_KEY_POLICY, API_KEY_ENDPOINTS } from "@/shared/constants/apiKeyPolicy.js";
import { SettingsSection, QuotaSettings, RequestSettings, RateLimitSettings, ModelRestrictions, EndpointPermissions } from "./ApiKeySettingsSections";

const numericFields = ["maxTokensQuota", "maxCostUsd", "tokenMultiplier", "maxOutputTokens", "rateLimitRpm", "rateLimitTpm"];
function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toForm(key) {
  const form = { ...DEFAULT_KEY_POLICY, ...key, name: key.name || "", expiresAt: localDateTime(key.expiresAt), allowedEndpoints: key.allowedEndpoints ?? API_KEY_ENDPOINTS.map((item) => item.value) };
  for (const field of numericFields) form[field] = String(form[field] ?? "");
  return form;
}

export default function ConfigureApiKeyDialog({ keyId, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [keyInfo, setKeyInfo] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

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
  async function save(event) {
    event.preventDefault();
    if (saving || !form) return;
    setSaving(true); setError("");
    try {
      const settings = Object.fromEntries([...Object.keys(DEFAULT_KEY_POLICY), "name"].map((field) => [field, form[field]]));
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
    <Modal isOpen onClose={close} title="Configure API Key" size="full" trapFocus closeOnOverlay={!saving} footer={<>
      <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
      <Button variant="contrast" type="submit" form="api-key-settings" loading={saving} disabled={!form || saving}>Save Settings</Button>
    </>}>
      {error && <div role="alert" className="mb-5 rounded-[var(--r1)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3 text-sm text-[var(--danger)]">{error}</div>}
      {!form ? <p className="text-sm text-[var(--text-2)]" role="status">{error ? "Close this dialog and try Configure again." : "Loading key settings…"}</p> : <form id="api-key-settings" onSubmit={save} className="space-y-6">
        <fieldset disabled={saving} className="space-y-6 min-w-0">
          <SettingsSection title="General Information">
            <Input label="Key Name" value={form.name} onChange={(event) => change("name", event.target.value)} required maxLength={120} />
            <Input label="Description" value={form.description} onChange={(event) => change("description", event.target.value)} placeholder="Internal description (optional)" maxLength={500} />
            <p className="text-xs text-[var(--text-2)] break-all">{keyInfo.keyPrefix} · Used {Number(keyInfo.quotaTokens || 0).toLocaleString()} accounted tokens / ${Number(keyInfo.quotaCost || 0).toFixed(4)} this period</p>
          </SettingsSection>
          <QuotaSettings form={form} onChange={change} />
          <RequestSettings form={form} onChange={change} />
          <RateLimitSettings form={form} onChange={change} />
          <ModelRestrictions form={form} onChange={change} activeProviders={activeProviders} modelAliases={modelAliases} />
          <EndpointPermissions values={form.allowedEndpoints} onChange={(values) => change("allowedEndpoints", values)} />
        </fieldset>
      </form>}
    </Modal>
  );
}
