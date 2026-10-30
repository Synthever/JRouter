"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import PlaygroundModelIcon from "./PlaygroundModelIcon";
import styles from "./playground.module.css";

const MAX_COMPOSER_HEIGHT = 200;

const COMMANDS = [
  { key: "/new", label: "New conversation" },
  { key: "/clear", label: "Clear this conversation" },
  { key: "/history", label: "Open conversations" },
  { key: "/model", label: "Choose a model" },
  { key: "/settings", label: "Open settings" },
  { key: "/export", label: "Export code" },
];

export default function PlaygroundComposer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  canSend,
  model,
  pickerOpen,
  onOpenPicker,
  picker,
  onOpenHistory,
  historyCount,
  think,
  onToggleThink,
  settingsOpen,
  onToggleSettings,
  settingsPanel,
  onCommand,
  textareaRef,
}) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const commands = useMemo(() => {
    if (!/^\/\w*$/.test(value)) return [];
    return COMMANDS.filter((command) => command.key.startsWith(value.toLowerCase()));
  }, [value]);

  const paletteOpen = commands.length > 0 && !dismissed;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- typing resets the palette highlight and re-opens it
    setCommandIndex(0);
  }, [value]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- typing re-opens a dismissed palette
    setDismissed(false);
  }, [value]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [value, textareaRef]);

  const runCommand = (key) => {
    setDismissed(true);
    onCommand(key);
  };

  const handleKeyDown = (event) => {
    if (paletteOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((index) => (index + 1) % commands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex((index) => (index - 1 + commands.length) % commands.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        runCommand(commands[commandIndex].key);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className={styles.composerShell}>
      <div className={styles.column}>
        <div className={styles.composerWrap}>
          {picker}
          {settingsPanel}

          {paletteOpen ? (
            <div id="playground-commands" className={styles.palette} role="listbox" aria-label="Commands">
              {commands.map((command, index) => (
                <button
                  key={command.key}
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  className={styles.paletteItem}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(command.key)}
                >
                  <b>{command.key}</b>
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.composer}>
            <textarea
              ref={textareaRef}
              rows={1}
              className={styles.textarea}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={model ? `Ask ${model.name} anything, or type / for commands…` : "Select a model to start…"}
              aria-label="Message"
              aria-controls={paletteOpen ? "playground-commands" : undefined}
            />

            <div className={styles.composerBar}>
              <button
                type="button"
                data-model-trigger
                className={styles.tool}
                onClick={onOpenPicker}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
              >
                <PlaygroundModelIcon
                  providerId={model?.providerId}
                  providerName={model?.providerName}
                  providerColor={model?.providerColor}
                  isCombo={model?.isCombo}
                  size={16}
                />
                <span className={styles.toolLabel}>{model ? model.name : "Select a model"}</span>
                <Icon>expand_more</Icon>
              </button>

              <button type="button" className={styles.tool} onClick={onOpenHistory}>
                <Icon>chat</Icon>
                <span className={styles.toolLabel}>History</span>
                <span className={styles.toolBadge}>{historyCount}</span>
              </button>

              <button
                type="button"
                className={styles.tool}
                aria-pressed={think}
                onClick={onToggleThink}
              >
                <Icon>psychology</Icon>
                <span className={styles.toolLabel}>Think</span>
              </button>

              <button
                type="button"
                className={styles.tool}
                aria-label="Playground settings"
                aria-expanded={settingsOpen}
                onClick={onToggleSettings}
              >
                <Icon>more_vert</Icon>
              </button>

              <span className={styles.spacer} />

              {isStreaming ? (
                <button type="button" className={styles.sendButton} data-mode="stop" onClick={onStop} aria-label="Stop generating">
                  <Icon>stop</Icon>
                </button>
              ) : (
                <button type="button" className={styles.sendButton} onClick={onSend} disabled={!canSend} aria-label="Send message">
                  <Icon>arrow_upward</Icon>
                </button>
              )}
            </div>
          </div>

          <p className={styles.hint}>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

PlaygroundComposer.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  onStop: PropTypes.func.isRequired,
  isStreaming: PropTypes.bool,
  canSend: PropTypes.bool,
  model: PropTypes.object,
  pickerOpen: PropTypes.bool,
  onOpenPicker: PropTypes.func.isRequired,
  picker: PropTypes.node,
  onOpenHistory: PropTypes.func.isRequired,
  historyCount: PropTypes.number,
  think: PropTypes.bool,
  onToggleThink: PropTypes.func.isRequired,
  settingsOpen: PropTypes.bool,
  onToggleSettings: PropTypes.func.isRequired,
  settingsPanel: PropTypes.node,
  onCommand: PropTypes.func.isRequired,
  textareaRef: PropTypes.object.isRequired,
};
