"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLogo from "@/shared/components/AppLogo";

// ponytail: Scroll threshold 24px triggers pill morph. Native scroll listener without external animation deps.
export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className="fixed top-0 inset-x-0 z-50 flex justify-center pointer-events-none transition-all duration-300 ease-out px-4 sm:px-6">
      <div
        className={`pointer-events-auto transition-all duration-300 ease-out flex items-center justify-between w-full ${
          isScrolled
            ? "mt-3 sm:mt-4 max-w-4xl px-5 sm:px-6 py-2.5 rounded-full bg-black/30 backdrop-blur-xl border-0 shadow-2xl shadow-black/80"
            : "max-w-7xl px-2 sm:px-4 py-5 bg-transparent border-transparent"
        }`}
      >
        {/* Left: Brand + Nav Links Group */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <button
            type="button"
            className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0 text-white"
            onClick={() => router.push("/")}
            aria-label="Navigate to home"
          >
            <AppLogo size={36} />
            <span className="text-white text-base font-semibold tracking-tight">JRouter</span>
          </button>

          {/* Desktop menu */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-300">
            <a className="hover:text-white transition-colors" href="#features">Features</a>
            <a className="hover:text-white transition-colors" href="#how-it-works">How it Works</a>
            <a className="hover:text-white transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="hover:text-white transition-colors flex items-center gap-1" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">
              GitHub <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </a>
          </div>
        </div>

        {/* Right: Glass Action Button + Mobile Toggle */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.push("/dashboard")}
            className="hidden sm:inline-flex cursor-pointer bg-white/10 hover:bg-white/20 transition px-4 py-1.5 sm:py-2 rounded-md sm:rounded-full text-xs sm:text-sm font-medium border border-white/15 backdrop-blur-md text-white shadow-xs"
          >
            Dashboard
          </button>
          <button 
            className="md:hidden text-white p-1.5 flex items-center justify-center cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined text-[20px]">{mobileMenuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="pointer-events-auto md:hidden absolute top-full inset-x-4 mt-2 p-5 rounded-2xl bg-black/85 backdrop-blur-2xl border border-white/15 flex flex-col gap-3.5 shadow-2xl">
          <a className="text-neutral-300 hover:text-white text-sm font-medium transition-colors" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
          <a className="text-neutral-300 hover:text-white text-sm font-medium transition-colors" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
          <a className="text-neutral-300 hover:text-white text-sm font-medium transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="text-neutral-300 hover:text-white text-sm font-medium transition-colors flex items-center justify-between" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">
            <span>GitHub</span>
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </a>
          <button 
            onClick={() => {
              setMobileMenuOpen(false);
              router.push("/dashboard");
            }}
            className="mt-1 w-full bg-white text-black py-2 rounded-lg text-sm font-semibold hover:bg-neutral-200 transition"
          >
            Dashboard
          </button>
        </div>
      )}
    </nav>
  );
}

