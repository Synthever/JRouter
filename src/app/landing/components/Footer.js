"use client";

import AppLogo from "@/shared/components/AppLogo";

export default function Footer() {
  return (
    <footer className="relative z-20 border-t border-[var(--line)] bg-[var(--surface)] pt-12 pb-8 px-6">
      <div className="lp-wrap">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <AppLogo size={28} />
              <h3 className="text-[var(--text)] text-sm font-semibold tracking-tight">JRouter</h3>
            </div>
            <p className="text-[var(--text-3)] text-xs max-w-xs leading-relaxed mb-4">
              Unified API routing gateway and developer dashboard. Universal format translation and model fallbacks.
            </p>
          </div>
          
          {/* Product */}
          <div className="flex flex-col gap-2.5">
            <h4 className="text-xs font-mono font-medium text-[var(--text)] uppercase tracking-wider">Product</h4>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="#features">Features</a>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="/dashboard">Dashboard</a>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">Releases</a>
          </div>
          
          {/* Resources */}
          <div className="flex flex-col gap-2.5">
            <h4 className="text-xs font-mono font-medium text-[var(--text)] uppercase tracking-wider">Resources</h4>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="https://github.com/Synthever/JRouter#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">CLI Launcher</a>
          </div>
          
          {/* Legal */}
          <div className="flex flex-col gap-2.5">
            <h4 className="text-xs font-mono font-medium text-[var(--text)] uppercase tracking-wider">License</h4>
            <a className="text-[var(--text-2)] hover:text-[var(--text)] text-xs transition-colors" href="https://github.com/Synthever/JRouter/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="border-t border-[var(--line)] pt-6 flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-[var(--text-3)] text-xs font-mono">© 2026 JRouter. Open source software.</p>
          <div className="flex gap-4">
            <a className="text-[var(--text-3)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="https://github.com/Synthever/JRouter" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-[var(--text-3)] hover:text-[var(--text)] text-xs font-mono transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

