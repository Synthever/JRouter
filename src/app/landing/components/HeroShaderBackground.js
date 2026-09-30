"use client";

import React, { useState, useEffect, memo, Suspense } from "react";
import dynamic from "next/dynamic";

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
                pixelDensity={1}
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
                  color1="#a1a1aa"
                  color2="#52525b"
                  color3="#18181b"
                  reflection={0.35}
                  // View (camera) props
                  cAzimuthAngle={270}
                  cPolarAngle={180}
                  cDistance={0.5}
                  cameraZoom={15.1}
                  // Effect props
                  lightType="env"
                  brightness={0.75}
                  envPreset="city"
                  grain="on"
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-black">
      {mounted && <ShaderCanvas />}
    </div>
  );
});
