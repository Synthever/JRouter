"use client";

import PropTypes from "prop-types";

export const fmt = (n) => new Intl.NumberFormat().format(n || 0);

export const fmtTokens = (n) => {
  if (n === null || n === undefined) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return fmt(n);
};

export const fmtCost = (n) => {
  if (!n) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};

export default function DashboardStatCards({ stats = {}, loading = false }) {
  const totalRequests = stats?.totalRequests ?? 0;
  const promptTokens = stats?.totalPromptTokens ?? 0;
  const completionTokens = stats?.totalCompletionTokens ?? 0;
  const cachedTokens = stats?.totalCachedTokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const totalCost = stats?.totalCost ?? 0;
  const successRate = stats?.successRate ?? (totalRequests > 0 ? 100 : 100);
  const failedRequests = stats?.failedRequests ?? 0;
  const successfulRequests = stats?.successfulRequests ?? (totalRequests - failedRequests);

  const activeConns = stats?.activeConnectionsCount ?? 0;
  const totalConns = stats?.connectionsCount ?? 0;
  const totalNodes = stats?.nodesCount ?? 0;

  const successColor =
    successRate >= 98
      ? "text-[var(--pos)]"
      : successRate >= 90
      ? "text-[var(--warn)]"
      : "text-[var(--danger)]";

  const cards = [
    {
      label: "TOTAL REQUESTS",
      icon: "swap_vert",
      value: fmt(totalRequests),
      subtitle: totalRequests > 0 ? `${fmt(successfulRequests)} succeeded` : "No traffic in period",
      valueColor: "text-[var(--text)]",
      badge: totalRequests > 0 ? `${fmt(totalRequests)} reqs` : null,
      badgeColor: "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--line)]",
    },
    {
      label: "SUCCESS RATE",
      icon: "verified",
      value: `${successRate}%`,
      subtitle: failedRequests > 0 ? `${failedRequests} failed requests` : "All systems nominal",
      valueColor: successColor,
      badge: failedRequests > 0 ? `${failedRequests} err` : "100% OK",
      badgeColor:
        failedRequests > 0
          ? "bg-[#281515] text-[var(--danger)] border-[#FF6B6B]/20"
          : "bg-[#14251D] text-[var(--pos)] border-[#34D39A]/20",
    },
    {
      label: "TOTAL TOKENS (IN / OUT)",
      icon: "data_usage",
      value: fmtTokens(totalTokens),
      subtitle: `${fmtTokens(promptTokens)} in ↑ · ${fmtTokens(completionTokens)} out ↓`,
      valueColor: "text-[var(--text)]",
      badge: cachedTokens > 0 ? `+${fmtTokens(cachedTokens)} cache` : null,
      badgeColor: "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--line)]",
    },
    {
      label: "ESTIMATED COST",
      icon: "attach_money",
      value: fmtCost(totalCost),
      subtitle: totalTokens > 0 ? `~$${((totalCost / Math.max(1, totalTokens)) * 1000).toFixed(4)}/1K tok` : "Upstream token billing",
      valueColor: "text-[var(--warn)]",
      badge: "USD",
      badgeColor: "bg-[#261F12] text-[var(--warn)] border-[#F2B34B]/20",
    },
    {
      label: "CONNECTIONS & NODES",
      icon: "hub",
      value: `${activeConns}/${totalConns}`,
      subtitle: `${totalNodes} custom nodes configured`,
      valueColor: "text-[var(--text)]",
      badge: `${activeConns} Active`,
      badgeColor: activeConns > 0 ? "bg-[#14251D] text-[var(--pos)] border-[#34D39A]/20" : "bg-[var(--surface-2)] text-[var(--text-3)] border-[var(--line)]",
    },
  ];

  return (
    <div className="grid-stats min-w-0">
      {cards.map((card, i) => (
        <div
          key={card.label || i}
          className="group relative flex min-w-0 flex-col justify-between p-4 sm:p-5 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] transition-all hover:border-[var(--accent-line)]"
        >
          {/* Top highlight Catchlight */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-[11px] font-mono font-medium tracking-[0.2em] text-[var(--text-3)] truncate uppercase">
              {card.label}
            </span>
            <span className="material-symbols-outlined text-[17px] text-[var(--text-3)] shrink-0 group-hover:text-[var(--text)] transition-colors">
              {card.icon}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            {loading ? (
              <div className="h-8 w-24 bg-[var(--surface-2)] animate-pulse rounded-[var(--r1)] my-0.5" />
            ) : (
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <span
                  className={`text-2xl sm:text-[26px] font-mono font-semibold tracking-tight u-tnum truncate ${card.valueColor}`}
                  title={card.value}
                >
                  {card.value}
                </span>
                {card.badge && (
                  <span className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                )}
              </div>
            )}
            <span className="text-[11px] font-mono text-[var(--text-3)] truncate" title={card.subtitle}>
              {card.subtitle}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

DashboardStatCards.propTypes = {
  stats: PropTypes.shape({
    totalRequests: PropTypes.number,
    successfulRequests: PropTypes.number,
    failedRequests: PropTypes.number,
    successRate: PropTypes.number,
    totalPromptTokens: PropTypes.number,
    totalCompletionTokens: PropTypes.number,
    totalCachedTokens: PropTypes.number,
    totalCost: PropTypes.number,
    connectionsCount: PropTypes.number,
    activeConnectionsCount: PropTypes.number,
    nodesCount: PropTypes.number,
  }),
  loading: PropTypes.bool,
};
