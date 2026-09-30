"use client";
import { useRouter } from "next/navigation";

export default function HeroSection() {
  const router = useRouter();

  return (
    <section className="relative pt-28 pb-16 px-6 flex flex-col items-center justify-center overflow-hidden">
      <div className="relative z-10 max-w-3xl w-full text-center flex flex-col items-center gap-6">
        {/* Eyebrow badge */}
        <div className="lp-eyebrow">
          <span className="lp-eyebrow__dot"></span>
          <span>ENTERPRISE AI PROXY GATEWAY</span>
        </div>

        {/* Main heading */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[40px] font-semibold text-[var(--text)] tracking-[-0.03em] leading-[1.12]">
          Unified AI Infrastructure for Developer Workflows
        </h1>

        {/* Description */}
        <p className="text-sm sm:text-base text-[var(--text-2)] max-w-2xl leading-relaxed">
          One OpenAI-compatible endpoint routing traffic across 40+ providers. Zero-leak credentials, model-combo fallback, token compression, and real-time developer telemetry.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 w-full pt-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="ui-btn ui-btn--primary px-5 py-2.5 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Launch Dashboard
          </button>
          <a 
            href="https://github.com/Synthever/JRouter" 
            target="_blank" 
            rel="noopener noreferrer"
            className="ui-btn ui-btn--soft px-5 py-2.5 text-xs sm:text-sm font-medium flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">code</span>
            GitHub Repository
          </a>
        </div>
      </div>
    </section>
  );
}

