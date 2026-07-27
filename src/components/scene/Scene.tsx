"use client";

import { Canvas } from "@react-three/fiber";
import { XR } from "@react-three/xr";
import type { ReactNode } from "react";
import * as THREE from "three";
import { setGlCanvas } from "@/lib/utils/canvas-ref";
import { useQualityPreset } from "@/lib/render/quality-preset";
import { CinematicPipeline } from "@/pipeline/CinematicPipeline";
import { xrStore } from "@/lib/xr/xr-store";
import { CameraController } from "./CameraController";
import { SpaceEnvironment } from "./SpaceEnvironment";
import { StarLight } from "./StarLight";
import { XRGrabInteraction, XRPanels, XRRig } from "./XRScene";

export function Scene({ children }: { children: ReactNode }) {
  const features = useQualityPreset();

  return (
    <Canvas
      // preserveDrawingBuffer lets export.ts read pixels back for PNG
      // screenshots and WebM capture; slight perf cost, worth it here.
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      // Shadow maps are a Cinematic-tier cost — six cube faces for the star's
      // point light, plus a depth pass per shadow-casting shell. Map size is
      // set per-light in <StarLight />.
      shadows={features.dynamicShadows ? "soft" : false}
      onCreated={({ gl }) => {
        setGlCanvas(gl.domElement);
        // The post-processing composer overrides this while it is mounted;
        // it matters for the Low preset, which renders straight to screen.
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
      }}
    >
      <XR store={xrStore}>
        <color attach="background" args={["#03040a"]} />
        {/* Key light follows the system's dominant star when there is one,
            and falls back to the fixed directional light when there is not. */}
        <StarLight />
        <SpaceEnvironment />
        <CameraController />
        {/* XRRig is identity-transform outside a session, so the desktop
            view is unaffected by its presence. */}
        <XRRig>{children}</XRRig>
        <XRGrabInteraction />
        <XRPanels />
        <CinematicPipeline />
      </XR>
    </Canvas>
  );
}
