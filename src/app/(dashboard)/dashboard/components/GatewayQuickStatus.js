"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function GatewayQuickStatus({
  stats = {},
  machineId = "",
}) {
  const [baseUrl, setBaseUrl] = useState("http://localhost:20128/v1");
  const { copied, copy } = useCopyToClipboard(1500);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  const activeRequests = stats?.activeRequests || [];
  const pendingRequests = stats?.pending?.total || 0;
  const isBusy = activeRequests.length > 0 || pendingRequests > 0;

  const quickActions = [
    { label: "Endpoint & Keys", icon: "api", href: "/dashboard/endpoint", desc: "Manage client API keys" },
    { label: "Providers", icon: "dns", href: "/dashboard/providers", desc: "Connect LLM accounts" },
    { label: "Combos & Fallback", icon: "layers", href: "/dashboard/combos", desc: "Model combo chains" },
    { label: "Quota Tracker", icon: "data_usage", href: "/dashboard/quota", desc: "Track provider limits" },
    { label: "Token Saver", icon: "savings", href: "/dashboard/token-saver", desc: "Compress tool calls" },
    { label: "Proxy Pools", icon: "lan", href: "/dashboard/proxy-pools", desc: "Rotate egress IPs" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Endpoint Quick Connect Box */}
      <div className="lg:col-span-2 flex flex-col justify-between p-4 sm:p-5 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)]">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[17px] text-[var(--text-3)]">terminal</span>
              <span className="text-[11px] font-mono font-medium tracking-[0.2em] text-[var(--text-3)] uppercase">
                OpenAI-Compatible Gateway Endpoint
              </span>
            </div>
            <Link
              href="/dashboard/endpoint"
              className="text-xs font-mono text-[var(--text-2)] hover:text-[var(--text)] inline-flex items-center gap-1 group transition-colors"
            >
              <span>Settings</span>
              <span className="material-symbols-outlined text-[13px] group-hover:translate-x-0.5 transition-transform">
                arrow_forward
              </span>
            </Link>
          </div>

          <p className="text-xs text-[var(--text-2)] mb-3">
            Route any OpenAI-compatible SDK, Claude Code, Cursor, or Cline client through 9Router.
          </p>

          {/* Copyable snippet well */}
          <div className="flex items-center gap-2 p-2 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)]">
            <code className="flex-1 font-mono text-xs text-[var(--text)] truncate select-all px-1">
              {baseUrl}
            </code>
            <button
              onClick={() => copy(baseUrl)}
              className="px-2.5 py-1 text-xs font-mono font-medium rounded-[var(--r1)] bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line-2)] hover:bg-[var(--surface-hover)] transition-colors inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[13px]">
                {copied ? "check" : "content_copy"}
              </span>
              <span>{copied ? "Copied!" : "Copy URL"}</span>
            </button>
          </div>
        </div>

        {/* Live Active Stream status */}
        <div className="mt-4 pt-3 border-t border-[var(--line)] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {isBusy && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--pos)] opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isBusy ? "bg-[var(--pos)]" : "bg-[var(--text-3)]"
                }`}
              />
            </span>
            <span className="text-[var(--text-2)]">
              {isBusy
                ? `Active Streams: ${activeRequests.length} in-flight`
                : "Gateway Idle: Ready for incoming connections"}
            </span>
          </div>

          {machineId && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
              <span>Node ID:</span>
              <span className="text-[var(--text-2)] font-mono">{machineId.slice(0, 12)}...</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Navigation Jump Matrix */}
      <div className="flex flex-col justify-between p-4 sm:p-5 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)]">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[17px] text-[var(--text-3)]">explore</span>
            <span className="text-[11px] font-mono font-medium tracking-[0.2em] text-[var(--text-3)] uppercase">
              Routing Shortcuts
            </span>
          </div>
          <p className="text-xs text-[var(--text-2)] mb-3">
            Quick jump to subsystem controls and routing pipelines.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {quickActions.map((act) => (
            <Link
              key={act.label}
              href={act.href}
              className="p-2 rounded-[var(--r2)] bg-[var(--surface-inset)] border border-[var(--line)] hover:border-[var(--accent-line)] hover:bg-[var(--surface-2)] transition-all flex flex-col gap-0.5 group"
            >
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px] text-[var(--text-3)] group-hover:text-[var(--text)] transition-colors">
                  {act.icon}
                </span>
                <span className="text-xs font-medium text-[var(--text)] truncate">
                  {act.label}
                </span>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-3)] truncate">
                {act.desc}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

GatewayQuickStatus.propTypes = {
  stats: PropTypes.object,
  machineId: PropTypes.string,
};
