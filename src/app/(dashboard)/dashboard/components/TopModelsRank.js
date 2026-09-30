"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { fmt, fmtTokens, fmtCost } from "./DashboardStatCards";

export default function TopModelsRank({ byModel = {}, loading = false }) {
  const [metric, setMetric] = useState("requests");

  const rankedModels = useMemo(() => {
    if (!byModel || typeof byModel !== "object") return [];

    const list = Object.entries(byModel).map(([key, data]) => {
      const rawModel = data.rawModel || key.split(" (")[0] || key;
      const provider = data.provider || (key.includes("(") ? key.match(/\((.*?)\)/)?.[1] : "") || "unknown";
      const requests = data.requests || 0;
      const tokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const cost = data.cost || 0;
      return {
        key,
        model: rawModel,
        provider,
        requests,
        tokens,
        cost,
      };
    });

    list.sort((a, b) => b[metric] - a[metric]);
    return list;
  }, [byModel, metric]);

  const topValue = rankedModels.length > 0 ? rankedModels[0][metric] || 1 : 1;
  const totalMetric = useMemo(() => {
    return rankedModels.reduce((sum, m) => sum + (m[metric] || 0), 0) || 1;
  }, [rankedModels, metric]);

  return (
    <div className="flex min-w-0 flex-col rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="material-symbols-outlined text-[16px] text-[var(--text-3)]">stars</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Top Models
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-3)]">
            Ranked by total utilization
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
          <button
            onClick={() => setMetric("cost")}
            className={`px-2 py-0.5 text-xs font-mono transition-colors rounded-[var(--r1)] cursor-pointer ${
              metric === "cost"
                ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line-2)] shadow-sm font-medium"
                : "text-[var(--text-3)] hover:text-[var(--text)] border border-transparent"
            }`}
          >
            Cost
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-2">
          <div className="w-5 h-5 border-2 border-[var(--line-2)] border-t-[var(--text)] rounded-full animate-spin" />
          <span className="font-mono">Loading model breakdown...</span>
        </div>
      ) : !rankedModels.length ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--text-3)] text-xs gap-1.5 border border-dashed border-[var(--line)] rounded-[var(--r2)]">
          <span className="material-symbols-outlined text-[28px] opacity-40">smart_toy</span>
          <span className="font-mono">No model requests logged yet</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[320px] custom-scrollbar pr-1">
          {rankedModels.slice(0, 10).map((m, idx) => {
            const val = m[metric] || 0;
            const pctShare = Math.round((val / totalMetric) * 100);
            const barWidth = Math.max(3, Math.round((val / topValue) * 100));

            return (
              <div
                key={m.key || idx}
                className="group p-2.5 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] hover:border-[var(--accent-line)] transition-all flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-mono font-semibold text-[var(--text-3)] w-4 text-center shrink-0">
                      #{idx + 1}
                    </span>
                    <span
                      className="font-mono text-xs font-medium text-[var(--text)] truncate"
                      title={m.model}
                    >
                      {m.model}
                    </span>
                    {m.provider && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--line)] shrink-0 truncate max-w-[90px]">
                        {m.provider}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-medium u-tnum text-[var(--text)]">
                      {metric === "requests"
                        ? `${fmt(m.requests)} reqs`
                        : metric === "tokens"
                        ? fmtTokens(m.tokens)
                        : fmtCost(m.cost)}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-3)] w-8 text-right u-tnum">
                      {pctShare}%
                    </span>
                  </div>
                </div>

                {/* Micro Progress Track */}
                <div className="h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[var(--text)] to-[var(--text-2)]"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

TopModelsRank.propTypes = {
  byModel: PropTypes.object,
  loading: PropTypes.bool,
};
