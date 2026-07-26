"use client";

/**
 * Translucent wireframe sphere around each orbiting body at its Hill
 * radius — the region where the body's own gravity dominates its primary's.
 */

import { useMemo } from "react";
import { hillSphereRadius } from "@/lib/physics/tidal";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MAX_SPHERES = 40;

export function HillSphere() {
  const show = useSimulationStore((s) => s.showHillSpheres);
  const bodies = useSimulationStore((s) => s.system.bodies);

  const spheres = useMemo(() => {
    if (!show) return [];
    const primary = inferPrimaryBody(bodies);
    if (!primary) return [];
    return bodies
      .filter((b) => b.id !== primary.id)
      .slice(0, MAX_SPHERES)
      .map((body) => ({
        id: body.id,
        color: body.color,
        position: body.position,
        radius: hillSphereRadius(body, primary),
      }))
      .filter((s) => s.radius > 0);
  }, [show, bodies]);

  if (!show) return null;

  return (
    <>
      {spheres.map((s) => (
        <mesh key={s.id} position={[s.position.x, s.position.y, s.position.z]}>
          <sphereGeometry args={[s.radius, 20, 14]} />
          <meshBasicMaterial color={s.color} wireframe transparent opacity={0.1} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
