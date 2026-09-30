"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { fmt, fmtTokens, fmtCost } from "./DashboardStatCards";

const PROVIDER_COLORS = [
  "#34D39A", // emerald
  "#38BDF8", // sky
  "#F2B34B", // amber
  "#A78BFA", // purple
  "#FB7185", // rose
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#818CF8", // indigo
  "#FBBF24", // yellow
  "#94A3B8", // slate
];

export default function ProviderDistribution({ byProvider = {}, loading = false }) {
  const [metric, setMetric] = useState("requests");

  const providersList = useMemo(() => {
    if (!byProvider || typeof byProvider !== "object") return [];

    const list = Object.entries(byProvider).map(([providerId, data], idx) => {
      const config = AI_PROVIDERS[providerId] || {};
      const name = config.name || providerId.charAt(0).toUpperCase() + providerId.slice(1);
      const requests = data.requests || 0;
      const tokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const cost = data.cost || 0;
      const color = config.color || PROVIDER_COLORS[idx % PROVIDER_COLORS.length];

      return {
        id: providerId,
        name,
        requests,
        tokens,
        cost,
        color,
      };
    });

    list.sort((a, b) => b[metric] - a[metric]);
    return list;
  }, [byProvider, metric]);

  const totalMetric = useMemo(() => {
    return providersList.reduce((sum, p) => sum + (p[metric] || 0), 0) || 1;
  }, [providersList, metric]);

  return (
    <div className="flex min-w-0 flex-col rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="material-symbols-outlined text-[16px] text-[var(--text-3)]">pie_chart</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Provider Distribution
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-3)]">
            Traffic volume across upstreams
          </span>
        </div>

        {/* Metric Selector */}
        <div className="flex items-center p-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)]">
          <button
            onClick={() => setMetric("requests")}
            className={`px-2 py-0.5 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
              metric === "requests"
                ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
            }`}
          >
            Reqs
          </button>
          <button
            onClick={() => setMetric("tokens")}
            className={`px-2 py-0.5 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
              metric === "tokens"
                ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
            }`}
          >
            Tokens
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-2">
          <div className="w-5 h-5 border-2 border-[var(--line-2)] border-t-[var(--text)] rounded-full animate-spin" />
          <span className="font-mono">Analyzing provider share...</span>
        </div>
      ) : !providersList.length ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-1.5 border border-dashed border-[var(--line)] rounded-[var(--r2)]">
          <span className="material-symbols-outlined text-[28px] opacity-40">dns</span>
          <span className="font-mono">No provider activity recorded</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Multi-segment distribution bar */}
          <div className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--surface-2)] border border-[var(--line)] p-0.5 gap-0.5">
            {providersList.map((p) => {
              const pct = ((p[metric] || 0) / totalMetric) * 100;
              if (pct < 1) return null;
              return (
                <div
                  key={p.id}
                  title={`${p.name}: ${Math.round(pct)}%`}
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: p.color,
                  }}
                />
              );
            })}
          </div>

          {/* Provider List */}
          <div className="flex flex-col gap-2 overflow-y-auto max-h-[290px] custom-scrollbar pr-1">
            {providersList.map((p) => {
              const val = p[metric] || 0;
              const pct = Math.round((val / totalMetric) * 100);

              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-2 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] hover:border-[var(--accent-line)] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <ProviderIcon
                        providerId={p.id}
                        alt={p.name}
                        size={22}
                        className="rounded"
                        fallbackText={p.name?.charAt(0) || "?"}
                        fallbackColor={p.color}
                      />
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-[var(--text)] truncate">
                        {p.name}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--text-3)] truncate">
                        {fmtTokens(p.tokens)} tokens · {fmtCost(p.cost)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-medium u-tnum text-[var(--text)]">
                      {metric === "requests" ? `${fmt(p.requests)} reqs` : fmtTokens(p.tokens)}
                    </span>
                    <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-[var(--r1)] bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line-2)] min-w-[36px] text-center u-tnum">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

ProviderDistribution.propTypes = {
  byProvider: PropTypes.object,
  loading: PropTypes.bool,
};
