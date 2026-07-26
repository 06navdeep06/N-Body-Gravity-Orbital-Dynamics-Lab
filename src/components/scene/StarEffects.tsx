"use client";

/**
 * Per-star flourishes: a Sparkles corona hugging the surface and a lens
 * flare (three/examples Lensflare with procedurally generated radial
 * textures — no image assets). Applied to fixed bodies and any body
 * holding >30% of total system mass.
 */

import { Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/examples/jsm/objects/Lensflare.js";
import type { CelestialBody } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const STAR_MASS_FRACTION = 0.3;
const MAX_STARS = 4;

/** Radial-gradient sprite texture for flare elements (no external assets). */
function makeFlareTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function StarFlare({ body, displayRadius }: { body: CelestialBody; displayRadius: number }) {
  const groupRef = useRef<THREE.Group>(null);

  const flare = useMemo(() => {
    const main = makeFlareTexture("rgba(255,246,214,0.9)", "rgba(255,190,80,0.35)");
    const ghost = makeFlareTexture("rgba(180,210,255,0.5)", "rgba(120,160,255,0.12)");
    const lensflare = new Lensflare();
    lensflare.addElement(new LensflareElement(main, 220, 0, new THREE.Color(body.color)));
    lensflare.addElement(new LensflareElement(ghost, 70, 0.5));
    lensflare.addElement(new LensflareElement(ghost, 40, 0.8));
    return lensflare;
  }, [body.color]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const live = useSimulationStore.getState().system.bodies.find((b) => b.id === body.id);
    if (live) group.position.set(live.position.x, live.position.y, live.position.z);
  });

  return (
    <group ref={groupRef}>
      <primitive object={flare} />
      <Sparkles
        count={40}
        scale={displayRadius * 3.2}
        size={displayRadius * 5}
        speed={0.35}
        color={body.color}
        opacity={0.55}
      />
    </group>
  );
}

export function StarEffects() {
  const bodies = useSimulationStore((s) => s.system.bodies);
  const visualRadiusScale = useSimulationStore((s) => s.visualRadiusScale);
  const maxDisplayRadius = useSimulationStore((s) => s.maxDisplayRadius);

  const stars = useMemo(() => {
    const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
    if (totalMass <= 0) return [];
    return bodies
      .filter((b) => b.isFixed || b.mass / totalMass > STAR_MASS_FRACTION)
      .slice(0, MAX_STARS);
  }, [bodies]);

  return (
    <>
      {stars.map((star) => {
        let displayRadius = star.radius * visualRadiusScale;
        if (maxDisplayRadius > 0) displayRadius = Math.min(displayRadius, maxDisplayRadius);
        return <StarFlare key={star.id} body={star} displayRadius={displayRadius} />;
      })}
    </>
  );
}
