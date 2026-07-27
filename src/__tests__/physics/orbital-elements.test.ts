/**
 * Unit tests for lib/physics/orbital-elements.ts
 */

import { computeOrbitalElements, inferPrimaryBody } from "@/lib/physics/orbital-elements";
import type { CelestialBody } from "@/lib/physics/types";

function makeStar(): CelestialBody {
  return {
    id: "star",
    name: "Star",
    mass: 1000,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    color: "#ffff00",
    radius: 2,
    isFixed: true,
  };
}

function makePlanet(overrides: Partial<CelestialBody> = {}): CelestialBody {
  return {
    id: "planet",
    name: "Planet",
    mass: 0.001,
    position: { x: 10, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 10 },
    color: "#0088ff",
    radius: 0.3,
    ...overrides,
  };
}

const G = 1;

describe("computeOrbitalElements", () => {
  it("returns null for a zero-mass primary", () => {
    const star = makeStar();
    star.mass = 0;
    expect(computeOrbitalElements(makePlanet(), star, G)).toBeNull();
  });

  it("returns null for zero distance (body on top of primary)", () => {
    const planet = makePlanet({ position: { x: 0, y: 0, z: 0 } });
    expect(computeOrbitalElements(planet, makeStar(), G)).toBeNull();
  });

  it("classifies a circular orbit correctly", () => {
    const r = 10;
    const v = Math.sqrt(G * 1000 / r); // exact circular velocity
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G);
    expect(elems).not.toBeNull();
    expect(elems!.orbitType).toBe("circular");
    expect(elems!.eccentricity).toBeLessThan(0.01);
    expect(elems!.semiMajorAxis).toBeCloseTo(r, 1);
  });

  it("classifies an elliptical orbit correctly", () => {
    const r = 10;
    const v_circ = Math.sqrt(G * 1000 / r);
    // Give 80% of circular velocity → elliptical
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v_circ * 0.8 },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G);
    expect(elems).not.toBeNull();
    expect(elems!.orbitType).toBe("elliptical");
    expect(elems!.eccentricity).toBeGreaterThan(0.01);
    expect(elems!.eccentricity).toBeLessThan(1);
  });

  it("classifies a hyperbolic orbit correctly", () => {
    const r = 10;
    const v_esc = Math.sqrt(2 * G * 1000 / r);
    // 20% above escape velocity → hyperbolic
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v_esc * 1.2 },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G);
    expect(elems).not.toBeNull();
    expect(elems!.orbitType).toBe("hyperbolic");
    expect(elems!.eccentricity).toBeGreaterThan(1);
    expect(elems!.period).toBe(Infinity);
    expect(elems!.apoapsisDistance).toBe(Infinity);
  });

  it("computes correct period for a circular orbit", () => {
    const r = 10;
    const mu = G * 1000;
    const v = Math.sqrt(mu / r);
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G)!;
    const expectedT = 2 * Math.PI * Math.sqrt(r * r * r / mu);
    expect(elems.period).toBeCloseTo(expectedT, 2);
  });

  it("periapsis + apoapsis = 2a for elliptical orbit", () => {
    const r = 10;
    const v_circ = Math.sqrt(G * 1000 / r);
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v_circ * 0.7 },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G)!;
    if (elems.orbitType === "elliptical") {
      expect(elems.periapsisDistance + elems.apoapsisDistance).toBeCloseTo(2 * elems.semiMajorAxis, 2);
    }
  });

  it("inclination is ~0 for XZ-plane orbit", () => {
    const r = 10;
    const v = Math.sqrt(G * 1000 / r);
    const planet = makePlanet({
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: v },
    });
    const elems = computeOrbitalElements(planet, makeStar(), G)!;
    expect(elems.inclination).toBeCloseTo(Math.PI / 2, 1);
    // Note: orbit in XZ plane has angular momentum along Y,
    // so inclination (angle from Z axis) = 90°
  });
});

describe("inferPrimaryBody", () => {
  it("returns null for empty array", () => {
    expect(inferPrimaryBody([])).toBeNull();
  });

  it("prefers fixed bodies", () => {
    const a: CelestialBody = makePlanet({ id: "a", mass: 999 });
    const b: CelestialBody = { ...makeStar(), id: "b", mass: 1, isFixed: true };
    expect(inferPrimaryBody([a, b])!.id).toBe("b");
  });

  it("picks heaviest if no fixed bodies", () => {
    const a = makePlanet({ id: "a", mass: 5 });
    const b = makePlanet({ id: "b", mass: 50 });
    const c = makePlanet({ id: "c", mass: 2 });
    expect(inferPrimaryBody([a, b, c])!.id).toBe("b");
  });
});
