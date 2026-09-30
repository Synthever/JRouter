"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-[var(--surface)]/90 backdrop-blur-md border-b border-[var(--line)]">
      <div className="lp-wrap h-14 flex items-center justify-between">
        {/* Logo */}
        <button
          type="button"
          className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-7 rounded-[var(--r1)] bg-white text-black flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[16px]">hub</span>
          </div>
          <h2 className="text-[var(--text)] text-base font-semibold tracking-tight">JRouter</h2>
        </button>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-6">
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="#features">Features</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="#how-it-works">How it Works</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors flex items-center gap-1" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">
            GitHub <span className="material-symbols-outlined text-[12px]">open_in_new</span>
          </a>
        </div>

        {/* CTA + Mobile menu */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.push("/dashboard")}
            className="hidden sm:inline-flex ui-btn ui-btn--primary text-xs font-semibold"
          >
            Dashboard
          </button>
          <button 
            className="md:hidden text-[var(--text)] p-1"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[var(--line)] bg-[var(--surface)] p-6 flex flex-col gap-4">
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">GitHub</a>
          <button 
            onClick={() => router.push("/dashboard")}
            className="ui-btn ui-btn--primary text-xs font-semibold w-full"
          >
            Dashboard
          </button>
        </div>
      )}
    </nav>
  );
}

