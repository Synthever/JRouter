"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import styles from "../../../media-providers.module.css";

// Only show fields the user actually cares about
const FIELD_SCHEMA = {
  mode:             { label: "Mode",       format: (v) => v },
  defaultModel:     { label: "Model",      format: (v) => v, mono: true },
  baseUrl:          { label: "Endpoint",   format: (v) => v, isLink: true, mono: true },
  costPerQuery:     { label: "Cost / call", format: (v) => v === 0 ? "Free" : `$${v.toFixed(4)}` },
  pricingUrl:       { label: "Pricing",    format: () => "View pricing", isLink: true },
  freeTier:         { label: "Free tier",  format: (v) => v },
  freeMonthlyQuota: { label: "Free quota",  format: (v) => v === 0 ? "—" : v >= 999999 ? "Unlimited" : `${v.toLocaleString()} / mo` },
  searchTypes:      { label: "Types",      format: (v) => v.join(", ") },
  formats:          { label: "Formats",    format: (v) => v.join(", ") },
  maxMaxResults:    { label: "Max results", format: (v) => v },
  maxCharacters:    { label: "Max chars",  format: (v) => v.toLocaleString() },
};

/** Config panel for a media provider: label/value rows in the media theme. */
export default function ProviderConfigPanel({ config, provider, title = "Provider Info" }) {
  if (!config) return null;

  const rows = Object.entries(FIELD_SCHEMA)
    .filter(([key]) => config[key] !== undefined && config[key] !== null && config[key] !== "")
    .map(([key, schema]) => ({
      key,
      label: schema.label,
      value: schema.format(config[key]),
      isLink: schema.isLink,
      mono: schema.mono,
      raw: config[key],
    }));

  const signupUrl = provider?.notice?.apiKeyUrl || provider?.website;
  const noticeText = provider?.notice?.text;

  return (
    <section className={styles.panel} aria-labelledby="media-config-heading">
      <div className={styles.panelHead}>
        <div className="min-w-0">
          <h2 id="media-config-heading" className={styles.panelTitle}>
            <Icon className={styles.panelIcon}>settings</Icon> {title}
          </h2>
          <p className={styles.panelDesc}>How the gateway calls this provider.</p>
        </div>
        {signupUrl && (
          <div className={styles.panelActions}>
            <a
              className={styles.detailLink}
              href={signupUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon className="text-[14px]">open_in_new</Icon>
              Get API Key
            </a>
          </div>
        )}
      </div>

      <div className={styles.kvGrid}>
        {rows.map((row) => (
          <div key={row.key} className={styles.kvRow}>
            <span className={styles.kvLabel}>{row.label}</span>
            {row.isLink ? (
              <a
                href={row.raw}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.kvValue} ${styles.kvLink} ${row.mono ? styles.kvValueMono : ""}`}
              >
                {row.value}
              </a>
            ) : (
              <span className={`${styles.kvValue} ${row.mono ? styles.kvValueMono : ""}`}>
                {row.value}
              </span>
            )}
          </div>
        ))}
        {noticeText && (
          <div className={`${styles.kvRow} ${styles.kvWide}`}>
            <span className={styles.kvLabel}>Notice</span>
            <span className={styles.kvValue}>{noticeText}</span>
          </div>
        )}
      </div>
    </section>
  );
}

ProviderConfigPanel.propTypes = {
  config: PropTypes.object,
  provider: PropTypes.object,
  title: PropTypes.string,
};
