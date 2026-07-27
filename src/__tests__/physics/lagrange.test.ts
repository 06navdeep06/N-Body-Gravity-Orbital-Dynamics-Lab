/**
 * Lagrange points. The collinear points are validated against the
 * small-mass-ratio analytic approximation r_H = a·(m₂/3m₁)^(1/3), and the
 * triangular points against their exact equilateral-triangle definition.
 */

import { computeLagrangePoints } from "@/lib/physics/lagrange";
import type { CelestialBody } from "@/lib/physics/types";
import { length, sub } from "@/lib/physics/vector";

const G = 1;

function body(id: string, mass: number, x: number, vz: number): CelestialBody {
  return {
    id,
    name: id,
    mass,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: vz },
    color: "#ffffff",
    radius: 0.1,
  };
}

describe("Lagrange points", () => {
  // Sun-Earth mass ratio (3.003e-6) at unit separation.
  const sunMass = 1;
  const earthMass = 3.003e-6;
  const separation = 1;

  const sun = body("sun", sunMass, 0, 0);
  const earth = body("earth", earthMass, separation, Math.sqrt((G * sunMass) / separation));
  const points = computeLagrangePoints(sun, earth, G);

  /** Hill radius — the leading-order distance of L1/L2 from the secondary. */
  const hill = separation * Math.cbrt(earthMass / (3 * sunMass));

  it("returns exactly five points", () => {
    expect(points).toHaveLength(5);
  });

  it("places L1 sunward of Earth at ~1 Hill radius", () => {
    const l1 = points[0]!;
    const distanceFromEarth = separation - l1.x;
    // Real Sun-Earth L1 is 1.5e6 km of 1.496e8 km => 0.01 AU, and the Hill
    // radius is 0.0100 AU; the true value sits a few % inside it.
    expect(distanceFromEarth).toBeGreaterThan(0);
    expect(distanceFromEarth / hill).toBeGreaterThan(0.9);
    expect(distanceFromEarth / hill).toBeLessThan(1.05);
    // Absolute sanity: ~0.01 of the separation.
    expect(distanceFromEarth).toBeGreaterThan(0.008);
    expect(distanceFromEarth).toBeLessThan(0.012);
  });

  it("places L2 beyond Earth at ~1 Hill radius", () => {
    const l2 = points[1]!;
    const distanceFromEarth = l2.x - separation;
    expect(distanceFromEarth).toBeGreaterThan(0);
    expect(distanceFromEarth / hill).toBeGreaterThan(0.9);
    expect(distanceFromEarth / hill).toBeLessThan(1.05);
  });

  it("places L3 on the far side of the Sun near -a", () => {
    const l3 = points[2]!;
    expect(l3.x).toBeLessThan(0);
    expect(Math.abs(l3.x)).toBeGreaterThan(separation * 0.98);
    expect(Math.abs(l3.x)).toBeLessThan(separation * 1.02);
  });

  it("places L4 and L5 at the equilateral-triangle points", () => {
    const [l4, l5] = [points[3]!, points[4]!];
    for (const point of [l4, l5]) {
      // Equidistant from both primaries, at exactly the separation.
      expect(length(sub(point, sun.position))).toBeCloseTo(separation, 6);
      expect(length(sub(point, earth.position))).toBeCloseTo(separation, 6);
    }
    // They are mirror images across the primary-secondary axis.
    expect(l4.z).toBeCloseTo(-l5.z, 9);
    expect(Math.abs(l4.z)).toBeCloseTo(Math.sin(Math.PI / 3) * separation, 6);
  });

  it("satisfies the collinear force balance at L1/L2/L3", () => {
    // In the co-rotating frame the net radial acceleration must vanish.
    const n2 = (G * (sunMass + earthMass)) / separation ** 3;
    const xcm = (earthMass * separation) / (sunMass + earthMass);

    for (const point of [points[0]!, points[1]!, points[2]!]) {
      const x = point.x;
      const dSun = x - 0;
      const dEarth = x - separation;
      const net =
        (-G * sunMass * Math.sign(dSun)) / (dSun * dSun) +
        (-G * earthMass * Math.sign(dEarth)) / (dEarth * dEarth) +
        n2 * (x - xcm);
      // Scale the tolerance by the dominant term's magnitude.
      expect(Math.abs(net)).toBeLessThan(1e-6);
    }
  });

  it("handles equal masses symmetrically", () => {
    const a = body("a", 1, 0, 0);
    const b = body("b", 1, 2, 1);
    const equal = computeLagrangePoints(a, b, G);
    // L1 sits exactly at the midpoint for equal masses.
    expect(equal[0]!.x).toBeCloseTo(1, 6);
  });

  it("degrades gracefully for coincident bodies", () => {
    const a = body("a", 1, 0, 0);
    const b = body("b", 1, 0, 0);
    const degenerate = computeLagrangePoints(a, b, G);
    expect(degenerate).toHaveLength(5);
    for (const point of degenerate) {
      expect(Number.isFinite(point.x)).toBe(true);
    }
  });
});
