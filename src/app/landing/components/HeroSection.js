"use client";
import Icon from "@/shared/components/Icon";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const HERO_PHRASES = [
  "Unified AI Infrastructure for Developer Workflows",
  "One Universal Gateway for 40+ AI Providers",
  "Resilient Model Routing with Zero Markups",
];

export default function HeroSection() {
  const router = useRouter();
  const [hasEntered, setHasEntered] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasEntered(true);
    }, 180);
    return () => clearTimeout(timer);
  }, []);

  // Typewriter effect: types from beginning, pauses, deletes, and switches between 3 phrases
  useEffect(() => {
    const fullText = HERO_PHRASES[phraseIndex];
    let timer;

    if (!isDeleting && currentText === fullText) {
      // Pause at full text to allow reading
      timer = setTimeout(() => {
        setIsDeleting(true);
      }, 2000);
    } else if (isDeleting && currentText === "") {
      // Pause on empty before starting the next phrase
      timer = setTimeout(() => {
        setIsDeleting(false);
        setPhraseIndex((prev) => (prev + 1) % HERO_PHRASES.length);
      }, 280);
    } else if (isDeleting) {
      // Fast snappy backspacing
      timer = setTimeout(() => {
        setCurrentText((prev) => prev.slice(0, -1));
      }, 18);
    } else {
      // Natural typewriter rhythm with quick start
      const isFirstChar = currentText === "" && phraseIndex === 0;
      timer = setTimeout(() => {
        setCurrentText(fullText.slice(0, currentText.length + 1));
      }, isFirstChar ? 100 : 42);
    }

    return () => clearTimeout(timer);
  }, [currentText, isDeleting, phraseIndex]);

  return (
    <section className="relative min-h-[92vh] flex flex-col items-center justify-center text-center px-4 sm:px-6 pt-32 pb-20 bg-transparent text-white w-full overflow-hidden">
      {/* Foreground Hero Content */}
      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center gap-6 sm:gap-8">
        {/* Eyebrow glass badge */}
        <div
          className="border border-white/15 flex items-center gap-2.5 rounded-full py-1 px-3.5 bg-white/5 backdrop-blur-md shadow-lg shadow-black/40 hover:bg-white/10 hover:border-white/25"
          style={{
            transform: hasEntered ? "scale(1) translateY(0)" : "scale(0.8) translateY(14px)",
            opacity: hasEntered ? 1 : 0,
            transition:
              "transform 0.65s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s, border-color 0.2s",
            willChange: "transform, opacity",
          }}
        >
          <span className="text-xs sm:text-sm text-neutral-300 font-mono tracking-wider">
            GATEWAY ENTERPRISE AI PROXY INFRASTRUCTURE
          </span>
        </div>

        {/* Main heading with Typewriter animation */}
        <h1
          className="text-4xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.12] text-white min-h-[5.5rem] sm:min-h-[8.5rem] md:min-h-[10.5rem]"
          aria-label={HERO_PHRASES[phraseIndex]}
        >
          <span aria-hidden="true">
            {currentText}
            <span
              className="inline-block w-[3px] sm:w-[4px] md:w-[5px] h-[0.82em] bg-white ml-1.5 align-middle rounded-full animate-pulse"
            />
          </span>
          <span className="sr-only">{HERO_PHRASES[phraseIndex]}</span>
        </h1>

        {/* Description */}
        <p className="text-neutral-300 text-base sm:text-lg md:text-xl max-w-2xl font-light leading-relaxed">
          One OpenAI-compatible endpoint routing traffic across 40+ providers. Zero-leak credentials, model-combo fallback, token compression, and real-time developer telemetry.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3.5 pt-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="cursor-pointer bg-white text-black px-6 py-3 rounded-md font-semibold flex items-center gap-2 hover:bg-neutral-200 transition text-sm sm:text-base shadow-xl"
          >
            <span>Launch Dashboard</span>
            <Icon className="text-[18px]">arrow_forward</Icon>
          </button>
          <a
            href="https://github.com/Synthever/JRouter"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer bg-white/10 hover:bg-white/20 transition px-6 py-3 rounded-md font-medium text-white border border-white/20 backdrop-blur-md flex items-center gap-2 text-sm sm:text-base"
          >
            <Icon className="text-[18px]">code</Icon>
            <span>GitHub Repository</span>
          </a>
        </div>
      </div>

      {/* Upstream Ecosystem Bar */}
      <div className="relative z-10 mt-16 sm:mt-20 flex flex-col items-center gap-4">
        <p className="text-xs sm:text-sm font-mono tracking-widest text-neutral-400 uppercase">
          Routing Across 40+ AI Providers &amp; Developer Tools
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-neutral-400 text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2 hover:text-white transition-colors">
            <svg className="w-4 h-4 shrink-0 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
            </svg>
            <span>Claude</span>
          </div>
          <div className="flex items-center gap-2 hover:text-white transition-colors">
            <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 24 24">
              <path d="M22.28 9.82a6 6 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9 6.07 6.07 0 0 0-6.27 2.17 6 6 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 6 6 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 6 6 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.85-3.37v2.33a.08.08 0 0 1-.04.06L9.74 20a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.69a.77.77 0 0 0 .38.67l5.82 3.36-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.1 3.85-5.84-3.37 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.67a.8.8 0 0 0-.4-.69zm2.01-4.54-.14-.09-4.78-2.78a.78.78 0 0 0-.78 0L8.81 7.7V5.37a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.78 4.71zm-10.78 5.8 2.93-1.69 2.93 1.69v3.37l-2.93 1.68-2.93-1.68z" />
            </svg>
            <span>OpenAI</span>
          </div>
          <div className="flex items-center gap-2 hover:text-white transition-colors">
            <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C12 6.63 6.63 12 0 12c6.63 0 12 5.37 12 12 0-6.63 5.37-12 12-12-6.63 0-12-5.37-12-12z" />
            </svg>
            <span>Gemini</span>
          </div>
          <div className="flex items-center gap-2 hover:text-white transition-colors">
            <span className="font-mono font-bold text-sm tracking-tighter italic">Z</span>
            <span>Z.ai</span>
          </div>
          <div className="flex items-center gap-2 hover:text-white transition-colors">
            <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 24 24">
              <path d="M3 13.5C3 8.8 6.8 5 11.5 5c3.2 0 6 1.8 7.4 4.5l2.6-.8-1.1 2.8c.4.9.6 1.9.6 3 0 4.7-3.8 8.5-8.5 8.5S3 18.2 3 13.5zm8.5-6.5C7.9 7 5 9.9 5 13.5S7.9 20 11.5 20s6.5-2.9 6.5-6.5c0-.9-.2-1.7-.5-2.5l-.3-.6 1.2-3.1-2.9.9-.6-.4c-.9-.5-1.9-.8-3.4-.8z" />
            </svg>
            <span>deepseek</span>
          </div>
        </div>
      </div>
    </section>
  );
}

