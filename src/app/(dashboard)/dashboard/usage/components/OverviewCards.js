"use client";
import Icon from "@/shared/components/Icon";

import PropTypes from "prop-types";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const cards = [
    {
      label: "TOTAL REQUESTS",
      icon: "send",
      value: fmt(stats.totalRequests),
      subtitle: "all requests",
      color: "text-[var(--text)]",
    },
    {
      label: "INPUT TOKENS",
      icon: "arrow_upward",
      value: fmt(stats.totalPromptTokens),
      subtitle: "prompt volume",
      color: "text-[var(--text)]",
    },
    {
      label: "CACHED TOKENS",
      icon: "memory",
      value: fmt(stats.totalCachedTokens),
      subtitle: "cache hits",
      color: "text-[var(--text-2)]",
    },
    {
      label: "OUTPUT TOKENS",
      icon: "arrow_downward",
      value: fmt(stats.totalCompletionTokens),
      subtitle: "completion volume",
      color: "text-[var(--pos)]",
    },
    {
      label: "EST. COST",
      icon: "attach_money",
      value: `~${fmtCost(stats.totalCost)}`,
      subtitle: "estimated billing",
      color: "text-[var(--warn)]",
    },
  ];

  return (
    <div className="grid-stats min-w-0">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex min-w-0 flex-col justify-between p-4 sm:p-5 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] transition-colors"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-[11px] font-mono font-medium tracking-[0.2em] text-[var(--text-3)] truncate">
              {card.label}
            </span>
            <Icon className="text-[16px] text-[var(--text-3)] shrink-0">
              {card.icon}
            </Icon>
          </div>
          <div className="flex flex-col gap-1">
            <span
              className={`text-xl sm:text-2xl font-mono font-semibold tracking-tight u-tnum truncate ${card.color}`}
              title={card.value}
            >
              {card.value}
            </span>
            <span className="text-[11px] font-mono text-[var(--text-3)] truncate">
              {card.subtitle}
            </span>
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
