"use client";

import { useState } from "react";
import Icon from "@/shared/components/Icon";
import ModelPickerList from "@/shared/components/ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { API_KEY_ENDPOINTS, QUOTA_CYCLES } from "@/shared/constants/apiKeyPolicy.js";
import styles from "../endpoint.module.css";

// Section order and labels drive both the jump nav and the rendered sections, so
// the two can never drift apart.
export const CONFIGURE_SECTIONS = [
  { id: "general", label: "General" },
  { id: "quota", label: "Quota" },
  { id: "requests", label: "Requests" },
  { id: "limits", label: "Limits" },
  { id: "role", label: "Role" },
  { id: "models", label: "Models" },
  { id: "endpoints", label: "Endpoints" },
];

export function SettingsSection({ id, title, hint, children }) {
  return (
    <section id={id} className={styles.dialogSection}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {hint && <p className={styles.sectionHint}>{hint}</p>}
      {children}
    </section>
  );
}

function Field({ id, label, hint, required, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        {required && <i className={styles.fieldRequired}>*</i>}
      </label>
      {children(hintId)}
      {hint && <p id={hintId} className={styles.fieldHint}>{hint}</p>}
    </div>
  );
}

function TextField({ id, label, hint, required, type = "text", value, onChange, ...props }) {
  return (
    <Field id={id} label={label} hint={hint} required={required}>
      {(hintId) => (
        <input
          id={id}
          type={type}
          className={styles.fieldInput}
          value={value}
          onChange={onChange}
          aria-describedby={hintId}
          {...props}
        />
      )}
    </Field>
  );
}

export function GeneralSection({ form, onChange, keyInfo }) {
  return (
    <SettingsSection id="general" title="General information">
      <TextField id="key-name" label="Key name" required value={form.name} onChange={(event) => onChange("name", event.target.value)} maxLength={120} autoComplete="off" />
      <TextField id="key-description" label="Description" value={form.description} onChange={(event) => onChange("description", event.target.value)} placeholder="Internal description (optional)" maxLength={500} autoComplete="off" />
      <p className={styles.usageLine}>{keyInfo?.keyPrefix} · Used {Number(keyInfo?.quotaTokens || 0).toLocaleString()} accounted tokens / ${Number(keyInfo?.quotaCost || 0).toFixed(4)} this period</p>
    </SettingsSection>
  );
}

const KEY_ROLE_OPTIONS = [
  { value: "owner", label: "Owner", hint: "Everything: combos, provider models and custom model-ids." },
  { value: "user", label: "User", hint: "Only published Custom Model-IDs. Provider models and private combos are refused." },
];

