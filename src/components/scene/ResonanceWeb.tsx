"use client";

/**
 * Draws an arc between every pair of bodies locked in a mean-motion
 * resonance, labelled with the p:q ratio and thickened by resonance
 * strength.
 *
 * Detection is O(N²) over orbital elements, so it runs on a timer (not per
 * frame) — resonances are a property of the orbits, which drift far slower
 * than the render loop.
 */

import { Html, Line } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { detectResonances, type ResonancePair } from "@/lib/physics/resonance";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const DETECT_INTERVAL_MS = 700;
const MAX_ARCS = 24;
const ARC_SEGMENTS = 32;

/** Distinct hue per resonance order so 2:1 and 3:2 read differently. */
function ratioColor(p: number, q: number): string {
  const order = p + q;
  const hue = (order * 47) % 360;
  return `hsl(${hue}, 85%, 62%)`;
}

function ResonanceArc({ pair }: { pair: ResonancePair }) {
  const bodies = useSimulationStore((s) => s.system.bodies);

  const geometry = useMemo(() => {
    const a = bodies.find((b) => b.id === pair.bodyA);
    const b = bodies.find((b) => b.id === pair.bodyB);
    if (!a || !b) return null;

    const start = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
    const end = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
    // Bow the arc up out of the orbital plane so overlapping pairs stay legible.
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * 0.28 + 1;

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const points = curve.getPoints(ARC_SEGMENTS).map((p) => [p.x, p.y, p.z] as [number, number, number]);
    return { points, labelAt: mid };
  }, [bodies, pair.bodyA, pair.bodyB]);

  if (!geometry) return null;
  const color = ratioColor(pair.ratio[0], pair.ratio[1]);

  return (
    <>
      <Line
        points={geometry.points}
        color={color}
        lineWidth={0.8 + pair.strength * 3.2}
        transparent
        opacity={0.35 + pair.strength * 0.5}
      />
      <Html
        position={[geometry.labelAt.x, geometry.labelAt.y, geometry.labelAt.z]}
        center
        distanceFactor={45}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            color,
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 700,
            textShadow: "0 0 5px rgba(0,0,0,0.95)",
            whiteSpace: "nowrap",
          }}
        >
          {pair.ratio[0]}:{pair.ratio[1]}
        </div>
      </Html>
    </>
  );
}

export function ResonanceWeb() {
  const show = useSimulationStore((s) => s.showResonances);
  const [pairs, setPairs] = useState<ResonancePair[]>([]);

  useEffect(() => {
    if (!show) return;
    const detect = () => {
      const { system } = useSimulationStore.getState();
      const primary = inferPrimaryBody(system.bodies);
      setPairs(
        primary ? detectResonances(system.bodies, primary, system.G).slice(0, MAX_ARCS) : []
      );
    };
    // Deferred rather than called inline: a synchronous setState in an
    // effect body triggers a cascading re-render.
    const initial = setTimeout(detect, 0);
    const timer = setInterval(detect, DETECT_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      setPairs([]);
    };
  }, [show]);

  if (!show) return null;

  return (
    <>
      {pairs.map((pair) => (
        <ResonanceArc key={`${pair.bodyA}-${pair.bodyB}`} pair={pair} />
      ))}
    </>
  );
}
