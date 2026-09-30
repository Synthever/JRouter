"use client";

const FEATURES = [
  { 
    icon: "link", 
    title: "Unified Endpoint", 
    desc: "Single OpenAI-compatible /v1/chat/completions route for 40+ providers.", 
  },
  { 
    icon: "shield", 
    title: "Model Fallback", 
    desc: "Automatic failover across providers, models, and credentials on rate-limits.", 
  },
  { 
    icon: "savings", 
    title: "RTK Token Saver", 
    desc: "In-place tool result compression reducing prompt token overhead up to 60%.", 
  },
  { 
    icon: "monitoring", 
    title: "Usage Analytics", 
    desc: "Real-time tabular telemetry, latency metrics, and quota tracking.", 
  },
  { 
    icon: "vpn_key", 
    title: "Credential Vault", 
    desc: "AES-encrypted local SQLite storage for OAuth tokens and raw API keys.", 
  },
  { 
    icon: "lan", 
    title: "Proxy Pools", 
    desc: "Dynamic outbound socks5/http proxy rotation with health ping checks.", 
  },
  { 
    icon: "terminal", 
    title: "CLI Tool Native", 
    desc: "First-class compatibility with Claude Code, Codex, Cline, and Roo.", 
  },
  { 
    icon: "translate", 
    title: "Format Translation", 
    desc: "Direct AST translation between Anthropic, Gemini, Kiro, and OpenAI formats.", 
  },
];

export default function Features() {
  return (
    <section className="lp-section bg-[var(--bg-2)]/40" id="features">
      <div className="lp-wrap">
        <div className="mb-12">
          <div className="lp-eyebrow mb-3">
            <span className="lp-eyebrow__dot"></span>
            <span>CAPABILITIES</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
            Core Routing Infrastructure
          </h2>
          <p className="text-sm text-[var(--text-2)] max-w-xl leading-relaxed">
            High-throughput format translation, model fallbacks, and token metrics built on a clean local SQLite substrate.
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature) => (
            <div 
              key={feature.title}
              className="p-5 rounded-[var(--r3)] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-card)] hover:border-[var(--accent-line)] transition-all flex flex-col justify-between"
            >
              <div>
                <div className="size-9 rounded-[var(--r1)] bg-[var(--surface-2)] border border-[var(--line-2)] flex items-center justify-center text-[var(--text)] mb-3">
                  <span className="material-symbols-outlined text-[18px]">{feature.icon}</span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)] mb-1">{feature.title}</h3>
                <p className="text-xs text-[var(--text-2)] leading-relaxed">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

