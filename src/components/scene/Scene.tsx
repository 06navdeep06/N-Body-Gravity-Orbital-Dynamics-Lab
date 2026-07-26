"use client";

import { OrbitControls, Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";

export function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas
      camera={{ position: [0, 40, 70], fov: 50, near: 0.1, far: 5000 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#03040a"]} />
      {/*
        A point light centered on a body (e.g. a preset's sun at the
        origin) would light that body from inside itself — every point on
        its own surface faces away from its own light source, so it'd
        render nearly black. A fixed directional light + strong ambient
        avoids that regardless of where bodies are (works for binary
        stars, off-center presets, etc. too).
      */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[60, 90, 40]} intensity={1.1} color="#fff6e0" />
      <Stars radius={300} depth={80} count={3000} factor={4} fade speed={0.5} />
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={2} maxDistance={2000} />
      {children}
    </Canvas>
  );
}
