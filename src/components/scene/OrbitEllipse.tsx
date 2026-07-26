"use client";

/**
 * Renders each body's predicted Keplerian trajectory: a dashed ellipse for
 * bound orbits (e < 1), or diverging dashed asymptote rays for unbound
 * ones (e >= 1). Toggled by the "Show Predicted Orbits" control.
 */

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import type { CelestialBody, Vector3D } from "@/lib/physics/types";
import { computeOrbitalElements, inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const ELLIPSE_SEGMENTS = 128;
const ASYMPTOTE_LENGTH = 60;

/** Perifocal (p, q) -> inertial (x, y, z), using the standard 3-1-3 rotation. */
function perifocalToInertial(
  p: number,
  q: number,
  inclination: number,
  raan: number,
  argPeriapsis: number
): Vector3D {
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosW = Math.cos(argPeriapsis);
  const sinW = Math.sin(argPeriapsis);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);

  const x = (cosO * cosW - sinO * sinW * cosI) * p + (-cosO * sinW - sinO * cosW * cosI) * q;
  const y = (sinO * cosW + cosO * sinW * cosI) * p + (-sinO * sinW + cosO * cosW * cosI) * q;
  const z = sinW * sinI * p + cosW * sinI * q;

  return { x, y, z };
}

function EllipsePath({ body, primary }: { body: CelestialBody; primary: CelestialBody }) {
  const G = useSimulationStore((s) => s.system.G);

  const points = useMemo(() => {
    const elements = computeOrbitalElements(body, primary, G);
    if (!elements) return null;

    const { semiMajorAxis: a, eccentricity: e, inclination, raan, argPeriapsis } = elements;
    const pts: [number, number, number][] = [];

    if (e < 1) {
      for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
        const theta = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
        const p = r * Math.cos(theta);
        const q = r * Math.sin(theta);
        const world = perifocalToInertial(p, q, inclination, raan, argPeriapsis);
        pts.push([primary.position.x + world.x, primary.position.y + world.y, primary.position.z + world.z]);
      }
      return { pts, dashed: true, hyperbolic: false };
    }

    // Unbound: draw two diverging asymptote rays from the true-anomaly
    // limit where r -> infinity (cos(theta_inf) = -1/e).
    const thetaInf = Math.acos(-1 / e);
    const rayA: [number, number, number][] = [];
    const rayB: [number, number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * thetaInf * 0.98; // stop just short of the true asymptote angle
      const r = Math.min(ASYMPTOTE_LENGTH, (a * (1 - e * e)) / (1 + e * Math.cos(t)));
      const pA = r * Math.cos(t);
      const qA = r * Math.sin(t);
      const wA = perifocalToInertial(pA, qA, inclination, raan, argPeriapsis);
      rayA.push([primary.position.x + wA.x, primary.position.y + wA.y, primary.position.z + wA.z]);

      const pB = r * Math.cos(-t);
      const qB = r * Math.sin(-t);
      const wB = perifocalToInertial(pB, qB, inclination, raan, argPeriapsis);
      rayB.push([primary.position.x + wB.x, primary.position.y + wB.y, primary.position.z + wB.z]);
    }
    return { pts: [...rayA.reverse(), ...rayB], dashed: true, hyperbolic: true };
  }, [body, primary, G]);

  if (!points) return null;

  return (
    <Line
      points={points.pts}
      color={body.color}
      transparent
      opacity={0.3}
      dashed
      dashSize={points.hyperbolic ? 1.5 : 1}
      gapSize={points.hyperbolic ? 0.8 : 0.6}
    />
  );
}

export function OrbitEllipse() {
  const showOrbitEllipses = useSimulationStore((s) => s.showOrbitEllipses);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const primaryBodyId = useSimulationStore((s) => s.primaryBodyId);

  if (!showOrbitEllipses) return null;

  const primary = (primaryBodyId && bodies.find((b) => b.id === primaryBodyId)) || inferPrimaryBody(bodies);
  if (!primary) return null;

  return (
    <>
      {bodies
        .filter((b) => b.id !== primary.id && !b.isFixed)
        .map((body) => (
          <EllipsePath key={body.id} body={body} primary={primary} />
        ))}
    </>
  );
}
