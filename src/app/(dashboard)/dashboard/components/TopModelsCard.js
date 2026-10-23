"use client";

import React, { useMemo, useId } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./DashboardAnalytics.module.css";

const MODEL_COLORS = [
  "var(--brand-pink)",
  "var(--brand-lavender)",
  "var(--brand-peach)",
  "var(--brand-ochre)",
  "var(--brand-mint)",
  "var(--text-2)",
];

export default function TopModelsCard({ stats }) {
  const headingId = useId();
  const models = useMemo(() => {
    const raw = stats?.byModel || {};
    const list = Object.entries(raw).map(([key, data]) => ({
      key,
      name: data.rawModel || key.split(" (")[0] || key,
      provider: data.provider || "Direct",
      requests: data.requests || 0,
    }));
    list.sort((a, b) => b.requests - a.requests);
    return list.slice(0, 6);
  }, [stats]);

  // Keep the existing top-six denominator, and label that scope when truncated.
  const totalModelRequests = models.reduce((sum, model) => sum + model.requests, 0) || 1;
  const truncated = Object.keys(stats?.byModel || {}).length > models.length;

  return (
    <section className={`${styles.panel} ${styles.filledPanel}`} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <h2 id={headingId} className={styles.title}>Top models</h2>
          <p className={styles.subtitle}>
            {truncated ? "Top 6 models, ranked by requests" : `${models.length} active ${models.length === 1 ? "model" : "models"}, ranked by requests`}
          </p>
        </div>
      </div>

      {models.length > 0 ? (
        <ol className={styles.modelList} aria-label="Models ranked by request volume">
          {models.map((model, index) => {
            const share = (model.requests / totalModelRequests) * 100;
            return (
              <li key={model.key} className={styles.modelItem}>
                <div className={styles.modelRow}>
                  <div className={styles.modelIdentity}>
                    <span className={styles.modelName} title={model.name}>{model.name}</span>
                    <span className={styles.modelProvider}>{model.provider}</span>
                  </div>
                  <div className={styles.modelValue}>
                    <strong title={`${model.requests.toLocaleString()} requests`}>{model.requests.toLocaleString()}</strong>
                    <span title="Share of requests among the displayed models">{share.toFixed(1)}%</span>
                  </div>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <span style={{ width: `${share}%`, backgroundColor: MODEL_COLORS[index] }} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.emptyState}>No model usage records found in this time range.</p>
      )}

      <div className={styles.footer}>
        {truncated && <p className={styles.subtitle}>Shares are relative to these six models.</p>}
        <Link href="/dashboard/combos" className={styles.navigation}>
          <span>View combos and adapters</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
