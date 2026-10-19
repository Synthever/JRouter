"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";
import styles from "../usage.module.css";
import { formatCompactTokens } from "./chartTheme";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

// Observed window in seconds, derived from the oldest→newest request in the
// selected period (floored to 1s). Falls back to the period length when the
// window is unreliable (e.g. a single old request).
const PERIOD_SECONDS = { today: 86400, "24h": 86400, "7d": 604800, "30d": 2592000, "60d": 5184000 };
function observedSeconds(stats) {
  const start = stats.periodStart ? new Date(stats.periodStart).getTime() : NaN;
  const end = stats.periodEnd ? new Date(stats.periodEnd).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    // Daily dateKeys are local midnights — include the partial day up to now.
    const now = Date.now();
    const windowEnd = end < now && now - end < 86400 * 1000 ? now : end;
    return Math.max(1, (windowEnd - start) / 1000);
  }
  return PERIOD_SECONDS[stats.period] || 86400;
}
const avgReqSec = (s) => (s.totalRequests > 0 ? s.totalRequests / observedSeconds(s) : 0);
const avgTokensSec = (s) => {
  const total = (s.totalPromptTokens || 0) + (s.totalCompletionTokens || 0);
  return total > 0 ? total / observedSeconds(s) : 0;
};
const avgLatencyMs = (s) => (s.latencySamples > 0 ? s.totalLatencyMs / s.latencySamples : 0);
const perMin = (perSec) => perSec * 60;
const fmtRate = (n) => (n >= 100 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1) : n > 0 ? n.toFixed(2) : "0");
const fmtLatency = (ms) => {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
};

export default function OverviewCards({ stats, period = "7d" }) {
  const withPeriod = { ...stats, period };
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
    {
      label: "AVG REQ/MIN",
      icon: "speed",
      value: fmtRate(perMin(avgReqSec(withPeriod))),
      subtitle: "request throughput",
    },
    {
      label: "AVG TOKENS/MIN",
      icon: "bolt",
      value: formatCompactTokens(perMin(avgTokensSec(withPeriod))),
      full: `${fmt(perMin(avgTokensSec(withPeriod)))} tokens/min`,
      subtitle: "token throughput",
    },
    {
      label: "AVG LATENCY",
      icon: "timer",
      value: fmtLatency(avgLatencyMs(withPeriod)),
      subtitle: "avg response time",
    },
  ];

  return (
    <div className="grid-stats-usage min-w-0">
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
  period: PropTypes.string,
  stats: PropTypes.shape({
    totalRequests: PropTypes.number,
    totalPromptTokens: PropTypes.number,
    totalCachedTokens: PropTypes.number,
    totalCompletionTokens: PropTypes.number,
    totalCost: PropTypes.number,
    totalLatencyMs: PropTypes.number,
    latencySamples: PropTypes.number,
    periodStart: PropTypes.string,
    periodEnd: PropTypes.string,
  }).isRequired,
};
