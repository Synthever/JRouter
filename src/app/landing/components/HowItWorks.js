"use client";
import { useState, useEffect, useRef } from "react";
import Icon from "@/shared/components/Icon";
import AppLogo from "@/shared/components/AppLogo";

export default function HowItWorks() {
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
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="lp-section bg-transparent border-none" id="how-it-works">
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
            <span>SYSTEM ARCHITECTURE</span>
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
            How JRouter Operates
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
            Transparent proxy translation between standard developer SDKs and heterogeneous upstream APIs with automatic fallback and caching.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Step 1: Client CLI & SDKs */}
          <div
            className="p-6 rounded-[var(--r3)] bg-black/30 backdrop-blur-xl border-0 shadow-2xl shadow-black/80 flex flex-col gap-4"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(32px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.35s, opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.35s",
              willChange: "transform, opacity",
            }}
          >
            <div className="text-[var(--text)] flex items-center">
              <Icon className="text-[24px]">terminal</Icon>
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
          <div
            className="p-6 rounded-[var(--r3)] bg-black/30 backdrop-blur-xl border-0 shadow-2xl shadow-black/80 flex flex-col gap-4"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(32px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.48s, opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.48s",
              willChange: "transform, opacity",
            }}
          >
            <div className="text-[var(--text)] flex items-center">
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
          <div
            className="p-6 rounded-[var(--r3)] bg-black/30 backdrop-blur-xl border-0 shadow-2xl shadow-black/80 flex flex-col gap-4"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(32px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.61s, opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.61s",
              willChange: "transform, opacity",
            }}
          >
            <div className="text-[var(--text)] flex items-center">
              <Icon className="text-[24px]">dns</Icon>
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

