"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/shared/components/Button";
import { getConfiguredAliasOrder, getModelsAliasConfigKey } from "@/lib/modelsAliases/config.js";
import styles from "../models-aliases.module.css";

function validStatus(data, alias) {
  const order = getConfiguredAliasOrder(alias);
  const sameSet = values => Array.isArray(values) && values.length === order.length && new Set(values).size === order.length && values.every(id => order.includes(id));
  return data?.aliasId === alias.id && typeof data.configVersion === "string" && data.configVersion.length > 0 && Number.isFinite(data.serverNow)
    && JSON.stringify(data.configuredOrder) === JSON.stringify(order) && sameSet(data.effectiveOrder)
    && Array.isArray(data.members) && sameSet(data.members.map(member => member.modelId))
    && data.members.every(member => ["available", "cooldown", "recovering"].includes(member.status) && (member.retryAt === null || Number.isFinite(member.retryAt)));
}

export default function ModelAliasRuntimeStatus({ alias, expanded }) {
  const key = getModelsAliasConfigKey(alias);
  const [view, setView] = useState({ key: null, data: null, receivedAt: 0, error: "", message: "", loading: false, resetting: false });
  const [now, setNow] = useState(() => performance.now());
  const actions = useRef(null);
  useEffect(() => {
    if (!expanded) return;
    let alive = true; let generation = 0; let timer; let ticker; let controller; let pending = false;
    const path = `/api/models-aliases/${encodeURIComponent(alias.id)}/runtime`;
    const active = () => alive && document.visibilityState === "visible";
    const stop = () => { generation++; clearTimeout(timer); clearInterval(ticker); controller?.abort(); pending = false; };
    const schedule = () => { if (active()) timer = setTimeout(load, 3000); };
    const load = async () => {
      if (!active() || pending) return;
      clearTimeout(timer); pending = true; controller = new AbortController(); const current = ++generation; const signal = controller.signal;
      setView(previous => previous.key === key ? { ...previous, loading: true } : { key, data: null, receivedAt: 0, error: "", message: "", loading: true, resetting: false });
      let feedback = "Unable to load runtime status. Retry status.";
      try {
        const response = await fetch(path, { cache: "no-store", signal });
        if (!response.ok) {
          if (response.status === 400 || response.status === 404) feedback = "Configuration unavailable. Review provider configuration and refresh status.";
          throw new Error();
        }
        const data = await response.json(); if (!validStatus(data, alias)) throw new Error("Unable to load runtime status. Retry status.");
        if (active() && current === generation && !signal.aborted) setView(previous => ({ ...previous, key, data, receivedAt: performance.now(), loading: false, error: "" }));
      } catch { if (active() && current === generation && !signal.aborted) setView(previous => ({ ...previous, key, data: null, loading: false, error: feedback })); }
      finally { if (active() && current === generation) { pending = false; schedule(); } }
    };
    const reset = async data => {
      if (!active() || !data || pending) return;
      stop(); pending = true; controller = new AbortController(); const signal = controller.signal; const current = ++generation;
      setView(previous => ({ ...previous, resetting: true, error: "", message: "" })); let stale = false;
      try {
        const response = await fetch(`${path}/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configVersion: data.configVersion }), signal });
        if (response.status === 409) { stale = true; throw new Error("Configuration changed. Refreshing status before another reset."); }
        if (!response.ok) throw new Error("Unable to reset runtime order. Cooldown protections remain unchanged.");
        const updated = await response.json(); if (!validStatus(updated, alias)) throw new Error();
        if (active() && current === generation && !signal.aborted) setView({ key, data: updated, receivedAt: performance.now(), loading: false, resetting: false, error: "", message: "Runtime order restored. Cooldown protections retained." });
      } catch { if (active() && current === generation && !signal.aborted) setView(previous => ({ ...previous, data: stale ? null : previous.data, resetting: false,
        error: stale ? "" : "Unable to reset runtime order. Cooldown protections remain unchanged.", message: stale ? "Configuration changed. Refreshing status before another reset." : "" })); }
      finally {
        if (active() && current === generation) { pending = false; ticker = setInterval(() => setNow(performance.now()), 1000); if (stale) load(); else schedule(); }
      }
    };
    const start = () => { if (!active()) return; ticker = setInterval(() => setNow(performance.now()), 1000); load(); };
    const visibility = () => { stop(); setView(previous => ({ ...previous, data: null, resetting: false, loading: false, message: "" })); start(); };
    actions.current = { reset, retry: () => { stop(); start(); } };
    document.addEventListener("visibilitychange", visibility);
    Promise.resolve().then(start);
    return () => { alive = false; stop(); document.removeEventListener("visibilitychange", visibility); actions.current = null; };
  }, [key, expanded, alias]);
  if (!expanded) return null;
  const current = view.key === key ? view : { data: null, error: "", message: "", loading: true, resetting: false };
  const serverNow = current.data ? current.data.serverNow + Math.max(0, now - current.receivedAt) : 0;
  return <section className={styles.runtime} aria-label="Runtime status">
    <div className={styles.toolbar}><h3>Runtime status</h3><div className={styles.actions}>
      <Button type="button" variant="secondary" disabled={!current.data || current.resetting || current.loading} onClick={() => actions.current?.reset(current.data)}>Reset runtime order</Button>
      <Button type="button" variant="ghost" disabled={current.resetting} onClick={() => actions.current?.retry()}>Refresh status</Button>
    </div></div>
    <p className={styles.help}>Reset restores runtime order only. It does not clear cooldown, change provider health or run inference.</p>
    {current.loading ? <p role="status" className={styles.help}>Loading runtime status...</p> : null}
    {current.resetting ? <p role="status" className={styles.help}>Resetting runtime order...</p> : null}
    {current.error ? <p role="alert" className={styles.error}>{current.error}</p> : null}
    {current.message ? <p role="status" className={styles.help}>{current.message}</p> : null}
    {current.data ? <><p className={styles.help}>Effective runtime order (separate from configured order)</p><ol>{current.data.effectiveOrder.map(id => {
      const member = current.data.members.find(member => member.modelId === id);
      const label = member.status === "recovering" ? "Recovery pending" : member.status === "cooldown" ? `Cooldown: ${Math.max(0, Math.ceil(((member.retryAt ?? serverNow) - serverNow) / 1000))}s` : "Available";
      return <li key={id}><code data-i18n-skip>{id}</code> <span className={styles.help}>{label}</span></li>;
    })}</ol></> : null}
  </section>;
}
