"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import Toggle from "@/shared/components/Toggle";
import { buildMetricParts } from "./playgroundUtils.js";
import styles from "./PlaygroundRail.module.css";

const SLIDERS = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05 },
  { key: "maxTokens", label: "Max tokens", min: 256, max: 16384, step: 256 },
  { key: "topP", label: "Top P", min: 0, max: 1, step: 0.05 },
];

// The rail owns the sampling parameters. Sliders and number fields both hand back
// strings, but params stay numeric for the request builder and for reset comparisons:
// commit the number, and leave the field alone while the text is still unparseable
// ("", "0.", "-") so a decimal can be typed a keystroke at a time.
function parseParam(raw) {
  if (raw === "" || raw.endsWith(".")) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function responseTag(lastTurn) {
  if (!lastTurn) return "";
  if (lastTurn.status === "error") return "error";
  const status = lastTurn.response?.status;
  if (status) return `${status} OK`;
  return lastTurn.meta?.stopped ? "stopped" : "no response";
}

export default function PlaygroundRail({
  params,
  onParamsChange,
  onResetParams,
  routePlans,
  lastTurn,
  saver,
  onOpenTokenSaver,
}) {
  const setParam = (key) => (raw) => {
    const parsed = parseParam(raw);
    if (parsed === null) return;
    onParamsChange({ ...params, [key]: parsed });
  };

  const metrics = lastTurn ? buildMetricParts({
    firstTokenMs: lastTurn.firstTokenMs,
    totalMs: lastTurn.totalMs,
    usage: lastTurn.meta?.usage,
    finishReason: lastTurn.meta?.finishReason,
    reportedModel: lastTurn.meta?.reportedModel,
    requestedModel: lastTurn.meta?.requestedModel,
    stopped: lastTurn.meta?.stopped,
  }) : [];

  return (
    <>
      <section className={styles.card} aria-label="Execution parameters">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Execution parameters</span>
          <button type="button" className={styles.link} onClick={onResetParams}>Reset defaults</button>
        </div>

        <Toggle
          size="sm"
          checked={params.useDefaults}
          onChange={(value) => onParamsChange({ ...params, useDefaults: value })}
          label="Use provider defaults"
          description="When on, no sampling parameters are sent."
        />

        {SLIDERS.map((slider) => (
          <label key={slider.key} className={styles.field} data-disabled={params.useDefaults ? "true" : "false"}>
            <span className={styles.fieldHead}>
              <span className={styles.fieldLabel}>{slider.label}</span>
              <input
                type="number"
                className={styles.number}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={params[slider.key]}
                disabled={params.useDefaults}
                aria-label={slider.label}
                onChange={(event) => setParam(slider.key)(event.target.value)}
              />
            </span>
            <input
              type="range"
              className={styles.range}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={params[slider.key]}
              disabled={params.useDefaults}
              aria-label={slider.label}
              onChange={(event) => setParam(slider.key)(event.target.value)}
            />
          </label>
        ))}

        <div className={styles.toggles}>
          <Toggle size="sm" checked={params.stream} onChange={(value) => onParamsChange({ ...params, stream: value })} label="Stream responses" />
          <Toggle size="sm" checked={params.jsonMode} onChange={(value) => onParamsChange({ ...params, jsonMode: value })} label="Strict JSON" />
        </div>

        <button type="button" className={styles.saver} onClick={onOpenTokenSaver}>
          <Icon>bolt</Icon>
          <span>{saver.label}</span>
          <Icon>chevron_right</Icon>
        </button>
      </section>

      <section className={styles.card} aria-label="Route plan">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Route plan</span>
          <span className={styles.tag}>from config</span>
        </div>
        {routePlans.map((entry) => (
          <div key={entry.key} className={styles.plan}>
            {routePlans.length > 1 ? <p className={styles.planName}>Lane {entry.key.toUpperCase()}</p> : null}
            {entry.plan.rows.length === 0 ? (
              <p className={styles.empty}>{entry.plan.summary}</p>
            ) : (
              <>
                {entry.plan.rows.map((row) => (
                  <div key={`${entry.key}-${row.index}`} className={styles.row}>
                    <span className={styles.dot} data-role={row.role === "primary" ? "primary" : "fallback"} />
                    <span className={styles.rowText}>
                      <strong>{row.provider || "provider"}</strong>
                      <small>{row.model}</small>
                    </span>
                    <span className={styles.rowRole}>{row.role}</span>
                  </div>
                ))}
                <p className={styles.foot}>{entry.plan.summary}</p>
              </>
            )}
          </div>
        ))}
        <p className={styles.foot}>Route plan from config. The upstream that served a reply is shown per message.</p>
      </section>

      <section className={styles.card} aria-label="Last response">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Last response</span>
          {lastTurn ? <span className={styles.tag}>{responseTag(lastTurn)}</span> : null}
        </div>
        {lastTurn ? (
          <div className={styles.metrics}>
            {metrics.length ? metrics.map((part) => <span key={part} className={styles.metricChip}>{part}</span>) : (
              <span className={styles.empty}>No metrics reported.</span>
            )}
          </div>
        ) : (
          <p className={styles.empty}>No response yet.</p>
        )}
      </section>
    </>
  );
}

PlaygroundRail.propTypes = {
  params: PropTypes.shape({
    useDefaults: PropTypes.bool.isRequired,
    temperature: PropTypes.number.isRequired,
    maxTokens: PropTypes.number.isRequired,
    topP: PropTypes.number.isRequired,
    stream: PropTypes.bool.isRequired,
    jsonMode: PropTypes.bool.isRequired,
  }).isRequired,
  onParamsChange: PropTypes.func.isRequired,
  onResetParams: PropTypes.func.isRequired,
  routePlans: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    plan: PropTypes.shape({
      summary: PropTypes.string,
      rows: PropTypes.arrayOf(PropTypes.shape({
        index: PropTypes.number,
        provider: PropTypes.string,
        model: PropTypes.string,
        role: PropTypes.string,
      })),
    }).isRequired,
  })).isRequired,
  lastTurn: PropTypes.shape({
    status: PropTypes.string,
    firstTokenMs: PropTypes.number,
    totalMs: PropTypes.number,
    meta: PropTypes.object,
    response: PropTypes.object,
  }),
  saver: PropTypes.shape({ label: PropTypes.string.isRequired }).isRequired,
  onOpenTokenSaver: PropTypes.func.isRequired,
};
