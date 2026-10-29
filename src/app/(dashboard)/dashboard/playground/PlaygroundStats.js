"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import styles from "./PlaygroundStats.module.css";

const LAYOUT_STORAGE_KEY = "jrouter.playground.statsLayout.v1";

const ITEMS = [
  { id: "activeTarget", title: "Active target", defaultSpan: 2 },
  { id: "cacheCompression", title: "Cache & compression", defaultSpan: 2 },
  { id: "routingPipeline", title: "Routing pipeline", defaultSpan: 2 },
];

const DEFAULT_LAYOUT = normalizeLayout(null, ITEMS);

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Playground KPIs as movable, resizable widgets persisted per browser. */
export default function PlaygroundStats({
  targetLabel,
  targetNote,
  targetStatus,
  cachePercent,
  cacheNote,
  saverNote,
  hasCache,
  routeLabel,
  routeNote,
  routeStrategy,
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
      ...ITEMS[0],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value} title={targetLabel}>{targetLabel}</p>
          <p className={styles.note}>{targetNote}</p>
          <p className={styles.micro}>{targetStatus}</p>
        </div>
      ),
    },
    {
      ...ITEMS[1],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{hasCache ? `${cachePercent}%` : "—"}</p>
          <p className={styles.note}>{cacheNote}</p>
          <div className={styles.track} aria-hidden="true">
            <span style={{ width: `${hasCache ? cachePercent : 0}%` }} />
          </div>
          <p className={styles.micro}>{saverNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS[2],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{routeLabel}</p>
          <p className={styles.note}>{routeNote}</p>
          <p className={styles.micro}>{routeStrategy}</p>
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Playground summary">
      <WidgetGrid
        items={items}
        key={layoutVersion}
        layout={layout}
        narrowColumns={1}
        onLayoutChange={setLayout}
        onLayoutCommit={saveLayout}
        rowHeight={128}
      />
      <div className={styles.footer}>
        <p>Drag the grip to move a card. Drag its corner to resize.</p>
        <button type="button" onClick={resetLayout} aria-label="Reset layout" className={styles.reset}>
          <RotateCcw size={14} aria-hidden="true" /> Reset layout
        </button>
      </div>
    </section>
  );
}

PlaygroundStats.propTypes = {
  targetLabel: PropTypes.string.isRequired,
  targetNote: PropTypes.string.isRequired,
  targetStatus: PropTypes.string.isRequired,
  cachePercent: PropTypes.number.isRequired,
  cacheNote: PropTypes.string.isRequired,
  saverNote: PropTypes.string.isRequired,
  hasCache: PropTypes.bool.isRequired,
  routeLabel: PropTypes.string.isRequired,
  routeNote: PropTypes.string.isRequired,
  routeStrategy: PropTypes.string.isRequired,
};
