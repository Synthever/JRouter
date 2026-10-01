"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroShaderBackground from "./components/HeroShaderBackground";
import HeroSection from "./components/HeroSection";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";

// Filter out deprecated THREE.Clock warning emitted by 3rd-party dependencies
if (typeof window !== "undefined") {
  const origWarn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("THREE.Clock")) return;
    origWarn.apply(console, args);
  };
}

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    document.documentElement.classList.add("no-scrollbar");
    document.body.classList.add("no-scrollbar");
    return () => {
      document.documentElement.classList.remove("no-scrollbar");
      document.body.classList.remove("no-scrollbar");
    };
  }, []);

  return (
    <div className="landing-page dark relative text-[var(--text)] bg-[var(--bg)] font-sans overflow-x-hidden antialiased min-h-screen">
      {/* Hardware Hairline Grid Substrate */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[var(--bg)]">
        <div 
          className="absolute inset-0 opacity-40" 
          style={{
            backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)`,
            backgroundSize: '48px 48px'
          }}
        />
      </div>

      <div className="relative z-10">
        <Navigation />
        
        <main>
          {/* Persistent full-bleed WebGL shader field active across Hero -> GetStarted -> HowItWorks -> Features */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-black">
            <HeroShaderBackground />
          </div>

          <div className="relative z-10">
            <HeroSection />
            <GetStarted />
            <HowItWorks />
            <Features />
            
            {/* CTA Section */}
            <section className="lp-section bg-transparent text-center border-none">
              <div className="lp-wrap py-8">
                <div className="lp-eyebrow mb-3">
                  <span className="lp-eyebrow__dot"></span>
                  <span>OPEN SOURCE GATEWAY</span>
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-[var(--text)] mb-3">
                  Streamline Your AI Stack
                </h2>
                <p className="text-sm text-[var(--text-2)] mb-8 max-w-lg mx-auto leading-relaxed">
                  Connect your IDE, CLI tools, and background agents to a unified proxy layer. Local execution, zero subscription markups.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button 
                    onClick={() => router.push("/dashboard")}
                    className="ui-btn ui-btn--primary px-6 py-2.5 text-xs sm:text-sm font-semibold cursor-pointer w-full sm:w-auto"
                  >
                    Launch Dashboard
                  </button>
                  <a 
                    href="https://github.com/Synthever/JRouter#readme" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ui-btn ui-btn--soft px-6 py-2.5 text-xs sm:text-sm font-medium w-full sm:w-auto"
                  >
                    Documentation
                  </a>
                </div>
              </div>
            </section>
          </div>
        </main>
        
        <Footer />
      </div>
      
      {/* Global styles for keyframes & landing scrollbar hiding */}
      <style jsx global>{`
        html,
        body,
        html.no-scrollbar,
        body.no-scrollbar {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        html.no-scrollbar::-webkit-scrollbar,
        body.no-scrollbar::-webkit-scrollbar,
        html.no-scrollbar *::-webkit-scrollbar,
        *::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes dash {
          to { stroke-dashoffset: -16; }
        }
      `}</style>
    </div>
  );
}

