"use client";

import { useEffect, useRef, useState, memo } from "react";
import * as THREE from "three";

/**
 * DarkWaveTerrain
 * Full-bleed 3D undulating wireframe mesh terrain inspired by 'neat.png',
 * transformed into a dark obsidian / sapphire / electric-cyan developer aesthetic.
 * Covers 100% edge-to-edge of the container with no horizon gaps or black voids.
 */
function TerrainCanvas() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId = null;
    let isVisible = true;
    const clock = new THREE.Clock();

    // Scene & Dimensions
    const scene = new THREE.Scene();
    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || 750;

    // Camera setup: Facing the plane with moderate depth
    const fov = 45;
    const cameraZ = 14;
    const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
    camera.position.set(0, 0, cameraZ);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x060813, 1);
    container.appendChild(renderer.domElement);

    // Compute oversized plane dimensions so the mesh extends well past all 4 screen edges
    const computePlaneSize = (w, h) => {
      const vFov = (camera.fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(vFov / 2) * cameraZ;
      const visibleWidth = visibleHeight * (w / h);
      // 1.45x ensures 100% full coverage without any gaps even during wave displacement
      return {
        planeWidth: visibleWidth * 1.45,
        planeHeight: visibleHeight * 1.45,
      };
    };

    let { planeWidth, planeHeight } = computePlaneSize(width, height);

    // Plane Geometry (Triangulated grid like neat.png)
    // 92 x 64 subdivisions create dense, silky-smooth triangular wireframe lines
    let geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 92, 64);

    // Shared organic wave displacement shader function
    const vertexShader = `
      uniform float uTime;
      uniform vec2 uMouse;
      varying vec2 vUv;
      varying float vElevation;
      varying vec3 vNormalVec;

      // Multi-octave harmonic wave formula (organic undulating terrain)
      float getWaveHeight(vec2 pos, float time) {
        // Diagonal rolling wave
        float h = sin(pos.x * 0.22 + pos.y * 0.18 + time * 0.55) * 1.5;
        // Cross undulating wave
        h += cos(pos.x * 0.16 - pos.y * 0.24 - time * 0.42) * 1.25;
        // Circular breathing wave
        h += sin(length(pos * 0.14) - time * 0.48) * 0.85;
        // Secondary fine ripples
        h += sin(pos.x * 0.42 - time * 0.32) * cos(pos.y * 0.35 + time * 0.28) * 0.55;

        // Subtle interactive mouse ripple
        float mouseDist = distance(pos, uMouse * 14.0);
        h += sin(mouseDist * 0.45 - time * 1.4) * exp(-mouseDist * 0.14) * 0.75;
        return h;
      }

      void main() {
        vUv = uv;
        vec3 pos = position;
        float elevation = getWaveHeight(pos.xy, uTime);
        pos.z += elevation;
        vElevation = elevation;

        // Calculate surface normal for specular / directional sheen
        float eps = 0.12;
        float hL = getWaveHeight(pos.xy - vec2(eps, 0.0), uTime);
        float hR = getWaveHeight(pos.xy + vec2(eps, 0.0), uTime);
        float hD = getWaveHeight(pos.xy - vec2(0.0, eps), uTime);
        float hU = getWaveHeight(pos.xy + vec2(0.0, eps), uTime);
        vec3 normal = normalize(vec3((hL - hR) / (2.0 * eps), (hD - hU) / (2.0 * eps), 1.0));
        vNormalVec = normalMatrix * normal;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;

    // 1. Shaded Surface Material (Dark volumetric fluid wave body)
    const surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uDeepColor: { value: new THREE.Color("#050814") },
        uMidColor: { value: new THREE.Color("#0c1e47") },
        uCrestColor: { value: new THREE.Color("#0369a1") },
        uHighlightColor: { value: new THREE.Color("#38bdf8") },
      },
      vertexShader,
      fragmentShader: `
        uniform vec3 uDeepColor;
        uniform vec3 uMidColor;
        uniform vec3 uCrestColor;
        uniform vec3 uHighlightColor;
        varying vec2 vUv;
        varying float vElevation;
        varying vec3 vNormalVec;

        void main() {
          // Normalize elevation [-3.2, 3.2] -> [0.0, 1.0]
          float normH = clamp((vElevation + 2.4) / 4.8, 0.0, 1.0);

          vec3 color;
          if (normH < 0.38) {
            color = mix(uDeepColor, uMidColor, normH / 0.38);
          } else if (normH < 0.78) {
            color = mix(uMidColor, uCrestColor, (normH - 0.38) / 0.4);
          } else {
            color = mix(uCrestColor, uHighlightColor, (normH - 0.78) / 0.22);
          }

          // Specular directional lighting
          vec3 lightDir = normalize(vec3(0.35, 0.55, 1.0));
          float diff = max(dot(normalize(vNormalVec), lightDir), 0.0);
          color += uHighlightColor * pow(diff, 3.5) * 0.28;

          gl_FragColor = vec4(color, 0.96);
        }
      `,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 2. Wireframe Overlay Material (Sharp luminous grid lines as in neat.png)
    const wireframeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uWireDark: { value: new THREE.Color("#1e293b") },
        uWireCrest: { value: new THREE.Color("#38bdf8") },
        uWirePeak: { value: new THREE.Color("#e0f2fe") },
      },
      vertexShader,
      fragmentShader: `
        uniform vec3 uWireDark;
        uniform vec3 uWireCrest;
        uniform vec3 uWirePeak;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          float normH = clamp((vElevation + 2.4) / 4.8, 0.0, 1.0);

          vec3 wireColor;
          if (normH < 0.5) {
            wireColor = mix(uWireDark, uWireCrest, normH * 2.0);
          } else {
            wireColor = mix(uWireCrest, uWirePeak, (normH - 0.5) * 2.0);
          }

          // Crests have crisp glowing lines (~0.85), valleys remain subtle (~0.25)
          float wireAlpha = mix(0.24, 0.88, pow(normH, 1.15));

          gl_FragColor = vec4(wireColor, wireAlpha);
        }
      `,
      wireframe: true,
      transparent: true,
      depthWrite: false,
    });

    // Meshes
    let surfaceMesh = new THREE.Mesh(geometry, surfaceMaterial);
    let wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);

    const terrainGroup = new THREE.Group();
    terrainGroup.add(surfaceMesh);
    terrainGroup.add(wireframeMesh);
    // Slight 8-deg tilt towards user for subtle 3D parallax without creating empty horizon
    terrainGroup.rotation.x = -0.14;
    scene.add(terrainGroup);

    // Mouse Interaction
    let targetMouseX = 0;
    let targetMouseY = 0;
    let curMouseX = 0;
    let curMouseY = 0;

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetMouseX = x;
      targetMouseY = y;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    // Responsive Resize: dynamically rebuild geometry and adjust projection
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth || window.innerWidth;
      height = container.clientHeight || 750;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);

      const newSize = computePlaneSize(width, height);
      geometry.dispose();
      geometry = new THREE.PlaneGeometry(newSize.planeWidth, newSize.planeHeight, 92, 64);
      surfaceMesh.geometry = geometry;
      wireframeMesh.geometry = geometry;
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Pause rendering when section is scrolled out of viewport (battery/CPU saver)
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(container);

    // Animation Loop
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (!isVisible) return;

      const elapsedTime = clock.getElapsedTime();

      // Smooth mouse interpolation
      curMouseX += (targetMouseX - curMouseX) * 0.04;
      curMouseY += (targetMouseY - curMouseY) * 0.04;

      // Update shader uniforms
      surfaceMaterial.uniforms.uTime.value = elapsedTime;
      surfaceMaterial.uniforms.uMouse.value.set(curMouseX, curMouseY);

      wireframeMaterial.uniforms.uTime.value = elapsedTime;
      wireframeMaterial.uniforms.uMouse.value.set(curMouseX, curMouseY);

      // Subtle atmospheric sway
      terrainGroup.rotation.z = Math.sin(elapsedTime * 0.15) * 0.02 + curMouseX * 0.03;
      terrainGroup.rotation.x = -0.14 + curMouseY * 0.03;

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      geometry.dispose();
      surfaceMaterial.dispose();
      wireframeMaterial.dispose();
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

export default memo(function DarkWaveTerrain() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#060813]">
      {/* Three.js full-bleed animated wave wireframe canvas */}
      {mounted && <TerrainCanvas />}

      {/* Gentle contrast vignette to keep foreground typography effortlessly readable */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(6, 8, 19, 0.45) 0%, rgba(6, 8, 19, 0.75) 100%)",
        }}
      />
    </div>
  );
});
