"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Server, ArrowRight } from "lucide-react";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";

const PROVIDER_COLORS = [
  "bg-[var(--text)]",
  "bg-[var(--text-2)]",
  "bg-[var(--text-3)]",
  "bg-[var(--pos)]",
  "bg-[var(--warn)]",
  "bg-[var(--promo-accent)]",
  "bg-zinc-400",
];

export default function ProviderDistributionCard({ stats }) {
  const providers = useMemo(() => {
    const raw = stats?.byProvider || {};
    const totalReqs = stats?.totalRequests || 1;

    const list = Object.entries(raw).map(([name, data], idx) => {
      const reqs = data.requests || 0;
      const share = totalReqs > 0 ? (reqs / totalReqs) * 100 : 0;
      return {
        name,
        requests: reqs,
        tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
        cost: data.cost || 0,
        share: share.toFixed(1),
        shareNum: share,
        color: PROVIDER_COLORS[idx % PROVIDER_COLORS.length],
      };
    });

    list.sort((a, b) => b.requests - a.requests);
    return list;
  }, [stats]);

  return (
    <div className="ui-card p-5 flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="ui-eyebrow text-[10px] text-[var(--text-2)]">
              PROVIDER DISTRIBUTION
            </span>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-3)] u-tnum">
            {providers.length} upstream sources
          </span>
        </div>

        {/* Proportional Segment Bar */}
        {providers.length > 0 && (
          <div className="mb-4">
            <div className="h-2 w-full bg-[var(--surface-inset)] border border-[var(--line)] rounded-full overflow-hidden flex gap-0.5">
              {providers.map((p) => (
                <div
                  key={p.name}
                  style={{ width: `${Math.max(p.shareNum, 2)}%` }}
                  className={`h-full ${p.color} transition-all`}
                  title={`${p.name}: ${p.share}%`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Provider List */}
        <div className="space-y-2.5">
          {providers.length > 0 ? (
            providers.slice(0, 5).map((p) => (
              <div
                key={p.name}
                className="dashboard-card-inset flex items-center justify-between p-2.5 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`size-2 rounded-full ${p.color}`} />
                  <span className="text-[var(--text)] font-medium capitalize truncate max-w-[140px] sm:max-w-[200px]">
                    {p.name}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-right shrink-0">
                  <span className="text-[var(--text-3)] text-[11px] u-tnum">
                    {fmtTokens(p.tokens)}
                  </span>
                  <span className="text-[var(--text-3)] text-[11px] u-tnum">
                    {fmtCost(p.cost)}
                  </span>
                  <span className="text-[var(--text)] font-semibold u-tnum w-12">
                    {p.share}%
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="dashboard-card-inset text-center py-8 text-xs font-mono text-[var(--text-3)] border border-dashed border-[var(--line)] rounded-[var(--r2)] bg-[var(--surface-inset)]">
              No provider traffic logged for this period.
            </div>
          )}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-3 mt-4 border-t border-[var(--line)] flex items-center justify-between text-xs font-mono">
        <Link
          href="/dashboard/providers"
          className="text-[var(--text-2)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
        >
          <span>Manage Upstreams</span>
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
