"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import styles from "./EndpointStats.module.css";

const LAYOUT_STORAGE_KEY = "jrouter.endpoint.statsLayout.v1";

const ITEMS = [
  { id: "apiKeys", title: "API keys", defaultSpan: 2 },
  { id: "lastUsed", title: "Last used", defaultSpan: 2 },
  { id: "keyRequired", title: "Key required", defaultSpan: 2 },
];

const DEFAULT_LAYOUT = normalizeLayout(null, ITEMS);

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Endpoint summary as movable, resizable widgets persisted per browser. */
export default function EndpointStats({
  activeKeys,
  limitedNote,
  lastUsedValue,
  lastUsedNote,
  requireApiKey,
  keyRequiredNote,
}) {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = browserStorage()?.getItem(LAYOUT_STORAGE_KEY);
      // Browser-only restoration must follow the server's default-layout render.
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLayout(normalizeLayout(JSON.parse(saved), ITEMS));
      }
    } catch {
      // A blocked store or malformed value must not disable the grid.
    }
  }, []);

  const saveLayout = (next) => {
    const canonical = normalizeLayout(next, ITEMS);
    setLayout(canonical);
    try {
      browserStorage()?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(canonical));
    } catch {
      // Keep the accepted layout in memory when browser persistence is unavailable.
    }
  };

  const resetLayout = () => {
    restored.current = true;
    try {
      browserStorage()?.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
      // Reset still takes effect for this mount if storage is blocked.
    }
    setLayout(DEFAULT_LAYOUT);
    setLayoutVersion((version) => version + 1);
  };

  const items = [
    {
      ...ITEMS.find((entry) => entry.id === "apiKeys"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>
            {activeKeys}
            <small className={styles.unit}>active</small>
          </p>
          <p className={styles.note}>{limitedNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((entry) => entry.id === "lastUsed"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{lastUsedValue}</p>
          <p className={styles.note}>{lastUsedNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((entry) => entry.id === "keyRequired"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{requireApiKey ? "On" : "Off"}</p>
          <p className={styles.note}>{keyRequiredNote}</p>
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Endpoint summary">
      <div className={styles.stats} data-key-required={requireApiKey ? "on" : "off"}>
        <WidgetGrid
          items={items}
          key={layoutVersion}
          layout={layout}
          narrowColumns={1}
          onLayoutChange={setLayout}
          onLayoutCommit={saveLayout}
          rowHeight={168}
        />
        <div className={styles.footer}>
          <p>Drag the grip to move a card. Drag its corner to resize.</p>
          <button type="button" onClick={resetLayout} aria-label="Reset layout" className={styles.reset}>
            <RotateCcw size={14} aria-hidden="true" /> Reset layout
          </button>
        </div>
      </div>
    </section>
  );
}

EndpointStats.propTypes = {
  activeKeys: PropTypes.number.isRequired,
  limitedNote: PropTypes.string.isRequired,
  lastUsedValue: PropTypes.string.isRequired,
  lastUsedNote: PropTypes.string.isRequired,
  requireApiKey: PropTypes.bool.isRequired,
  keyRequiredNote: PropTypes.string.isRequired,
};
