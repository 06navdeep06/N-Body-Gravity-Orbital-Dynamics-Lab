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
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 0, 0]} intensity={2} decay={0} color="#fff6e0" />
      <Stars radius={300} depth={80} count={3000} factor={4} fade speed={0.5} />
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={2} maxDistance={2000} />
      {children}
    </Canvas>
  );
}
