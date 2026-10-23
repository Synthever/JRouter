"use client";

import React, { useMemo, useId } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";
import styles from "./DashboardAnalytics.module.css";

const PROVIDER_COLORS = [
  "var(--brand-pink)",
  "var(--brand-lavender)",
  "var(--brand-peach)",
  "var(--brand-ochre)",
  "var(--brand-mint)",
  "var(--text-2)",
  "var(--text-3)",
];

export default function ProviderDistributionCard({ stats }) {
  const headingId = useId();
  const providers = useMemo(() => {
    const raw = stats?.byProvider || {};
    const totalReqs = stats?.totalRequests || 1;
    const list = Object.entries(raw).map(([name, data], index) => {
      const requests = data.requests || 0;
      const share = totalReqs > 0 ? (requests / totalReqs) * 100 : 0;
      return {
        name,
        requests,
        tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
        cost: data.cost || 0,
        share: share.toFixed(1),
        shareNum: share,
        color: PROVIDER_COLORS[index % PROVIDER_COLORS.length],
      };
    });
    list.sort((a, b) => b.requests - a.requests);
    return list;
  }, [stats]);

  return (
    <section className={`${styles.panel} ${styles.filledPanel}`} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <h2 id={headingId} className={styles.title}>Provider distribution</h2>
          <p className={styles.subtitle}>{providers.length} upstream {providers.length === 1 ? "source" : "sources"}</p>
        </div>
      </div>

      {providers.length > 0 ? (
        <>
          <div
            className={`${styles.track} ${styles.distribution}`}
            role="img"
            aria-label={`Request share by provider: ${providers.map((provider) => `${provider.name}: ${provider.share}%`).join(", ")}`}
          >
            {providers.map((provider) => (
              <span
                key={provider.name}
                style={{ width: `${provider.shareNum}%`, backgroundColor: provider.color }}
                title={`${provider.name}: ${provider.share}%`}
              />
            ))}
          </div>
          <ul className={styles.providerList} aria-label="Providers ranked by request volume">
            {providers.slice(0, 5).map((provider) => (
              <li key={provider.name} className={styles.providerRow}>
                <div className={styles.providerIdentity}>
                  <span className={styles.dot} style={{ backgroundColor: provider.color }} aria-hidden="true" />
                  <strong title={provider.name}>{provider.name}</strong>
                </div>
                <div className={styles.providerMetrics}>
                  <span title={`${provider.tokens.toLocaleString()} tokens`}>{fmtTokens(provider.tokens)} tokens</span>
                  <span title="Estimated cost">{fmtCost(provider.cost)}</span>
                  <strong title={`${provider.requests.toLocaleString()} requests`}>{provider.share}%</strong>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.emptyState}>No provider traffic logged for this period.</p>
      )}

      <div className={styles.footer}>
        {providers.length > 5 && <p className={styles.subtitle}>Showing the five busiest sources.</p>}
        <Link href="/dashboard/providers" className={styles.navigation}>
          <span>Manage upstreams</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
