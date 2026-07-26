"use client";

/**
 * Red translucent ring at the Roche limit around each "massive" body
 * (top-N by mass, above a fraction of total system mass). When any smaller
 * body strays inside the limit, the ring pulses and a "TIDAL DISRUPTION
 * ZONE" label appears.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { rocheLimitForSystem } from "@/lib/physics/tidal";
import type { CelestialBody } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MASS_FRACTION_THRESHOLD = 0.05;
const MAX_RINGS = 8;

interface RingInfo {
  body: CelestialBody;
  limit: number;
  breached: boolean;
}

function Ring({ info }: { info: RingInfo }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    mesh.position.set(info.body.position.x, info.body.position.y, info.body.position.z);
    if (info.breached) {
      const pulse = 0.35 + 0.3 * Math.sin(clock.elapsedTime * 8);
      material.opacity = pulse;
      mesh.scale.setScalar(1 + 0.04 * Math.sin(clock.elapsedTime * 8));
    } else {
      material.opacity = 0.22;
      mesh.scale.setScalar(1);
    }
  });

  const tube = Math.max(info.limit * 0.015, 0.01);

  return (
    <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[info.limit, tube, 8, 96]} />
      <meshBasicMaterial ref={materialRef} color="#ef4444" transparent opacity={0.22} depthWrite={false} />
      {info.breached && (
        <Html center distanceFactor={60} style={{ pointerEvents: "none" }}>
          <div
            style={{
              color: "#fca5a5",
              background: "rgba(60,0,0,0.75)",
              border: "1px solid #ef4444",
              borderRadius: 4,
              padding: "2px 8px",
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            TIDAL DISRUPTION ZONE
          </div>
        </Html>
      )}
    </mesh>
  );
}

export function RocheLimit() {
  const show = useSimulationStore((s) => s.showRocheLimits);
  const bodies = useSimulationStore((s) => s.system.bodies);

  const rings = useMemo<RingInfo[]>(() => {
    if (!show) return [];
    const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
    if (totalMass <= 0) return [];

    const massive = bodies
      .filter((b) => b.mass / totalMass > MASS_FRACTION_THRESHOLD)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, MAX_RINGS);

    return massive
      .map((body) => {
        const limit = rocheLimitForSystem(body, bodies);
        if (limit <= body.radius) return null;
        const breached = bodies.some((other) => {
          if (other.id === body.id || other.mass >= body.mass) return false;
          const dx = other.position.x - body.position.x;
          const dy = other.position.y - body.position.y;
          const dz = other.position.z - body.position.z;
          return dx * dx + dy * dy + dz * dz < limit * limit;
        });
        return { body, limit, breached };
      })
      .filter((r): r is RingInfo => r !== null);
  }, [show, bodies]);

  if (!show) return null;

  return (
    <>
      {rings.map((r) => (
        <Ring key={r.body.id} info={r} />
      ))}
    </>
  );
}
