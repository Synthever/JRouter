"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Cpu, ArrowUpRight, ArrowDownLeft, ArrowRight } from "lucide-react";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";

export default function TopModelsCard({ stats }) {
  const models = useMemo(() => {
    const raw = stats?.byModel || {};
    const list = Object.entries(raw).map(([key, data]) => ({
      key,
      name: data.rawModel || key.split(" (")[0] || key,
      provider: data.provider || "Direct",
      requests: data.requests || 0,
      promptTokens: data.promptTokens || 0,
      completionTokens: data.completionTokens || 0,
      cost: data.cost || 0,
    }));

    list.sort((a, b) => b.requests - a.requests);
    return list.slice(0, 6);
  }, [stats]);

  const maxRequests = models.length > 0 ? models[0].requests : 1;
  const totalModelRequests = models.reduce((acc, m) => acc + m.requests, 0) || 1;

  return (
    <div className="ui-card p-5 flex flex-col justify-between">
      <div>
        {/* Card Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              TOP MODELS BY VOLUME
            </span>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-3)] u-tnum">
            {models.length} active models
          </span>
        </div>

        {/* Model Ranking List */}
        <div className="space-y-3 mt-3">
          {models.length > 0 ? (
            models.map((m, idx) => {
              const pctOfMax = Math.round((m.requests / maxRequests) * 100);
              const sharePct = ((m.requests / totalModelRequests) * 100).toFixed(1);

              return (
                <div key={m.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[var(--text-3)] font-semibold w-4 text-[10px] u-tnum">
                        0{idx + 1}
                      </span>
                      <span className="text-[var(--text)] font-medium truncate max-w-[160px] sm:max-w-[220px]" title={m.name}>
                        {m.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-[var(--r1)] bg-transparent border border-white text-[10px] text-white font-mono">
                        {m.provider}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <span className="text-[var(--text)] u-tnum font-semibold">
                        {m.requests.toLocaleString()}
                      </span>
                      <span className="text-[var(--text-3)] text-[11px] w-9 u-tnum">
                        {sharePct}%
                      </span>
                    </div>
                  </div>

                  {/* Horizontal visual progress track */}
                  <div className="h-1 w-full bg-[var(--surface-inset)] border border-[var(--line)] rounded-full overflow-hidden">
                    <div
                      style={{ width: `${pctOfMax}%` }}
                      className="h-full bg-[var(--text-2)] rounded-full transition-all duration-300"
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="dashboard-card-inset text-center py-8 text-xs font-mono text-[var(--text-3)] border border-dashed border-[var(--line)] rounded-[var(--r2)] bg-[var(--surface-inset)]">
              No model usage records found in this time range.
            </div>
          )}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-3 mt-4 border-t border-[var(--line)] flex items-center justify-between text-xs font-mono">
        <Link
          href="/dashboard/combos"
          className="text-[var(--text-2)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
        >
          <span>View Combos & Adapters</span>
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
