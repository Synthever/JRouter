"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import styles from "./HealthStats.module.css";

const LAYOUT_STORAGE_KEY = "jrouter.health.statsLayout.v1";

const ITEMS = [
  { id: "availability", title: "Availability", defaultSpan: 2 },
  { id: "attention", title: "Attention", defaultSpan: 2 },
  { id: "latency", title: "Average latency", defaultSpan: 2 },
];

const DEFAULT_LAYOUT = normalizeLayout(null, ITEMS);

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Health summary as movable, resizable widgets persisted per browser. */
export default function HealthStats({
  availabilityValue,
  availabilityUnit,
  availabilityNote,
  attentionCount,
  attentionNote,
  latencyValue,
  latencyNote,
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
      ...ITEMS.find((entry) => entry.id === "availability"),
      render: () => (
        <div className={styles.metric}>
          <p className={`${styles.value} ${availabilityUnit ? "" : styles.valueName}`}>
            {availabilityValue}
            {availabilityUnit && <small className={styles.unit}>{availabilityUnit}</small>}
          </p>
          <p className={styles.note}>{availabilityNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((entry) => entry.id === "attention"),
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{attentionCount}</p>
          <p className={styles.note}>{attentionNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS.find((entry) => entry.id === "latency"),
      render: () => (
        <div className={styles.metric}>
          <p className={`${styles.value} ${styles.valueName}`}>{latencyValue}</p>
          <p className={styles.note}>{latencyNote}</p>
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Health summary">
      <div className={styles.stats}>
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

HealthStats.propTypes = {
  availabilityValue: PropTypes.string.isRequired,
  availabilityUnit: PropTypes.string,
  availabilityNote: PropTypes.string.isRequired,
  attentionCount: PropTypes.number.isRequired,
  attentionNote: PropTypes.string.isRequired,
  latencyValue: PropTypes.string.isRequired,
  latencyNote: PropTypes.string.isRequired,
};
