/**
 * Barnes-Hut octree: the approximation must stay close to the brute-force
 * answer, and must reduce exactly to it as theta → 0.
 */

import { calculateAccelerationsBarnesHut } from "@/lib/physics/octree";
import { calculateAccelerations } from "@/lib/physics/rk4";
import type { CelestialBody } from "@/lib/physics/types";
import { length, sub } from "@/lib/physics/vector";

/** Deterministic cloud of bodies so the assertions are reproducible. */
function makeCloud(count: number, seed = 12345): CelestialBody[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    name: `b${i}`,
    mass: 0.5 + rand() * 5,
    position: { x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100, z: (rand() - 0.5) * 100 },
    velocity: { x: 0, y: 0, z: 0 },
    color: "#ffffff",
    radius: 0.1,
  }));
}

/** Max relative error between two acceleration fields. */
function maxRelativeError(
  approx: ReturnType<typeof calculateAccelerations>,
  exact: ReturnType<typeof calculateAccelerations>
): number {
  let worst = 0;
  for (let i = 0; i < exact.length; i++) {
    const magnitude = length(exact[i]!);
    if (magnitude < 1e-12) continue;
    worst = Math.max(worst, length(sub(approx[i]!, exact[i]!)) / magnitude);
  }
  return worst;
}

describe("Barnes-Hut octree", () => {
  const G = 1;
  const softening = 0.05;

  it("matches brute force within 1% at theta = 0.5", () => {
    const bodies = makeCloud(200);
    const exact = calculateAccelerations(bodies, G, softening);
    const approx = calculateAccelerationsBarnesHut(bodies, G, softening, 0.5);

    expect(approx).toHaveLength(bodies.length);
    expect(maxRelativeError(approx, exact)).toBeLessThan(0.01);
  });

  it("converges to brute force as theta approaches zero", () => {
    const bodies = makeCloud(120, 999);
    const exact = calculateAccelerations(bodies, G, softening);

    const coarse = maxRelativeError(calculateAccelerationsBarnesHut(bodies, G, softening, 1.0), exact);
    const fine = maxRelativeError(calculateAccelerationsBarnesHut(bodies, G, softening, 0.1), exact);

    // theta = 0 opens every node, so the tree walk becomes exact summation.
    expect(fine).toBeLessThan(coarse);
    expect(maxRelativeError(calculateAccelerationsBarnesHut(bodies, G, softening, 0), exact)).toBeLessThan(1e-9);
  });

  it("is exact for a two-body system regardless of theta", () => {
    const bodies: CelestialBody[] = [
      { id: "a", name: "a", mass: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fff", radius: 1 },
      { id: "b", name: "b", mass: 1, position: { x: 10, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fff", radius: 1 },
    ];
    const exact = calculateAccelerations(bodies, G, softening);
    const approx = calculateAccelerationsBarnesHut(bodies, G, softening, 2.0);
    expect(maxRelativeError(approx, exact)).toBeLessThan(1e-9);
  });

  it("handles empty and single-body inputs", () => {
    expect(calculateAccelerationsBarnesHut([], G, softening, 0.5)).toEqual([]);
    const single = makeCloud(1);
    const acc = calculateAccelerationsBarnesHut(single, G, softening, 0.5);
    expect(length(acc[0]!)).toBeLessThan(1e-12);
  });

  it("handles coincident bodies without producing NaN", () => {
    const bodies: CelestialBody[] = [
      { id: "a", name: "a", mass: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fff", radius: 1 },
      { id: "b", name: "b", mass: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fff", radius: 1 },
    ];
    for (const a of calculateAccelerationsBarnesHut(bodies, G, softening, 0.5)) {
      expect(Number.isFinite(a.x)).toBe(true);
      expect(Number.isFinite(a.y)).toBe(true);
      expect(Number.isFinite(a.z)).toBe(true);
    }
  });
});
