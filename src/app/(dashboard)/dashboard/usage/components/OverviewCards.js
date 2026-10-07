"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import styles from "../usage.module.css";
import { formatCompactTokens } from "./chartTheme";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const cards = [
    {
      label: "TOTAL REQUESTS",
      icon: "send",
      value: fmt(stats.totalRequests),
      subtitle: "all requests",
    },
    {
      label: "INPUT TOKENS",
      icon: "arrow_upward",
      value: formatCompactTokens(stats.totalPromptTokens),
      full: fmt(stats.totalPromptTokens),
      subtitle: "prompt volume",
    },
    {
      label: "CACHED TOKENS",
      icon: "memory",
      value: formatCompactTokens(stats.totalCachedTokens),
      full: fmt(stats.totalCachedTokens),
      subtitle: "cache hits",
    },
    {
      label: "OUTPUT TOKENS",
      icon: "arrow_downward",
      value: formatCompactTokens(stats.totalCompletionTokens),
      full: fmt(stats.totalCompletionTokens),
      subtitle: "completion volume",
    },
    {
      label: "EST. COST",
      icon: "attach_money",
      value: `~${fmtCost(stats.totalCost)}`,
      subtitle: "estimated billing",
    },
  ];

  return (
    <div className="grid-stats min-w-0">
      {cards.map((card) => (
        <div key={card.label} className={`ui-card ${styles.metric}`}>
          <div className={styles.metricHead}>
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">{card.label}</span>
            <Icon className="shrink-0 text-[16px] text-[var(--text-2)]">{card.icon}</Icon>
          </div>
          <div>
            <div className={`${styles.metricValue} u-tnum`} title={card.full || card.value}>{card.value}</div>
            <div className={styles.metricMeta}>{card.subtitle}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.shape({
    totalRequests: PropTypes.number,
    totalPromptTokens: PropTypes.number,
    totalCachedTokens: PropTypes.number,
    totalCompletionTokens: PropTypes.number,
    totalCost: PropTypes.number,
  }).isRequired,
};
