"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { settingsToSliderValue } from "./playgroundUtils";
import styles from "./playground.module.css";

const PRESETS = [
  ["Default", ""],
  ["Senior dev", "You are a senior software engineer. Give precise, production-ready answers, explain trade-offs briefly, and show code when it helps."],
  ["JSON output", "Respond only with valid JSON. Do not add prose or code fences."],
  ["Concise", "Answer as briefly as possible. Skip preambles and filler."],
];

const TOKEN_PRESETS = [1024, 2048, 4096, 8192];

export default function PlaygroundSettingsPopover({ settings, onChange, onClose, onExport, onClear }) {
  const [clearArmed, setClearArmed] = useState(false);
  const [tokensDraft, setTokensDraft] = useState(String(settings.maxTokens));
  const [topPDraft, setTopPDraft] = useState(settings.topP);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- token presets and restores must refresh the custom draft
    setTokensDraft(String(settings.maxTokens));
  }, [settings.maxTokens]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an external top_p change must refresh the draft
    setTopPDraft(settings.topP);
  }, [settings.topP]);

  useEffect(() => {
    if (!clearArmed) return undefined;
    const timer = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const commitTokens = () => {
    const value = Number.parseInt(tokensDraft, 10);
    if (Number.isFinite(value) && value > 0) {
      onChange({ maxTokens: value });
    } else {
      setTokensDraft(String(settings.maxTokens));
    }
  };

  const commitTopP = () => {
    const value = Number.parseFloat(topPDraft);
    if (topPDraft === "") {
      onChange({ topP: "" });
    } else if (Number.isFinite(value)) {
      onChange({ topP: String(Math.min(1, Math.max(0, value))) });
    } else {
      setTopPDraft(settings.topP);
    }
  };

  return (
    <div className={styles.settingsPopover} role="dialog" aria-label="Playground settings" data-playground-settings>
      <div className={styles.settingsHead}>
        <span>Playground settings</span>
        <button type="button" className={styles.settingsClose} onClick={onClose} aria-label="Close settings">
          <Icon>close</Icon>
        </button>
      </div>

      <div className={styles.settingsLabel}>
        <span>System prompt</span>
        <small className={styles.settingsCount}>{settings.system.length} chars</small>
      </div>
      <textarea
        className={styles.settingsTextarea}
        value={settings.system}
        onChange={(event) => onChange({ system: event.target.value })}
        placeholder="Give the model behavioral instructions, persona, or output format constraints…"
      />

      <div className={styles.presets}>
        {PRESETS.map(([label, value]) => (
          <button
            key={label}
            type="button"
            className={styles.preset}
            aria-pressed={settings.system === value}
            onClick={() => onChange({ system: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.settingsBlock}>
        <div className={styles.settingsLabel}>
          <span>Temperature</span>
          <small className={styles.settingsCount}>{settingsToSliderValue(settings.temperature).toFixed(2)}</small>
        </div>
        <input
          type="range"
          className={styles.slider}
          min="0"
          max="2"
          step="0.05"
          value={settingsToSliderValue(settings.temperature)}
          onChange={(event) => onChange({ temperature: Number(event.target.value) })}
          aria-label="Temperature"
        />
        <div className={styles.sliderLabels}>
          <span>0.0 (Precise)</span>
          <span>1.0 (Balanced)</span>
          <span>2.0 (Creative)</span>
        </div>
      </div>

      <div className={styles.settingsBlock}>
        <div className={styles.settingsLabel}>
          <span>Max output tokens</span>
        </div>
        <div className={styles.tokens}>
          {TOKEN_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.token}
              aria-pressed={Number(settings.maxTokens) === value}
              onClick={() => onChange({ maxTokens: value })}
            >
              {value}
            </button>
          ))}
        </div>
        <label className={styles.tokenCustom}>
          <span>Custom</span>
          <input
            type="number"
            min="1"
            step="1"
            value={tokensDraft}
            onChange={(event) => setTokensDraft(event.target.value)}
            onBlur={commitTokens}
            onKeyDown={(event) => { if (event.key === "Enter") commitTokens(); }}
          />
        </label>

        <label className={styles.tokenCustom}>
          <span>Top P</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            placeholder="default"
            value={topPDraft}
            onChange={(event) => setTopPDraft(event.target.value)}
            onBlur={commitTopP}
            onKeyDown={(event) => { if (event.key === "Enter") commitTopP(); }}
          />
        </label>
      </div>

      <div className={styles.settingsBlock}>
        <button
          type="button"
          role="switch"
          aria-checked={settings.helper}
          className={styles.settingsToggle}
          onClick={() => onChange({ helper: !settings.helper })}
        >
          <span>
            AI helper requests
            <small>Auto title and follow-up suggestions. Extra billed calls.</small>
          </span>
          <span className={styles.switch} />
        </button>
      </div>

      <div className={styles.settingsActions}>
        <button type="button" className={styles.settingsSecondary} onClick={onExport}>
          <Icon>code</Icon>
          Export code
        </button>
        <button
          type="button"
          className={styles.settingsDanger}
          aria-label={clearArmed ? "Confirm clear conversation" : "Clear conversation"}
          onClick={() => {
            if (!clearArmed) {
              setClearArmed(true);
              return;
            }
            setClearArmed(false);
            onClear();
          }}
        >
          <Icon>delete</Icon>
          {clearArmed ? "Click again to clear" : "Clear"}
        </button>
      </div>
    </div>
  );
}

PlaygroundSettingsPopover.propTypes = {
  settings: PropTypes.shape({
    system: PropTypes.string,
    temperature: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    maxTokens: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    topP: PropTypes.string,
    helper: PropTypes.bool,
    think: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
};
