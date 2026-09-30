"use client";
import { useEffect, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import AppLogo from "@/shared/components/AppLogo";

const CLI_TOOLS = [
  { id: "claude", name: "Claude Code", image: "/providers/claude.png" },
  { id: "codex", name: "OpenAI Codex", image: "/providers/codex.png" },
  { id: "cline", name: "Cline", image: "/providers/cline.png" },
  { id: "cursor", name: "Cursor", image: "/providers/cursor.png" },
];

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    badge: "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text)]",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    badge: "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text)]",
  },
  {
    id: "gemini",
    name: "Gemini",
    badge: "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text)]",
  },
  {
    id: "github",
    name: "GitHub Copilot",
    badge: "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text)]",
  },
];

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFlow((prev) => (prev + 1) % PROVIDERS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-8 w-full max-w-3xl relative h-[320px] hidden md:flex items-center justify-center">
      {/* JRouter Hub - Center */}
      <div className="relative z-20 w-28 h-28 rounded-full bg-[var(--surface)] border border-[var(--line-2)] shadow-[var(--shadow-card)] flex flex-col items-center justify-center gap-1 group">
        <AppLogo size={40} />
        <span className="text-[10px] font-mono font-semibold text-[var(--text)] tracking-[0.2em] uppercase">
          JRouter
        </span>
        <div className="absolute inset-0 rounded-full border border-[var(--accent-line)] animate-ping opacity-15"></div>
      </div>

      {/* CLI Tools - Left side */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col gap-5">
        {CLI_TOOLS.map((tool) => (
          <div
            key={tool.id}
            className="flex items-center gap-3 opacity-80 hover:opacity-100 transition-opacity group"
          >
            <div className="w-12 h-12 rounded-[var(--r2)] bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center overflow-hidden p-2 shadow-xs hover:border-[var(--accent-line)] transition-all">
              <ProviderIcon
                src={tool.image}
                alt={tool.name}
                size={36}
                className="object-contain rounded-[var(--r1)] max-w-[36px] max-h-[36px]"
                fallbackText={tool.name.slice(0, 2).toUpperCase()}
              />
            </div>
          </div>
        ))}
      </div>

      {/* SVG Lines from CLI to JRouter */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none stroke-[var(--line-2)]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 50 C 250 70, 250 160, 360 160"
          fill="none"
          strokeDasharray="4,4"
          strokeWidth="1.5"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 120 C 250 130, 250 160, 360 160"
          fill="none"
          strokeDasharray="4,4"
          strokeWidth="1.5"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 200 C 250 190, 250 160, 360 160"
          fill="none"
          strokeDasharray="4,4"
          strokeWidth="1.5"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 270 C 250 250, 250 160, 360 160"
          fill="none"
          strokeDasharray="4,4"
          strokeWidth="1.5"
        ></path>
      </svg>

      {/* SVG Lines from JRouter to Providers */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 410 160 C 520 160, 520 40, 680 40"
          fill="none"
          stroke={activeFlow === 0 ? "var(--text)" : "var(--line)"}
          strokeWidth={activeFlow === 0 ? "2" : "1.5"}
          className={activeFlow === 0 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 410 160 C 520 160, 520 120, 680 120"
          fill="none"
          stroke={activeFlow === 1 ? "var(--text)" : "var(--line)"}
          strokeWidth={activeFlow === 1 ? "2" : "1.5"}
          className={activeFlow === 1 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 410 160 C 520 160, 520 200, 680 200"
          fill="none"
          stroke={activeFlow === 2 ? "var(--text)" : "var(--line)"}
          strokeWidth={activeFlow === 2 ? "2" : "1.5"}
          className={activeFlow === 2 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 410 160 C 520 160, 520 280, 680 280"
          fill="none"
          stroke={activeFlow === 3 ? "var(--text)" : "var(--line)"}
          strokeWidth={activeFlow === 3 ? "2" : "1.5"}
          className={activeFlow === 3 ? "animate-pulse" : ""}
        ></path>
      </svg>

      {/* AI Providers - Right side */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between py-2">
        {PROVIDERS.map((provider, idx) => (
          <div
            key={provider.id}
            className={`px-3 py-1.5 rounded-[var(--r1)] border font-mono text-xs transition-all min-w-[130px] text-center ${provider.badge} ${
              activeFlow === idx ? "border-[var(--accent-line)] shadow-xs" : "opacity-70"
            }`}
            title={provider.name}
          >
            {provider.name}
          </div>
        ))}
      </div>

      {/* Mobile fallback */}
      <div className="md:hidden mt-8 w-full p-4 rounded-[var(--r2)] bg-[var(--surface-2)] border border-[var(--line)]">
        <p className="text-xs font-mono text-center text-[var(--text-3)]">
          Interactive architecture view available on desktop
        </p>
      </div>
    </div>
  );
}
