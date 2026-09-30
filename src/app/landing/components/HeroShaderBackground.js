"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// ponytail: Dynamic import prevents Next.js SSR WebGL failure. Falls back to dark ambient radial gradient.
const ShaderCanvas = dynamic(
  () =>
    import("@shadergradient/react")
      .then((mod) => {
        const { ShaderGradientCanvas, ShaderGradient } = mod;
        return function ShaderField() {
          return (
            <ShaderGradientCanvas
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100vw",
                height: "120vh",
                pointerEvents: "none",
              }}
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
                uStrength={0.4}
                uDensity={0.8}
                uFrequency={5.5}
                uAmplitude={7}
                positionX={0}
                positionY={0}
                positionZ={0}
                rotationX={0}
                rotationY={0}
                rotationZ={140}
                color1="#1f469a"
                color2="#000000"
                color3="#000000"
                reflection={0.5}
                cAzimuthAngle={250}
                cPolarAngle={140}
                cDistance={1.5}
                cameraZoom={12.5}
                lightType="3d"
                brightness={1.5}
                envPreset="city"
                grain="on"
                toggleAxis={false}
                zoomOut={false}
                hoverState=""
                enableTransition={false}
              />
            </ShaderGradientCanvas>
          );
        };
      })
      .catch((err) => {
        console.warn("ShaderGradientCanvas load skipped:", err);
        return () => null;
      }),
  { ssr: false }
);

export default function HeroShaderBackground() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-black">
      {/* Ambient gradient layer matching color1 #1f469a falling into #000000 */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 35%, rgba(31, 70, 154, 0.45) 0%, rgba(10, 20, 60, 0.25) 50%, #000000 85%)",
        }}
      />
      {mounted && <ShaderCanvas />}
    </div>
  );
}
