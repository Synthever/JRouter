"use client";
import { useState, useEffect, useRef } from "react";
import Icon from "@/shared/components/Icon";

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
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="lp-section bg-transparent border-none" id="features">
      <div className="lp-wrap">
        <div className="mb-12">
          <div
            className="lp-eyebrow mb-3"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(16px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.05s, opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.05s",
              willChange: "transform, opacity",
            }}
          >
            <span className="lp-eyebrow__dot"></span>
            <span>CAPABILITIES</span>
          </div>
          <h2
            className="text-2xl sm:text-3xl font-semibold text-[var(--text)] tracking-tight mb-3"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.15s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.15s",
              willChange: "transform, opacity",
            }}
          >
            Core Routing Infrastructure
          </h2>
          <p
            className="text-sm text-[var(--text-2)] max-w-xl leading-relaxed"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s",
              willChange: "transform, opacity",
            }}
          >
            High-throughput format translation, model fallbacks, and token metrics built on a clean local SQLite substrate.
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature, idx) => {
            const delay = `${(0.3 + idx * 0.07).toFixed(2)}s`;
            return (
              <div 
                key={feature.title}
                className="p-5 rounded-[var(--r3)] bg-black/30 backdrop-blur-xl border-0 shadow-2xl shadow-black/80 hover:bg-black/40 flex flex-col justify-between"
                style={{
                  transform: isVisible ? "translateY(0) scale(1)" : "translateY(24px) scale(0.96)",
                  opacity: isVisible ? 1 : 0,
                  transition: `transform 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${delay}, opacity 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${delay}, background-color 0.2s`,
                  willChange: "transform, opacity",
                }}
              >
                <div>
                  <div className="text-[var(--text)] flex items-center mb-3">
                    <Icon className="text-[20px]">{feature.icon}</Icon>
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-1">{feature.title}</h3>
                  <p className="text-xs text-[var(--text-2)] leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

