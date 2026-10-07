"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import styles from "./ComboLimitsModal.module.css";

// Keep in sync with MAX_OVERRIDE_TOKENS in open-sse/providers/limitOverride.js.
// The server validates again — this only keeps the message local.
const MAX_TOKENS = 10_000_000;

const digitsOnly = (value) => value.replace(/[^\d]/g, "");

// Same short form the combo row shows, so the auto reference and the list agree.
const fmtTokens = (n) => {
  if (!n) return "?";
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
};

// A combo stores seats in routed form ("cx/gpt-6-luna"); /api/models maps that
// back to the provider id + model id the limits are keyed by.
function buildSeatLookup(models) {
  const lookup = new Map();
  for (const model of models || []) {
    if (!model?.provider || !model?.model) continue;
    const target = { provider: model.provider, model: model.model };
    lookup.set(model.routedModel || `${model.provider}/${model.model}`, target);
    lookup.set(model.fullModel || `${model.provider}/${model.model}`, target);
  }
  return lookup;
}

// A pin is stored per model, so editing here changes every combo that uses it.
export default function ComboLimitsModal({ combo, onClose }) {
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      const seats = combo?.models || [];
      const models = await fetch("/api/models")
        .then((response) => (response.ok ? response.json() : { models: [] }))
        .then((data) => data.models || [])
        .catch(() => []);
      const lookup = buildSeatLookup(models);

      const resolved = seats.map((seat) => {
        const target = seat.includes("/") ? lookup.get(seat) : null;
        return { seat, target, kind: !seat.includes("/") ? "combo" : target ? "model" : "unknown" };
      });

      const ids = resolved.filter((row) => row.kind === "model").map((row) => `${row.target.provider}/${row.target.model}`);
      const limits = ids.length
        ? await fetch(`/api/models/limits?models=${encodeURIComponent(ids.join(","))}`)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
        : { overrides: {}, auto: {} };

      if (!alive) return;
      if (!limits) {
        setRows([]);
        setError("Could not load the current limits.");
        return;
      }

      setRows(
        resolved.map((row) => {
          const id = row.kind === "model" ? `${row.target.provider}/${row.target.model}` : null;
          const pin = id ? limits.overrides?.[id] : null;
          return {
            ...row,
            id,
            pin: pin || null,
            auto: (id && limits.auto?.[id]) || { contextWindow: null, maxOutput: null },
            ctx: pin?.contextWindow ? String(pin.contextWindow) : "",
            max: pin?.maxOutput ? String(pin.maxOutput) : "",
          };
        }),
      );
    })();

    return () => {
      alive = false;
    };
  }, [combo]);

  const patchRow = (seat, field, value) => {
    setRows((previous) => previous.map((row) => (row.seat === seat ? { ...row, [field]: value } : row)));
  };

  const save = async () => {
    const editable = rows.filter((row) => row.kind === "model");
    for (const row of editable) {
      for (const [field, label] of [["ctx", "ctx"], ["max", "max"]]) {
        const tokens = Number(row[field] || 0);
        if (row[field] && (!tokens || tokens > MAX_TOKENS)) {
          setError(`${label} for ${row.seat} must be a whole number of tokens between 1 and ${MAX_TOKENS}.`);
          return;
        }
      }
    }

    // Only the rows that actually changed: a number pins the field, null hands
    // it back to the automatic value.
    const updates = editable
      .map((row) => {
        const contextWindow = row.ctx ? Number(row.ctx) : null;
        const maxOutput = row.max ? Number(row.max) : null;
        const unchanged = (row.pin?.contextWindow || null) === contextWindow && (row.pin?.maxOutput || null) === maxOutput;
        return unchanged ? null : { model: row.id, contextWindow, maxOutput };
      })
      .filter(Boolean);

    if (!updates.length) {
      onClose();
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/models/limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save the limits");

      // The combo list resolves its caps through a cached /api/models fetch.
      window.dispatchEvent(new Event("modelLimitsChanged"));
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      trapFocus
      title="Context & Output Limits"
      size="xl"
      onClose={() => !saving && onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="contrast" onClick={save} loading={saving} disabled={saving || !rows?.length}>Save Limits</Button>
        </>
      }
    >
      <div className={styles.heading}>
        <code className={styles.comboName}>{combo?.name}</code>
        <h3>Manual limits per model</h3>
        <p>
          The numbers are fetched automatically, and these pin them by hand when the automatic value comes out too
          low. Values are tokens; leave a field empty to follow the automatic value. A pin is stored per model, so it
          applies to every combo using it, to the model list and to outgoing requests.
        </p>
      </div>

      {rows === null ? (
        <p className={styles.note}>Loading models…</p>
      ) : rows.length === 0 ? (
        <p className={styles.note}>{error || "This combo has no models."}</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.seat} className={styles.row}>
              <div className={styles.rowHead}>
                <code className={styles.seat} title={row.seat}>{row.seat}</code>
                {row.kind === "model" && (row.ctx || row.max) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((previous) => previous.map((item) => (
                      item.seat === row.seat ? { ...item, ctx: "", max: "" } : item
                    )))}
                    disabled={saving}
                  >
                    Auto
                  </Button>
                )}
              </div>

              {row.kind === "model" ? (
                <>
                  <div className={styles.fields}>
                    <Input
                      label="ctx"
                      inputMode="numeric"
                      placeholder="auto"
                      value={row.ctx}
                      onChange={(event) => patchRow(row.seat, "ctx", digitsOnly(event.target.value))}
                      disabled={saving}
                    />
                    <Input
                      label="max"
                      inputMode="numeric"
                      placeholder="auto"
                      value={row.max}
                      onChange={(event) => patchRow(row.seat, "max", digitsOnly(event.target.value))}
                      disabled={saving}
                    />
                  </div>
                  <p className={styles.auto}>
                    auto: ctx {fmtTokens(row.auto.contextWindow)} · max {fmtTokens(row.auto.maxOutput)}
                  </p>
                </>
              ) : (
                <p className={styles.auto}>
                  {row.kind === "combo"
                    ? "Nested combo — set the limits on the models inside it."
                    : "Model not found in this install."}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && rows?.length > 0 && <p className={styles.error}>{error}</p>}
    </Modal>
  );
}
