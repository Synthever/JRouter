"use client";

import { useEffect, useState } from "react";
import Button from "@/shared/components/Button";
import { createAliasDraft, validateAliasDraft } from "./components/modelAliasForm";
import ModelAliasFormModal from "./components/ModelAliasFormModal";
import ModelAliasRow from "./components/ModelAliasRow";
import { getModelsAliasConfigKey } from "@/lib/modelsAliases/config.js";
import styles from "./models-aliases.module.css";

export default function ModelsAliasesPage() {
  const [catalog, setCatalog] = useState({ aliases: [], providerMetadata: {}, loading: true, error: "" });
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(undefined);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setCatalog(previous => ({ ...previous, loading: true, error: "" }));
      try {
        const response = await fetch("/api/models-aliases", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(); const data = await response.json();
        if (!Array.isArray(data.aliases) || !data.providerMetadata || typeof data.providerMetadata !== "object" || Array.isArray(data.providerMetadata)
          || data.aliases.some(alias => typeof alias?.id !== "string" || !validateAliasDraft(createAliasDraft(alias)).valid)) throw new Error();
        if (!controller.signal.aborted) setCatalog({ ...data, loading: false, error: "" });
      } catch { if (!controller.signal.aborted) setCatalog(previous => ({ ...previous, loading: false, error: "Unable to load Models Aliases. Check your session and retry." })); }
    });
    return () => controller.abort();
  }, [revision]);
  const saved = alias => {
    setCatalog(previous => ({ ...previous, aliases: previous.aliases.some(row => row.id === alias.id) ? previous.aliases.map(row => row.id === alias.id ? alias : row) : [...previous.aliases, alias] }));
    setEditing(undefined);
  };
  return <div className={styles.page}>
    <div className={styles.toolbar}><div><h1>Models Aliases</h1><p className={styles.help}>Stable public model IDs with deliberate configuration and separate runtime order.</p></div>
      <Button variant="contrast" disabled={catalog.loading || !!catalog.error} onClick={() => setEditing(null)}>Create alias</Button></div>
    {catalog.loading ? <p className={styles.panel} role="status">Loading Models Aliases...</p> : catalog.error ? <div className={styles.panel} role="alert"><p className={styles.error}>{catalog.error}</p><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Retry</Button></div>
      : !catalog.aliases.length ? <div className={styles.panel}><h2>No aliases configured</h2><p className={styles.help}>Create an alias, choose provider members, then select its primary.</p></div>
      : catalog.aliases.map(alias => <ModelAliasRow key={getModelsAliasConfigKey(alias)} alias={alias} suspended={editing !== undefined} onEdit={() => setEditing(alias)} onDeleted={() => setCatalog(previous => ({ ...previous, aliases: previous.aliases.filter(row => row.id !== alias.id) }))} />)}
    {editing !== undefined ? <ModelAliasFormModal key={editing?.id ?? "create"} alias={editing} providerMetadata={catalog.providerMetadata} onSaved={saved} onClose={() => setEditing(undefined)} /> : null}
  </div>;
}
