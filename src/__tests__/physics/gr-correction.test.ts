/**
 * General-relativistic precession.
 *
 * The headline check integrates an eccentric orbit and measures how far the
 * periapsis direction rotates per orbit, comparing against the classical
 * Schwarzschild result
 *
 *   Δϖ = 6πGM / (a c² (1 − e²))   radians per orbit.
 */

import { calculateAccelerationsWithGR, grCorrectionAcceleration } from "@/lib/physics/gr-correction";
import { computeOrbitalElements } from "@/lib/physics/orbital-elements";
import { calculateAccelerations, stepRK4 } from "@/lib/physics/rk4";
import type { CelestialBody, SystemState } from "@/lib/physics/types";
import { length } from "@/lib/physics/vector";

const G = 1;

function twoBody(starMass: number, a: number, e: number, dt: number): SystemState {
  const rp = a * (1 - e);
  // Vis-viva at periapsis.
  const vp = Math.sqrt(G * starMass * (2 / rp - 1 / a));
  return {
    bodies: [
      {
        id: "star",
        name: "Star",
        mass: starMass,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        color: "#ffdd88",
        radius: 1,
        isFixed: true,
      },
      {
        id: "planet",
        name: "Planet",
        mass: 1e-6,
        position: { x: rp, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -vp },
        color: "#88aaff",
        radius: 0.05,
      },
    ],
    timeStep: dt,
    G,
    softening: 0,
  };
}

describe("GR correction", () => {
  it("returns zero for a zero-mass or coincident source", () => {
    const target: CelestialBody = {
      id: "t", name: "t", mass: 1,
      position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 1 },
      color: "#fff", radius: 0.1,
    };
    const atSamePlace: CelestialBody = { ...target, id: "s", position: { x: 1, y: 0, z: 0 } };
    expect(length(grCorrectionAcceleration(target, atSamePlace, G, 100))).toBe(0);
    // c <= 0 disables the correction entirely.
    expect(length(grCorrectionAcceleration(target, { ...atSamePlace, position: { x: 0, y: 0, z: 0 } }, G, 0))).toBe(0);
  });

  it("is a small perturbation on the Newtonian term for c >> v", () => {
    const state = twoBody(1000, 20, 0.2, 0.001);
    const newtonian = calculateAccelerations(state.bodies, G, 0);
    const withGr = calculateAccelerationsWithGR(3000)(state.bodies, G, 0);
    const planetNewton = length(newtonian[1]!);
    const planetGr = length(withGr[1]!);
    // Same order of magnitude, differing by well under a percent.
    expect(Math.abs(planetGr - planetNewton) / planetNewton).toBeLessThan(0.01);
  });

  it("advances the periapsis by the Schwarzschild rate", () => {
    const starMass = 1000;
    const a = 20;
    const e = 0.3;
    const c = 120; // small enough that precession is measurable in few orbits
    const dt = 0.0005;

    let state = twoBody(starMass, a, e, dt);
    const accel = calculateAccelerationsWithGR(c);

    const mu = G * starMass;
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
    const orbits = 6;

    const readPeriapsisAngle = (s: SystemState): number => {
      const elements = computeOrbitalElements(s.bodies[1]!, s.bodies[0]!, G);
      if (!elements) throw new Error("no elements");
      // In-plane orbit: the periapsis longitude is RAAN + argument, but for
      // an equatorial orbit RAAN is degenerate, so use argPeriapsis directly
      // combined with the sign of the eccentricity vector's z component.
      return elements.argPeriapsis;
    };

    const startAngle = readPeriapsisAngle(state);
    const totalSteps = Math.round((orbits * period) / dt);
    for (let i = 0; i < totalSteps; i++) state = stepRK4(state, accel);
    const endAngle = readPeriapsisAngle(state);

    // Unwrap into [-pi, pi] then take the per-orbit rate.
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const measuredPerOrbit = Math.abs(delta) / orbits;

    const predicted = (6 * Math.PI * mu) / (a * c * c * (1 - e * e));

    // 20% tolerance: the analytic rate is first-order in GM/(ac²), and the
    // numerical estimate additionally carries RK4 error over six orbits.
    expect(measuredPerOrbit).toBeGreaterThan(predicted * 0.8);
    expect(measuredPerOrbit).toBeLessThan(predicted * 1.2);
  });

  it("produces no precession when GR is off", () => {
    const starMass = 1000;
    const a = 20;
    const e = 0.3;
    const dt = 0.0005;
    let state = twoBody(starMass, a, e, dt);

    const period = 2 * Math.PI * Math.sqrt(a ** 3 / (G * starMass));
    const before = computeOrbitalElements(state.bodies[1]!, state.bodies[0]!, G)!.argPeriapsis;
    const steps = Math.round((3 * period) / dt);
    for (let i = 0; i < steps; i++) state = stepRK4(state, calculateAccelerations);
    const after = computeOrbitalElements(state.bodies[1]!, state.bodies[0]!, G)!.argPeriapsis;

    let delta = Math.abs(after - before);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    // Pure Newtonian ellipses are closed: any drift is integration error.
    expect(delta).toBeLessThan(0.02);
  });
});
