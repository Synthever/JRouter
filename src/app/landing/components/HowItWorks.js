"use client";
import Icon from "@/shared/components/Icon";

import AppLogo from "@/shared/components/AppLogo";

export default function HowItWorks() {
  return (
    <section className="lp-section bg-transparent border-none" id="how-it-works">
      <div className="lp-wrap">
        <div className="mb-12">
          <div className="lp-eyebrow mb-3">
            <span className="lp-eyebrow__dot"></span>
            <span>SYSTEM ARCHITECTURE</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
            How JRouter Operates
          </h2>
          <p className="text-sm text-[var(--text-2)] max-w-xl leading-relaxed">
            Transparent proxy translation between standard developer SDKs and heterogeneous upstream APIs with automatic fallback and caching.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Step 1: Client CLI & SDKs */}
          <div className="p-6 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] flex flex-col gap-4">
            <div className="size-11 rounded-[var(--r2)] bg-[var(--surface-2)] border border-[var(--line-2)] flex items-center justify-center text-[var(--text)]">
              <Icon className="text-[20px]">terminal</Icon>
            </div>
            <div>
              <div className="text-[11px] font-mono text-[var(--text-3)] mb-1 uppercase tracking-[0.2em]">Step 01</div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-1">Developer Clients</h3>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Requests originate from CLI tools (Claude Code, Codex, Cline) or standard OpenAI SDKs pointing to localhost:20128.
              </p>
            </div>
          </div>

          {/* Step 2: JRouter Gateway */}
          <div className="p-6 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] flex flex-col gap-4">
            <div className="size-11 rounded-[var(--r2)] bg-[var(--surface-2)] border border-[var(--accent-line)] flex items-center justify-center text-[var(--text)]">
              <AppLogo size={24} />
            </div>
            <div>
              <div className="text-[11px] font-mono text-[var(--text-3)] mb-1 uppercase tracking-[0.2em]">Step 02</div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-1">JRouter Engine</h3>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Translates request payload into provider-native format, compresses tool tokens, verifies quotas, and routes across accounts.
              </p>
            </div>
          </div>

          {/* Step 3: Upstream Providers */}
          <div className="p-6 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] flex flex-col gap-4">
            <div className="size-11 rounded-[var(--r2)] bg-[var(--surface-2)] border border-[var(--line-2)] flex items-center justify-center text-[var(--text)]">
              <Icon className="text-[20px]">dns</Icon>
            </div>
            <div>
              <div className="text-[11px] font-mono text-[var(--text-3)] mb-1 uppercase tracking-[0.2em]">Step 03</div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-1">Upstream Providers</h3>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Dispatches upstream to Anthropic, OpenAI, Gemini, or local models, streaming SSE responses back with zero translation latency.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

