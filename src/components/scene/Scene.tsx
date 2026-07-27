"use client";

import { Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { XR } from "@react-three/xr";
import type { ReactNode } from "react";
import { setGlCanvas } from "@/lib/utils/canvas-ref";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { xrStore } from "@/lib/xr/xr-store";
import { CameraController } from "./CameraController";
import { LensingEffect } from "./LensingEffect";
import { XRGrabInteraction, XRPanels, XRRig } from "./XRScene";
import { findBlackHoles } from "./BlackHole";

/**
 * Mounts the lensing post-pass only when there is actually a black hole on
 * screen and the toggle is on — an EffectComposer forces an extra
 * render-target round-trip, so it shouldn't be paid for on ordinary presets.
 */
function PostProcessing() {
  const showLensing = useSimulationStore((s) => s.showLensing);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);
  const c = useSimulationStore((s) => s.speedOfLight);

  if (!showLensing || findBlackHoles(bodies, G, c).length === 0) return null;

  return (
    <EffectComposer>
      <LensingEffect />
    </EffectComposer>
  );
}

export function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas
      // preserveDrawingBuffer lets export.ts read pixels back for PNG
      // screenshots and WebM capture; slight perf cost, worth it here.
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => setGlCanvas(gl.domElement)}
    >
      <XR store={xrStore}>
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
        <CameraController />
        {/* XRRig is identity-transform outside a session, so the desktop
            view is unaffected by its presence. */}
        <XRRig>{children}</XRRig>
        <XRGrabInteraction />
        <XRPanels />
        <PostProcessing />
      </XR>
    </Canvas>
  );
}
