"use client";

import PropTypes from "prop-types";
import styles from "./playground.module.css";

const SUGGESTIONS = [
  "Explain how fallback works in a combo",
  "Write a curl command to test my endpoint",
  "Draft a system prompt for a code reviewer",
  "Summarize this stack trace and suggest a fix",
];

export default function PlaygroundEmpty({ hint, showSuggestions, onSuggestion }) {
  return (
    <div className={styles.empty}>
      <svg className={styles.emptyArt} viewBox="0 0 300 140" aria-hidden="true">
        <defs>
          <radialGradient id="pgArtA" cx="0.35" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#ff9cc0" />
            <stop offset="1" stopColor="#ff4d8b" />
          </radialGradient>
          <radialGradient id="pgArtB" cx="0.4" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#d9ccf8" />
            <stop offset="1" stopColor="#b8a4ed" />
          </radialGradient>
          <radialGradient id="pgArtC" cx="0.4" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#f6d98a" />
            <stop offset="1" stopColor="#e8b94a" />
          </radialGradient>
        </defs>
        <circle cx="232" cy="38" r="20" fill="#ffb084" />
        <path d="M0 140C16 140 34 62 68 62C102 62 120 140 140 140Z" fill="url(#pgArtA)" />
        <path d="M120 140C134 140 150 70 182 12C214 70 228 140 244 140Z" fill="url(#pgArtB)" transform="translate(6 0)" />
        <path d="M200 140C212 140 226 84 252 84C278 84 290 140 300 140Z" fill="url(#pgArtC)" />
      </svg>
      <h2 className={styles.emptyTitle}>Start a conversation</h2>
      <p className={styles.emptyHint}>{hint}</p>
      {showSuggestions ? (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestion}
              onClick={() => onSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

PlaygroundEmpty.propTypes = {
  hint: PropTypes.string.isRequired,
  showSuggestions: PropTypes.bool,
  onSuggestion: PropTypes.func.isRequired,
};
