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

/** Per-body relative errors between two acceleration fields, ascending. */
function relativeErrors(
  approx: ReturnType<typeof calculateAccelerations>,
  exact: ReturnType<typeof calculateAccelerations>
): number[] {
  const errors: number[] = [];
  for (let i = 0; i < exact.length; i++) {
    const magnitude = length(exact[i]!);
    if (magnitude < 1e-12) continue;
    errors.push(length(sub(approx[i]!, exact[i]!)) / magnitude);
  }
  return errors.sort((a, b) => a - b);
}

function meanRelativeError(
  approx: ReturnType<typeof calculateAccelerations>,
  exact: ReturnType<typeof calculateAccelerations>
): number {
  const errors = relativeErrors(approx, exact);
  return errors.reduce((sum, e) => sum + e, 0) / Math.max(1, errors.length);
}

function maxRelativeError(
  approx: ReturnType<typeof calculateAccelerations>,
  exact: ReturnType<typeof calculateAccelerations>
): number {
  const errors = relativeErrors(approx, exact);
  return errors.length > 0 ? errors[errors.length - 1]! : 0;
}

describe("Barnes-Hut octree", () => {
  const G = 1;
  const softening = 0.05;

  it("matches brute force to better than 1% mean error at theta = 0.5", () => {
    const bodies = makeCloud(200);
    const exact = calculateAccelerations(bodies, G, softening);
    const approx = calculateAccelerationsBarnesHut(bodies, G, softening, 0.5);

    expect(approx).toHaveLength(bodies.length);
    // Mean and 95th-percentile error are the meaningful accuracy measures.
    // The single worst body is not: a body whose pairwise contributions
    // nearly cancel has a tiny |a| denominator, so a small absolute error
    // shows up as a large *relative* one. That is inherent to Barnes-Hut,
    // not a defect — see the convergence test below for the real check.
    expect(meanRelativeError(approx, exact)).toBeLessThan(0.01);

    const errors = relativeErrors(approx, exact);
    const p95 = errors[Math.floor(errors.length * 0.95)]!;
    expect(p95).toBeLessThan(0.05);
  });

  it("converges monotonically to brute force as theta shrinks", () => {
    const bodies = makeCloud(120, 999);
    const exact = calculateAccelerations(bodies, G, softening);

    const errorAt = (theta: number) =>
      meanRelativeError(calculateAccelerationsBarnesHut(bodies, G, softening, theta), exact);

    const coarse = errorAt(1.0);
    const mid = errorAt(0.5);
    const fine = errorAt(0.1);

    expect(mid).toBeLessThan(coarse);
    expect(fine).toBeLessThan(mid);
    // theta = 0 opens every node, so the walk degenerates to exact summation.
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
