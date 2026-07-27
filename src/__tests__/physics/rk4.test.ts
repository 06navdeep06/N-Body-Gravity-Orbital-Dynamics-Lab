/**
 * Unit tests for lib/physics/rk4.ts — RK4 integrator and energy metrics.
 */

import { stepRK4, calculateAccelerations, calculateEnergyMetrics } from "@/lib/physics/rk4";
import type { SystemState, CelestialBody } from "@/lib/physics/types";
import { length, sub } from "@/lib/physics/vector";

/** Helper: build a two-body system (fixed star + orbiting planet). */
function twoBodyCircular(G: number = 1, starMass: number = 1000, radius: number = 10): SystemState {
  // v = sqrt(GM/r) for circular orbit
  const v = Math.sqrt(G * starMass / radius);
  const star: CelestialBody = {
    id: "star",
    name: "Star",
    mass: starMass,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    color: "#ffff00",
    radius: 1,
    isFixed: true,
  };
  const planet: CelestialBody = {
    id: "planet",
    name: "Planet",
    mass: 0.001, // negligible vs star
    position: { x: radius, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: v },
    color: "#0088ff",
    radius: 0.3,
  };
  return {
    bodies: [star, planet],
    timeStep: 0.001,
    G,
    softening: 0.01,
  };
}

describe("calculateAccelerations", () => {
  it("produces correct Newtonian gravity for a two-body system", () => {
    const G = 1;
    const starMass = 1000;
    const r = 10;
    const state = twoBodyCircular(G, starMass, r);

    const accs = calculateAccelerations(state.bodies, G, state.softening);

    // Star acceleration should be nearly zero (planet mass is tiny)
    expect(Math.abs(accs[0]!.x)).toBeLessThan(1e-3);
    expect(Math.abs(accs[0]!.y)).toBeLessThan(1e-3);
    expect(Math.abs(accs[0]!.z)).toBeLessThan(1e-3);

    // Planet acceleration: a = GM/r² pointing toward star (-x direction)
    const expected_a = G * starMass / (r * r + state.softening * state.softening);
    expect(accs[1]!.x).toBeLessThan(0); // points toward star at origin
    expect(Math.abs(accs[1]!.x + expected_a)).toBeLessThan(0.1); // close to -GM/r²
  });

  it("obeys Newton's third law (equal and opposite)", () => {
    const state = twoBodyCircular();
    const accs = calculateAccelerations(state.bodies, state.G, state.softening);

    // F_12 = m1*a1 should equal -F_21 = -m2*a2
    const f1x = state.bodies[0]!.mass * accs[0]!.x;
    const f2x = state.bodies[1]!.mass * accs[1]!.x;
    expect(Math.abs(f1x + f2x)).toBeLessThan(1e-10);
  });
});

describe("stepRK4", () => {
  it("conserves energy over 1000 steps (< 0.01% drift)", () => {
    let state = twoBodyCircular();
    const e0 = calculateEnergyMetrics(state);

    for (let i = 0; i < 1000; i++) {
      state = stepRK4(state);
    }

    const e1 = calculateEnergyMetrics(state);
    const drift = Math.abs((e1.totalEnergy - e0.totalEnergy) / e0.totalEnergy);
    expect(drift).toBeLessThan(0.0001); // 0.01%
  });

  it("does not move fixed bodies", () => {
    let state = twoBodyCircular();
    for (let i = 0; i < 100; i++) {
      state = stepRK4(state);
    }
    const star = state.bodies[0]!;
    expect(star.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(star.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("planet returns near starting position after one full orbit", () => {
    const G = 1;
    const starMass = 1000;
    const r = 10;
    let state = twoBodyCircular(G, starMass, r);

    // Period T = 2*pi*sqrt(r³/GM)
    const T = 2 * Math.PI * Math.sqrt(r * r * r / (G * starMass));
    const steps = Math.round(T / state.timeStep);

    for (let i = 0; i < steps; i++) {
      state = stepRK4(state);
    }

    const planet = state.bodies[1]!;
    const dr = length(sub(planet.position, { x: r, y: 0, z: 0 }));
    // Should return to within 0.1% of the orbital radius
    expect(dr / r).toBeLessThan(0.001);
  });
});

describe("calculateEnergyMetrics", () => {
  it("returns negative total energy for a bound system", () => {
    const state = twoBodyCircular();
    const e = calculateEnergyMetrics(state);
    expect(e.totalEnergy).toBeLessThan(0);
  });

  it("kinetic energy is non-negative", () => {
    const state = twoBodyCircular();
    const e = calculateEnergyMetrics(state);
    expect(e.kineticEnergy).toBeGreaterThanOrEqual(0);
  });

  it("potential energy is negative for gravitationally bound pair", () => {
    const state = twoBodyCircular();
    const e = calculateEnergyMetrics(state);
    expect(e.potentialEnergy).toBeLessThan(0);
  });

  it("angular momentum is nonzero for orbiting system", () => {
    const state = twoBodyCircular();
    const e = calculateEnergyMetrics(state);
    const L = length(e.angularMomentum);
    expect(L).toBeGreaterThan(0);
  });
});