export function KeyRoleSection({ value, onChange }) {
  return (
    <SettingsSection id="role" title="Key role" hint="Owner keys keep full access. User keys can call published Custom Model-IDs only.">
      <div className={styles.choiceGrid} role="radiogroup" aria-label="Key role">
        {KEY_ROLE_OPTIONS.map((option) => (
          <label key={option.value} className={styles.optionCard}>
            <input
              type="radio"
              name="key-role"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <span className={styles.optionTitle}>{option.label}</span>
              <span className={styles.optionHint}>{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </SettingsSection>
  );
}

export function QuotaSettings({ form, onChange }) {
  return (
    <SettingsSection id="quota" title="Quota & limits" hint="Counters reset at UTC calendar boundaries. Lifetime usage never resets automatically.">
      <div className={styles.fieldGrid}>
        <TextField id="key-max-tokens" label="Max tokens quota" value={form.maxTokensQuota} onChange={(event) => onChange("maxTokensQuota", event.target.value)} inputMode="numeric" placeholder="Unlimited" hint="Leave empty for unlimited tokens." autoComplete="off" />
        <TextField id="key-max-cost" label="Max cost (USD)" value={form.maxCostUsd} onChange={(event) => onChange("maxCostUsd", event.target.value)} inputMode="decimal" placeholder="Unlimited" hint="Leave empty for unlimited cost. Cost quotas require model pricing." autoComplete="off" />
      </div>
      <Field id="key-quota-cycle" label="Quota reset cycle">
        {() => (
          <select id="key-quota-cycle" className={styles.fieldSelect} value={form.quotaResetCycle} onChange={(event) => onChange("quotaResetCycle", event.target.value)}>
            {QUOTA_CYCLES.map((cycle) => <option key={cycle} value={cycle}>{cycle === "lifetime" ? "No reset / Lifetime" : cycle[0].toUpperCase() + cycle.slice(1)}</option>)}
          </select>
        )}
      </Field>
    </SettingsSection>
  );
}

export function RequestSettings({ form, onChange }) {
  return (
    <SettingsSection id="requests" title="Request & multiplier controls">
      <div className={styles.fieldGrid}>
        <TextField id="key-token-multiplier" label="Token / billing multiplier" required value={form.tokenMultiplier} onChange={(event) => onChange("tokenMultiplier", event.target.value)} inputMode="decimal" placeholder="1" hint="1.5 records 1.5x token and cost usage. Provider token counts stay unchanged." autoComplete="off" />
        <TextField id="key-max-output" label="Max output tokens / request" value={form.maxOutputTokens} onChange={(event) => onChange("maxOutputTokens", event.target.value)} inputMode="numeric" placeholder="e.g. 4096" hint="Caps output tokens. Requests above this maximum are rejected." autoComplete="off" />
      </div>
    </SettingsSection>
  );
}

export function RateLimitSettings({ form, onChange }) {
  return (
    <SettingsSection id="limits" title="Rate limiting & expiration">
      <div className={styles.fieldGrid}>
        <TextField id="key-rpm" label="Rate limit (RPM)" value={form.rateLimitRpm} onChange={(event) => onChange("rateLimitRpm", event.target.value)} inputMode="numeric" placeholder="Unlimited" hint="Maximum requests per rolling minute. Empty means unlimited." autoComplete="off" />
        <TextField id="key-tpm" label="Rate limit (TPM)" value={form.rateLimitTpm} onChange={(event) => onChange("rateLimitTpm", event.target.value)} inputMode="numeric" placeholder="Unlimited" hint="Maximum raw tokens per rolling minute. Empty means unlimited." autoComplete="off" />
      </div>
      <TextField id="key-expiration" label="Expiration date" type="datetime-local" value={form.expiresAt} onChange={(event) => onChange("expiresAt", event.target.value)} hint="Your local timezone. Leave empty for no expiration." />
    </SettingsSection>
  );
}

function ModelRestrictionPicker({ title, values, onChange, activeProviders, modelAliases, hint }) {
  const [open, setOpen] = useState(false);
  const { visibleGroups, filteredCombos, searchQuery, setSearchQuery } = useModelCatalog({ isOpen: open, activeProviders, modelAliases, addedModelValues: values });
  function toggle(value) { onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]); }
  return (
    <div className={styles.modelsBlock}>
      <div className={styles.modelsHead}>
        <div>
          <span className={styles.modelsTitle}>{title}</span>
          <p className={styles.fieldHint}>{hint}</p>
        </div>
        <button type="button" className={styles.pickerToggle} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon className="text-[16px]">{open ? "close" : "add"}</Icon>
          {open ? "Close picker" : "Choose models"}
        </button>
      </div>
      {values.length > 0 && <div className={styles.modelsTags}>
        {values.map((value) => (
          <button key={value} type="button" className={styles.modelTag} onClick={() => toggle(value)} aria-label={`Remove ${value} from ${title.toLowerCase()}`}>
            <span className={styles.modelTagLabel}>{value}</span>
            <span className={styles.modelTagIcon}><Icon className="text-[13px]">close</Icon></span>
          </button>
        ))}
      </div>}
      {open && <div className={styles.pickerPanel}>
        <ModelPickerList searchQuery={searchQuery} onSearchChange={setSearchQuery} combos={filteredCombos} groups={visibleGroups} addedModelValues={values} onSelect={(model) => { if (!model.isPlaceholder) toggle(model.value || model.name); }} />
      </div>}
    </div>
  );
}

export function ModelRestrictions({ form, onChange, activeProviders, modelAliases }) {
  return (
    <SettingsSection id="models" title="Model restrictions" hint="Blocked models override allowed models, including resolved aliases and combo members.">
      <ModelRestrictionPicker title="Allowed models" values={form.allowedModels} onChange={(values) => onChange("allowedModels", values)} activeProviders={activeProviders} modelAliases={modelAliases} hint="Leave empty to allow all models." />
      <ModelRestrictionPicker title="Blocked models" values={form.blockedModels} onChange={(values) => onChange("blockedModels", values)} activeProviders={activeProviders} modelAliases={modelAliases} hint="Leave empty to block no models." />
    </SettingsSection>
  );
}

export function EndpointPermissions({ values, onChange }) {
  const noneSelected = values.length === 0;
  return (
    <SettingsSection id="endpoints" title="Allowed endpoints / modalities" hint="Only endpoint families supported by JRouter are listed. Clearing every permission denies all inference requests.">
      <div className={styles.choiceGrid}>
        {API_KEY_ENDPOINTS.map(({ value, label, hint }) => (
          <label key={value} className={styles.optionCard}>
            <input type="checkbox" checked={values.includes(value)} onChange={(event) => onChange(event.target.checked ? [...values, value] : values.filter((item) => item !== value))} />
            <span>
              <span className={styles.optionTitle}>{label}</span>
              <span className={styles.optionHint}>{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className={styles.endpointWarning} role="status">{noneSelected ? "No endpoint is allowed. This key will reject every inference request." : ""}</p>
    </SettingsSection>
  );
}
