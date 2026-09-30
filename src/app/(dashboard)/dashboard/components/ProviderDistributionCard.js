"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Server, ArrowRight } from "lucide-react";
import { fmtTokens, fmtCost } from "./KpiBentoGrid";

const PROVIDER_COLORS = [
  "bg-zinc-200",
  "bg-zinc-400",
  "bg-zinc-600",
  "bg-emerald-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-indigo-400",
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
    <div className="rounded-xl border border-zinc-800/80 bg-[#0E0F12] p-5 flex flex-col justify-between shadow-xs">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-400">
              PROVIDER DISTRIBUTION
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            {providers.length} upstream sources
          </span>
        </div>

        {/* Proportional Segment Bar */}
        {providers.length > 0 && (
          <div className="mb-4">
            <div className="h-2 w-full bg-zinc-800/80 rounded-full overflow-hidden flex gap-0.5">
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
                className="flex items-center justify-between p-2 rounded-lg bg-[#0A0B0D] border border-zinc-800/60 text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`size-2 rounded-full ${p.color}`} />
                  <span className="text-zinc-200 font-medium capitalize truncate max-w-[140px] sm:max-w-[180px]">
                    {p.name}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-right shrink-0">
                  <span className="text-zinc-400 text-[11px]">
                    {fmtTokens(p.tokens)}
                  </span>
                  <span className="text-zinc-400 text-[11px]">
                    {fmtCost(p.cost)}
                  </span>
                  <span className="text-white font-semibold tabular-nums w-12">
                    {p.share}%
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs font-mono text-zinc-400 border border-dashed border-zinc-800/60 rounded-md">
              No provider traffic logged for this period.
            </div>
          )}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-3 mt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono">
        <Link
          href="/dashboard/providers"
          className="text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          <span>Manage Upstreams</span>
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
