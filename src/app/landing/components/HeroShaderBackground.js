"use client";

import React, { useState, useEffect, memo } from "react";
import dynamic from "next/dynamic";

// ponytail: lazyLoad={false} stops WebGL canvas teardown on scroll; preserveDrawingBuffer prevents context discard.
const ShaderCanvas = dynamic(
  () =>
    import("@shadergradient/react")
      .then((mod) => {
        const { ShaderGradientCanvas, ShaderGradient } = mod;
        const ShaderField = memo(function ShaderField() {
          return (
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
              preserveDrawingBuffer={true}
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
      {/* Permanent high-fidelity blue vortex substrate so background is never empty */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: "radial-gradient(ellipse 75% 65% at 50% 40%, rgba(31, 70, 154, 0.55) 0%, rgba(15, 30, 85, 0.3) 45%, #000000 85%)",
        }}
      />
      {mounted && <ShaderCanvas />}
    </div>
  );
});
