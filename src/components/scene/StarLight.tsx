"use client";

/**
 * Scene key light.
 *
 * The original renderer used a fixed directional light plus strong ambient,
 * for a good reason recorded in `Scene.tsx`: a point light centred on a body
 * lights that body from inside itself, so its own surface renders black.
 *
 * That reason no longer applies to the body that is *actually* the star,
 * because `<PhotorealisticBody />` draws stars with an unlit emissive
 * material. So when a system has a dominant star, the light is placed on it —
 * which is what makes terminators track orbital phase, planets cast shadows
 * on their moons, and rings band their shadows across the planet below. When
 * no body dominates (three-body toys, galaxy collisions), the fixed
 * directional light is used exactly as before.
 *
 * Shadow-map extents are derived from the system's own scale rather than
 * hard-coded, because the presets span AU-based units and toy units that
 * differ by many orders of magnitude — a fixed `shadow.camera.far` would
 * either clip every shadow or quantise them all away.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { topologySignature } from "@/lib/render/body-roles";
import { dominantStar, FALLBACK_LIGHT_POSITION } from "@/lib/render/lighting";
import { useQualityPreset } from "@/lib/render/quality-preset";
import { useSimulationStore } from "@/lib/stores/simulation-store";

/** Ambient fill by tier. Cinematic goes dark: space has no fill light. */
const AMBIENT_CINEMATIC = 0.12;
const AMBIENT_DEFAULT = 0.55;

export function StarLight() {
  const features = useQualityPreset();
  // Primitive selectors only: `s.system.bodies` is a new array every physics
  // step, and re-running applyProps over a shadow-casting light sixty times a
  // second is pure waste. See `topologySignature`.
  const topology = useSimulationStore((s) => topologySignature(s.system.bodies));
  const starId = useSimulationStore((s) => dominantStar(s.system.bodies)?.id ?? null);
  const starColor = useSimulationStore((s) => dominantStar(s.system.bodies)?.color ?? "#ffffff");

  const pointRef = useRef<THREE.PointLight>(null);

  /**
   * Farthest body from the star — the radius the shadow camera has to cover.
   *
   * Sampled when the body set changes rather than tracked continuously: the
   * headroom factor below absorbs ordinary orbital motion, and resizing a
   * shadow frustum every frame invalidates the map every frame.
   */
  const { star, systemExtent } = useMemo(() => {
    const { bodies } = useSimulationStore.getState().system;
    const current = starId ? (bodies.find((b) => b.id === starId) ?? null) : null;
    if (!current) return { star: null, systemExtent: 0 };

    let maxDistanceSq = 0;
    for (const body of bodies) {
      const dx = body.position.x - current.position.x;
      const dy = body.position.y - current.position.y;
      const dz = body.position.z - current.position.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > maxDistanceSq) maxDistanceSq = distanceSq;
    }
    return { star: current, systemExtent: Math.sqrt(maxDistanceSq) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `topology` is the staleness signal for the getState() read above
  }, [starId, topology]);

  useFrame(() => {
    const light = pointRef.current;
    if (!light || !star) return;
    const live = useSimulationStore.getState().system.bodies.find((b) => b.id === star.id);
    if (live) light.position.set(live.position.x, live.position.y, live.position.z);
  });

  const ambientIntensity =
    features.preset === "cinematic" ? AMBIENT_CINEMATIC : AMBIENT_DEFAULT;

  if (!star) {
    return (
      <>
        <ambientLight intensity={AMBIENT_DEFAULT} />
        <directionalLight
          position={[...FALLBACK_LIGHT_POSITION]}
          intensity={1.1}
          color="#fff6e0"
        />
      </>
    );
  }

  // Shadow bounds with generous headroom, so a body on an eccentric orbit
  // does not lose its shadow at apoapsis.
  const shadowFar = Math.max(systemExtent * 2.5, 1);
  const shadowNear = Math.max(shadowFar * 1e-4, 1e-6);

  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <pointLight
        ref={pointRef}
        position={[star.position.x, star.position.y, star.position.z]}
        // decay=0 makes this behave as a directional source at any distance.
        // Inverse-square falloff over an AU-scaled system would leave the
        // outer planets unlit to within a rounding error of black.
        decay={0}
        intensity={1.35}
        color={starColor}
        castShadow={features.dynamicShadows}
        shadow-mapSize-width={features.shadowMapSize}
        shadow-mapSize-height={features.shadowMapSize}
        shadow-camera-near={shadowNear}
        shadow-camera-far={shadowFar}
        // Scaled to the system: a fixed bias is either useless or produces
        // peter-panning depending on how big a simulation unit happens to be.
        shadow-bias={-1e-4}
        shadow-normalBias={systemExtent * 1e-3}
      />
      {/* A dim fill from the opposite side keeps night sides readable rather
          than pure black — a deliberate legibility choice for a teaching tool,
          not a physical one. */}
      <directionalLight position={[...FALLBACK_LIGHT_POSITION]} intensity={0.08} color="#8ea8d0" />
    </>
  );
}
