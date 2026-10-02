"use client";

import React, { useState, useEffect, memo, Suspense } from "react";
import dynamic from "next/dynamic";

// Filter out deprecated THREE.Clock warning emitted by 3rd-party @shadergradient/react
if (typeof window !== "undefined") {
  const origWarn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("THREE.Clock")) return;
    origWarn.apply(console, args);
  };
}

/**
 * Digital Success - Cool volumetric shadow gradient from hero.md
 * Exact uniforms from packages/blocks/src/hero-section/hero-digital-success.tsx
 * Three-color blue palette (#92dbe0, #0b7bff, #3865cf), cameraZoom 15.1, cDistance 0.5.
 */
const ShaderCanvas = dynamic(
  () =>
    import("@shadergradient/react")
      .then((mod) => {
        const { ShaderGradientCanvas, ShaderGradient } = mod;
        const ShaderField = memo(function ShaderField() {
          return (
            <Suspense fallback={null}>
              <ShaderGradientCanvas
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
                lazyLoad={false}
                pixelDensity={typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1}
                pointerEvents="none"
              >
                <ShaderGradient
                  animate="on"
                  type="sphere"
                  wireframe={false}
                  shader="defaults"
                  uTime={0}
                  uSpeed={0.3}
                  uStrength={0.3}
                  uDensity={0.8}
                  uFrequency={5.5}
                  uAmplitude={3.2}
                  positionX={-0.1}
                  positionY={0}
                  positionZ={0}
                  rotationX={0}
                  rotationY={130}
                  rotationZ={70}
                  color1="#000000"
                  color2="#2c2c2c"
                  color3="#4e4e4e"
                  reflection={0.35}
                  // View (camera) props
                  cAzimuthAngle={270}
                  cPolarAngle={180}
                  cDistance={0.5}
                  cameraZoom={15.1}
                  // Effect props - "3d" uses local lights without blocking on external .hdr downloads
                  lightType="3d"
                  brightness={0.85}
                  grain="off"
                  // Tool props
                  toggleAxis={false}
                  zoomOut={false}
                  hoverState=""
                  // Optional - if using transition features
                  enableTransition={false}
                />
              </ShaderGradientCanvas>
            </Suspense>
          );
        });
        return ShaderField;
      })
      .catch((err) => {
        console.warn("ShaderGradientCanvas load skipped:", err);
        return () => null;
      }),
  { ssr: false }
);

export default memo(function HeroShaderBackground() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none z-0"
      style={{
        background:
          "radial-gradient(ellipse 90% 70% at 50% 30%, #27272a 0%, #18181b 45%, #09090b 80%, #000000 100%)",
      }}
    >
      <div
        className="w-full h-full"
        style={{
          opacity: ready ? 1 : 0,
          transition: "opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <ShaderCanvas />
      </div>
    </div>
  );
});
