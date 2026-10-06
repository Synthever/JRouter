"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import ModelPickerList from "@/shared/components/ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { API_KEY_ENDPOINTS, QUOTA_CYCLES } from "@/shared/constants/apiKeyPolicy.js";

export function SettingsSection({ title, hint, children }) {
  return (
    <section className="space-y-4 border-b border-[var(--line)] pb-6 last:border-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        {hint && <p className="mt-1 text-xs text-[var(--text-2)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function NumericSetting({ field, label, form, onChange, hint, placeholder = "Unlimited", decimal = false, min = 1 }) {
  return <Input label={label} type="number" min={min} step={decimal ? "any" : "1"} value={form[field]} onChange={(event) => onChange(field, event.target.value)} placeholder={placeholder} hint={hint} hintClassName="!text-[var(--text-2)]" required={field === "tokenMultiplier"} />;
}

export function QuotaSettings({ form, onChange }) {
  return (
    <SettingsSection title="Quota & Limits" hint="Counters reset at UTC calendar boundaries. Lifetime usage never resets automatically.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <NumericSetting field="maxTokensQuota" label="Max Tokens Quota" form={form} onChange={onChange} min={0} hint="Leave empty for unlimited tokens." />
        <NumericSetting field="maxCostUsd" label="Max Cost (USD)" form={form} onChange={onChange} min={0} decimal hint="Leave empty for unlimited cost. Cost quotas require model pricing." />
      </div>
      <Select label="Quota Reset Cycle" value={form.quotaResetCycle} onChange={(event) => onChange("quotaResetCycle", event.target.value)} options={QUOTA_CYCLES.map((cycle) => ({ value: cycle, label: cycle === "lifetime" ? "No Reset / Lifetime" : cycle[0].toUpperCase() + cycle.slice(1) }))} />
    </SettingsSection>
  );
}

export function RequestSettings({ form, onChange }) {
  return (
    <SettingsSection title="Request & Multiplier Controls">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <NumericSetting field="tokenMultiplier" label="Token / Billing Multiplier" form={form} onChange={onChange} min={0.000001} decimal placeholder="1" hint="1.5 records 1.5x token and cost usage. Provider token counts stay unchanged." />
        <NumericSetting field="maxOutputTokens" label="Max Output Tokens / Request" form={form} onChange={onChange} placeholder="e.g. 4096" hint="Caps output tokens. Requests above this maximum are rejected." />
      </div>
    </SettingsSection>
  );
}

export function RateLimitSettings({ form, onChange }) {
  return (
    <SettingsSection title="Rate Limiting & Expiration">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <NumericSetting field="rateLimitRpm" label="Rate Limit (RPM)" form={form} onChange={onChange} hint="Maximum requests per rolling minute. Empty means unlimited." />
        <NumericSetting field="rateLimitTpm" label="Rate Limit (TPM)" form={form} onChange={onChange} hint="Maximum raw tokens per rolling minute. Empty means unlimited." />
      </div>
      <Input label="Expiration Date" type="datetime-local" value={form.expiresAt} onChange={(event) => onChange("expiresAt", event.target.value)} hint="Your local timezone. Leave empty for no expiration." hintClassName="!text-[var(--text-2)]" />
    </SettingsSection>
  );
}

function ModelRestrictionPicker({ title, values, onChange, activeProviders, modelAliases, hint }) {
  const [open, setOpen] = useState(false);
  const { visibleGroups, filteredCombos, searchQuery, setSearchQuery } = useModelCatalog({ isOpen: open, activeProviders, modelAliases, addedModelValues: values });
  function toggle(value) { onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]); }
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Button type="button" variant="secondary" size="sm" icon="add" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close picker" : "Choose models"}</Button>
      </div>
      <p className="text-xs text-[var(--text-2)]">{hint}</p>
      {values.length > 0 && <div className="flex flex-wrap gap-2">
        {values.map((value) => <button key={value} type="button" onClick={() => toggle(value)} aria-label={`Remove ${value} from ${title.toLowerCase()}`} className="inline-flex items-center gap-1.5 max-w-full rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] px-2 py-1 text-xs hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text)]">
          <span className="break-all">{value}</span><Icon name="close" className="text-[14px] shrink-0" />
        </button>)}
      </div>}
      {open && <div className="rounded-[var(--r2)] border border-[var(--line-2)] p-3">
        <ModelPickerList searchQuery={searchQuery} onSearchChange={setSearchQuery} combos={filteredCombos} groups={visibleGroups} addedModelValues={values} onSelect={(model) => { if (!model.isPlaceholder) toggle(model.value || model.name); }} />
      </div>}
    </div>
  );
}

export function ModelRestrictions({ form, onChange, activeProviders, modelAliases }) {
  return (
    <SettingsSection title="Model Restrictions" hint="Blocked models override allowed models, including resolved aliases and combo members.">
      <ModelRestrictionPicker title="Allowed Models" values={form.allowedModels} onChange={(values) => onChange("allowedModels", values)} activeProviders={activeProviders} modelAliases={modelAliases} hint="Leave empty to allow all models." />
      <ModelRestrictionPicker title="Blocked Models" values={form.blockedModels} onChange={(values) => onChange("blockedModels", values)} activeProviders={activeProviders} modelAliases={modelAliases} hint="Leave empty to block no models." />
    </SettingsSection>
  );
}

export function EndpointPermissions({ values, onChange }) {
  return (
    <SettingsSection title="Allowed Endpoints / Modalities" hint="Only endpoint families supported by JRouter are listed. Clearing every permission denies all inference requests.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {API_KEY_ENDPOINTS.map(({ value, label, hint }) => <label key={value} className={`flex items-start gap-3 cursor-pointer rounded-[var(--r2)] border p-3 transition-colors ${values.includes(value) ? "border-[var(--accent-line)] bg-[var(--surface-2)]" : "border-[var(--line)] hover:bg-[var(--surface-2)]"}`}>
          <input type="checkbox" checked={values.includes(value)} onChange={(event) => onChange(event.target.checked ? [...values, value] : values.filter((item) => item !== value))} className="mt-0.5 size-4 accent-[var(--text)] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text)]" />
          <span><span className="block text-sm font-medium">{label}</span><span className="block mt-1 text-xs text-[var(--text-2)]">{hint}</span></span>
        </label>)}
      </div>
    </SettingsSection>
  );
}
