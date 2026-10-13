"use client";

import Button from "@/shared/components/Button";
import ModelPickerList from "@/shared/components/ModelPickerList";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { orderedDraftMembers, removeDraftMember, moveDraftMember, memberObservability } from "./modelAliasForm";
import styles from "../models-aliases.module.css";

export default function ModelAliasMembers({ draft, onChange, providerMetadata, activeProviders, modelAliases, disabled = false, catalogError = "", onRetry }) {
  const catalog = useModelCatalog({ isOpen: true, activeProviders, modelAliases, addedModelValues: draft.models,
    catalogContext: "members", includeLegacyCombos: false, excludePlaceholders: true });
  const order = orderedDraftMembers(draft);
  const add = model => {
    if (!model.value || model.isAlias || model.isCombo || model.isPlaceholder || draft.models.includes(model.value)) return;
    onChange({ ...draft, models: [...draft.models, model.value] });
  };
  return <section className={styles.group} aria-label="Alias members">
    <h3>Members</h3>
    <p className={styles.help}>Choose provider models below. Select a primary explicitly. Runtime order never changes this configured list.</p>
    {!order.length ? <p className={styles.help}>No members selected.</p> : <ol className={styles.members}>
      {order.map((id, index) => <li key={id} className={styles.member}>
        <div className={styles.identity}><code data-i18n-skip>{id}</code>{id === draft.primaryModel ? <strong className={styles.primary}>Primary</strong> : null}
          <p className={styles.help}>{memberObservability(id, providerMetadata) === "buffered"
            ? "Buffered transport: deadline measures the complete observable answer, not internal first-token timing. This member remains eligible."
            : memberObservability(id, providerMetadata) === "incremental" ? "Incremental output" : "Output observability unknown"}</p>
        </div>
        <div className={styles.actions}>
          {id !== draft.primaryModel ? <><Button type="button" variant="secondary" disabled={disabled || index === 0 || order[index - 1] === draft.primaryModel} aria-label={`Move ${id} up`} onClick={() => onChange(moveDraftMember(draft, id, -1))}>Up</Button>
            <Button type="button" variant="secondary" disabled={disabled || index === order.length - 1} aria-label={`Move ${id} down`} onClick={() => onChange(moveDraftMember(draft, id, 1))}>Down</Button></> : null}
          <Button type="button" variant="ghost" disabled={disabled} aria-label={`Remove ${id}`} onClick={() => onChange(removeDraftMember(draft, id))}>Remove</Button>
        </div>
      </li>)}
    </ol>}
    <fieldset disabled={disabled} className={styles.picker}>
      <legend className={styles.label}>Add members</legend>
      <ModelPickerList searchQuery={catalog.searchQuery} onSearchChange={catalog.setSearchQuery} groups={catalog.visibleGroups}
        loading={catalog.loading} error={catalogError || catalog.error} onRetry={() => { onRetry?.(); catalog.reload(); }}
        addedModelValues={draft.models} onSelect={add} emptyLabel="No configured provider models found" />
    </fieldset>
  </section>;
}
