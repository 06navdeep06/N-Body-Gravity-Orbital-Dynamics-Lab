"use client";

/**
 * Dashed cyan arc showing the planned Hohmann transfer ellipse: half an
 * ellipse from the departure body's current position out to the arrival
 * radius, swept in the departure body's actual orbit direction around the
 * primary.
 */

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const ARC_SEGMENTS = 96;

export function TransferArc() {
  const plannedTransfer = useSimulationStore((s) => s.plannedTransfer);
  const bodies = useSimulationStore((s) => s.system.bodies);

  const points = useMemo(() => {
    if (!plannedTransfer) return null;
    const primary = bodies.find((b) => b.id === plannedTransfer.primaryId);
    const departure = bodies.find((b) => b.id === plannedTransfer.departureId);
    if (!primary || !departure) return null;

    const { r1, r2 } = plannedTransfer;
    const a = (r1 + r2) / 2;
    const e = Math.abs(r2 - r1) / (r1 + r2);
    const p = a * (1 - e * e);

    // Current polar angle of the departure body around the primary (XZ plane).
    const dx = departure.position.x - primary.position.x;
    const dz = departure.position.z - primary.position.z;
    const phi0 = Math.atan2(dz, dx);

    // Orbit direction: sign of d(phi)/dt = (x*vz - z*vx) / r^2.
    const dvx = departure.velocity.x - primary.velocity.x;
    const dvz = departure.velocity.z - primary.velocity.z;
    const sweepSign = Math.sign(dx * dvz - dz * dvx) || 1;

    // True anomaly at departure: 0 (periapsis) going out, pi (apoapsis) coming in.
    const theta0 = r1 <= r2 ? 0 : Math.PI;

    const pts: [number, number, number][] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const sweep = (i / ARC_SEGMENTS) * Math.PI;
      const r = p / (1 + e * Math.cos(theta0 + sweep));
      const phi = phi0 + sweepSign * sweep;
      pts.push([
        primary.position.x + r * Math.cos(phi),
        primary.position.y,
        primary.position.z + r * Math.sin(phi),
      ]);
    }
    return pts;
  }, [plannedTransfer, bodies]);

  if (!points) return null;

  return (
    <Line points={points} color="#22d3ee" dashed dashSize={0.8} gapSize={0.5} transparent opacity={0.8} />
  );
}
