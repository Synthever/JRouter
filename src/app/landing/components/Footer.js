"use client";
import { useState, useEffect, useRef } from "react";
import AppLogo from "@/shared/components/AppLogo";

export default function Footer() {
  const [isVisible, setIsVisible] = useState(false);
  const footerRef = useRef(null);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -20px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <footer
      ref={footerRef}
      className="relative z-10 border-none bg-gradient-to-b from-transparent via-black/40 to-black/80 pt-16 pb-12 px-6 overflow-hidden"
    >
      {/* Architectural Watermark Typography */}
      <div 
        aria-hidden="true" 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none text-[18vw] font-black font-sans tracking-[-0.06em] leading-none whitespace-nowrap text-white"
        style={{
          opacity: isVisible ? 0.045 : 0,
          transition: "opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        JROUTER
      </div>

      <div className="lp-wrap relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-14">
          {/* Brand */}
          <div
            className="col-span-2 lg:col-span-2"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s",
              willChange: "transform, opacity",
            }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <AppLogo size={28} />
              <h3 className="text-white text-sm font-semibold tracking-tight">JRouter</h3>
            </div>
            <p className="text-neutral-400 text-xs max-w-xs leading-relaxed mb-5">
              Unified API routing gateway and developer dashboard. Universal format translation and model fallbacks.
            </p>
          </div>
          
          {/* Product */}
          <div
            className="flex flex-col gap-2.5"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.22s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.22s",
              willChange: "transform, opacity",
            }}
          >
            <h4 className="text-xs font-mono font-medium text-neutral-300 uppercase tracking-wider">Product</h4>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="#features">Features</a>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="/dashboard">Dashboard</a>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">Releases</a>
          </div>
          
          {/* Resources */}
          <div
            className="flex flex-col gap-2.5"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.34s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.34s",
              willChange: "transform, opacity",
            }}
          >
            <h4 className="text-xs font-mono font-medium text-neutral-300 uppercase tracking-wider">Resources</h4>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">CLI Launcher</a>
          </div>
          
          {/* Legal */}
          <div
            className="flex flex-col gap-2.5"
            style={{
              transform: isVisible ? "translateY(0)" : "translateY(24px)",
              opacity: isVisible ? 1 : 0,
              transition: "transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.46s, opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.46s",
              willChange: "transform, opacity",
            }}
          >
            <h4 className="text-xs font-mono font-medium text-neutral-300 uppercase tracking-wider">License</h4>
            <a className="text-neutral-400 hover:text-white text-xs transition-colors" href="https://github.com/Synthever/JRouter/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div
          className="pt-6 flex flex-col md:flex-row justify-between items-center gap-3 border-t border-white/5"
          style={{
            transform: isVisible ? "translateY(0)" : "translateY(16px)",
            opacity: isVisible ? 1 : 0,
            transition: "transform 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.55s, opacity 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.55s",
            willChange: "transform, opacity",
          }}
        >
          <p className="text-neutral-400 text-xs font-mono">
            &copy; 2026 JRouter. Open source software.
          </p>
          <div className="flex items-center gap-5">
            <a className="text-neutral-400 hover:text-white text-xs font-mono transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-neutral-400 hover:text-white text-xs font-mono transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

