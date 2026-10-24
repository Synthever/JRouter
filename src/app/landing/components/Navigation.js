"use client";
import Icon from "@/shared/components/Icon";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLogo from "@/shared/components/AppLogo";

// ponytail: Scroll threshold 24px triggers pill morph. Native scroll listener without external animation deps.
export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasEntered(true);
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  return (
    <nav
      className="fixed top-0 inset-x-0 z-50 flex justify-center pointer-events-none px-4 sm:px-6"
      style={{
        transform: hasEntered ? "translateY(0)" : "translateY(calc(-100% - 24px))",
        opacity: hasEntered ? 1 : 0,
        transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div
        className={`pointer-events-auto transition-all duration-300 ease-out flex items-center justify-between w-full ${
          isScrolled
            ? "mt-3 sm:mt-4 max-w-4xl px-5 sm:px-6 py-2.5 rounded-full bg-[var(--surface-soft)] border border-[var(--line)]"
            : "max-w-7xl px-2 sm:px-4 py-5 bg-transparent border-transparent"
        }`}
      >
        {/* Left: Brand + Nav Links Group */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <button
            type="button"
            className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0 text-[var(--text)]"
            onClick={() => router.push("/")}
            aria-label="Navigate to home"
          >
            <AppLogo size={36} />
            <span className="text-[var(--text)] text-base font-semibold tracking-tight">JRouter</span>
          </button>

          {/* Desktop menu */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-[var(--text-2)]">
            <a className="hover:text-[var(--text)] transition-colors" href="#features">Features</a>
            <a className="hover:text-[var(--text)] transition-colors" href="#how-it-works">How it Works</a>
            <a className="hover:text-[var(--text)] transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="hover:text-[var(--text)] transition-colors flex items-center gap-1" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">
              GitHub <Icon className="text-[14px]">open_in_new</Icon>
            </a>
          </div>
        </div>

        {/* Right: Glass Action Button + Mobile Toggle */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.push("/dashboard")}
            className="hidden sm:inline-flex cursor-pointer bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition px-4 py-2 rounded-[var(--r2)] text-xs sm:text-sm font-semibold text-[var(--primary-ink)]"
          >
            Dashboard
          </button>
          <button 
            className="md:hidden text-[var(--text)] p-1.5 flex items-center justify-center cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <Icon className="text-[20px]">{mobileMenuOpen ? "close" : "menu"}</Icon>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="pointer-events-auto md:hidden absolute top-full inset-x-4 mt-2 p-5 rounded-[var(--r4)] bg-[var(--surface)] border border-[var(--line-2)] flex flex-col gap-3.5">
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-sm font-medium transition-colors" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-sm font-medium transition-colors" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-sm font-medium transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="text-[var(--text-2)] hover:text-[var(--text)] text-sm font-medium transition-colors flex items-center justify-between" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">
            <span>GitHub</span>
            <Icon className="text-[14px]">open_in_new</Icon>
          </a>
          <button 
            onClick={() => {
              setMobileMenuOpen(false);
              router.push("/dashboard");
            }}
            className="mt-1 w-full bg-[var(--color-primary)] text-[var(--primary-ink)] py-2.5 rounded-[var(--r2)] text-sm font-semibold hover:bg-[var(--color-primary-hover)] transition"
          >
            Dashboard
          </button>
        </div>
      )}
    </nav>
  );
}

