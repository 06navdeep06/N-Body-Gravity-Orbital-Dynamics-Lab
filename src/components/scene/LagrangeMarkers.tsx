"use client";

/**
 * Renders the five Lagrange points for a two-body subsystem: only shown
 * when exactly two "sufficiently massive" bodies exist (mass > 1% of the
 * system total — filters out e.g. two planets among an asteroid belt).
 * L1-L3 (unstable) render yellow, L4/L5 (stable) render green.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { computeLagrangePoints } from "@/lib/physics/lagrange";
import type { CelestialBody, Vector3D } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MASS_FRACTION_THRESHOLD = 0.01;
const LABELS = ["L1", "L2", "L3", "L4", "L5"] as const;
const UNSTABLE_COLOR = "#facc15";
const STABLE_COLOR = "#4ade80";

function findMassiveBodies(bodies: CelestialBody[]): [CelestialBody, CelestialBody] | null {
  const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
  if (totalMass <= 0) return null;

  const massive = bodies.filter((b) => b.mass / totalMass > MASS_FRACTION_THRESHOLD);
  if (massive.length !== 2) return null;

  const [a, b] = massive as [CelestialBody, CelestialBody];
  return a.mass >= b.mass ? [a, b] : [b, a];
}

function Marker({ position, label, color }: { position: Vector3D; label: string; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    ref.current?.position.set(position.x, position.y, position.z);
  });

  return (
    <group ref={ref}>
      <mesh>
        <octahedronGeometry args={[0.6, 0]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      <Html distanceFactor={40} style={{ pointerEvents: "none" }}>
        <div
          style={{
            color,
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 700,
            textShadow: "0 0 4px rgba(0,0,0,0.9)",
            transform: "translate(8px, -8px)",
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

export function LagrangeMarkers() {
  const showLagrangePoints = useSimulationStore((s) => s.showLagrangePoints);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);

  const pair = showLagrangePoints ? findMassiveBodies(bodies) : null;

  const points = useMemo(() => {
    if (!pair) return null;
    return computeLagrangePoints(pair[0], pair[1], G);
  }, [pair, G]);

  if (!points) return null;

  return (
    <>
      {points.map((p, i) => (
        <Marker
          key={LABELS[i]}
          position={p}
          label={LABELS[i]!}
          color={i < 3 ? UNSTABLE_COLOR : STABLE_COLOR}
        />
      ))}
    </>
  );
}
