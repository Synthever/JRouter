"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (text) => {
    copy(text, "landing");
  };

  return (
    <section className="lp-section relative overflow-hidden bg-transparent border-none">
      <div className="lp-wrap relative z-10">
        <div className="flex flex-col lg:flex-row gap-12 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <div className="lp-eyebrow mb-3">
              <span className="lp-eyebrow__dot"></span>
              <span>QUICKSTART</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-[var(--text)] tracking-tight mb-4">
              Initialize in 30 Seconds
            </h2>
            <p className="text-sm text-[var(--text-2)] mb-8 max-w-lg leading-relaxed">
              Launch local gateway, configure providers in the developer dashboard, and point any OpenAI-compatible client to port 20128.
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none size-7 rounded-lg bg-black/40 backdrop-blur-xl border-0 text-[var(--text)] flex items-center justify-center font-mono text-xs font-semibold shadow-md shadow-black/50">1</div>
                <div>
                  <h4 className="font-semibold text-sm text-[var(--text)]">Launch Gateway</h4>
                  <p className="text-xs text-[var(--text-2)] mt-0.5">Run CLI command to launch local proxy process</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none size-7 rounded-lg bg-black/40 backdrop-blur-xl border-0 text-[var(--text)] flex items-center justify-center font-mono text-xs font-semibold shadow-md shadow-black/50">2</div>
                <div>
                  <h4 className="font-semibold text-sm text-[var(--text)]">Open Dashboard</h4>
                  <p className="text-xs text-[var(--text-2)] mt-0.5">Configure API credentials, combos, and proxy pools</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none size-7 rounded-lg bg-black/40 backdrop-blur-xl border-0 text-[var(--text)] flex items-center justify-center font-mono text-xs font-semibold shadow-md shadow-black/50">3</div>
                <div>
                  <h4 className="font-semibold text-sm text-[var(--text)]">Route Traffic</h4>
                  <p className="text-xs text-[var(--text-2)] mt-0.5">Point Claude Code, Codex, or agents to http://localhost:20128</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-[var(--r3)] overflow-hidden bg-[var(--surface-inset)]/90 backdrop-blur-xl border-0 shadow-[var(--shadow-card)]">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--surface-2)]/90">
                <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/80"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/80"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/80"></div>
                <div className="ml-2 text-[11px] text-[var(--text-3)] font-mono">bash — 80x24</div>
              </div>
              
              {/* Terminal content */}
              <div className="p-5 font-mono text-xs leading-relaxed overflow-x-auto text-[var(--text)]">
                <div 
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => handleCopy("npm run start")}
                >
                  <span className="text-[var(--pos)]">$</span>
                  <span className="text-[var(--text)] font-semibold">npm run start</span>
                  <span className="ml-auto text-[10px] text-[var(--text-3)] group-hover:text-[var(--text)]">
                    {copied === "landing" ? "✓ Copied" : "Copy"}
                  </span>
                </div>
                
                <div className="text-[var(--text-2)] mb-5 space-y-1">
                  <div><span className="text-[var(--text-3)]">&gt;</span> Initializing JRouter gateway...</div>
                  <div><span className="text-[var(--text-3)]">&gt;</span> OpenAI proxy listening on <span className="text-[var(--text)] underline">http://localhost:20128/v1</span></div>
                  <div><span className="text-[var(--text-3)]">&gt;</span> Dashboard available on <span className="text-[var(--text)] underline">http://localhost:20128/dashboard</span></div>
                  <div><span className="text-[var(--pos)]">&gt;</span> Ready for incoming connections ✓</div>
                </div>
                
                <div className="text-[11px] text-[var(--text-3)] pt-3">
                  <div>Local SQLite DB: ~/.9router/db/data.sqlite</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

