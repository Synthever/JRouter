"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/shared/components/Button";
import Modal from "@/shared/components/Modal";
import ModelAliasRuntimeStatus from "./ModelAliasRuntimeStatus";
import styles from "../models-aliases.module.css";

export default function ModelAliasRow({ alias, onEdit, onDeleted, suspended = false }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const alive = useRef(true); const request = useRef(null); const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  const copy = async () => {
    setCopyMessage("");
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(`jrouter/${alias.name}`); if (alive.current) setCopyMessage("Copied"); }
    catch { if (alive.current) setCopyMessage("Unable to copy. Select the public ID and copy it manually."); }
  };
  const closeDelete = () => {
    if (busy.current) return;
    request.current?.abort(); setConfirming(false); setDeleting(false);
  };
  const remove = async () => {
    if (busy.current) return; busy.current = true; setDeleting(true); setError(""); const controller = new AbortController(); request.current = controller;
    try { const response = await fetch(`/api/models-aliases/${encodeURIComponent(alias.id)}`, { method: "DELETE", signal: controller.signal });
      if (!response.ok) throw new Error(); if (alive.current && !controller.signal.aborted) onDeleted(alias.id);
    } catch { if (alive.current && !controller.signal.aborted) setError("Unable to delete Models Alias. The row is preserved. Retry deleting."); }
    finally { busy.current = false; if (alive.current) setDeleting(false); }
  };
  return <article className={styles.row}>
    <div className={styles.toolbar}><div className={styles.identity}><h2 data-i18n-skip>{alias.name}</h2><code className={styles.publicId} data-i18n-skip>{`jrouter/${alias.name}`}</code></div>
      <div className={styles.actions}><Button type="button" variant="secondary" aria-label="Copy public ID" onClick={copy}>Copy</Button>
        <Button type="button" variant="secondary" aria-label={`Edit ${alias.name}`} onClick={() => { setExpanded(false); onEdit(alias); }}>Edit</Button>
        <Button type="button" variant="ghost" aria-label={`Delete ${alias.name}`} onClick={() => { setExpanded(false); setConfirming(true); setError(""); }}>Delete</Button></div></div>
    {copyMessage ? <p role="status" className={styles.help}>{copyMessage}</p> : null}
    <dl className={styles.facts}><div><dt>Primary</dt><dd data-i18n-skip>{alias.primaryModel}</dd></div><div><dt>Strategy</dt><dd>{alias.strategy}</dd></div><div><dt>Deadline</dt><dd>{alias.initialResponseTimeoutSeconds}s</dd></div><div><dt>Prompt</dt><dd>{alias.promptInjectionEnabled ? `Enabled (${alias.promptInjectionMode})` : "Disabled"}</dd></div></dl>
    <div><Button type="button" variant="secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide runtime status" : "Show runtime status"}</Button></div>
    <ModelAliasRuntimeStatus alias={alias} expanded={expanded && !confirming && !suspended} />
    {confirming ? <Modal isOpen onClose={closeDelete} closeOnOverlay={!deleting} trapFocus showTrafficLights={false} title="Delete Models Alias" size="sm" className={styles.dialog}>
      <p className={styles.help}>Delete <code data-i18n-skip>{`jrouter/${alias.name}`}</code>? Clients using this ID will no longer resolve it.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}><Button type="button" variant="secondary" disabled={deleting} onClick={closeDelete}>Cancel</Button><Button type="button" variant="contrast" loading={deleting} onClick={remove}>Delete alias</Button></div>
    </Modal> : null}
  </article>;
}
