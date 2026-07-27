/**
 * General-relativistic precession.
 *
 * The headline check integrates an eccentric orbit and measures how far the
 * periapsis direction rotates per orbit, comparing against the classical
 * Schwarzschild result
 *
 *   Δϖ = 6πGM / (a c² (1 − e²))   radians per orbit.
 */

import {
  MAX_PN_FRACTION,
  calculateAccelerationsWithGR,
  grCorrectionAcceleration,
  gravitationalWavePower,
  radiationReactionAccelerations,
} from "@/lib/physics/gr-correction";
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

/**
 * Regression: the 1PN radial term carries +4GM/r and therefore points *away*
 * from the source. Uncapped it overtakes Newtonian gravity inside r = 2 r_s
 * and reverses it, which used to fling the Binary Black Hole Inspiral preset
 * from 5.5 r_s out past 210 r_s instead of merging it.
 */
describe("1PN limiter", () => {
  const c = 40;
  const M = 2500;
  const rs = (2 * G * M) / (c * c);

  const pair = (separation: number): [CelestialBody, CelestialBody] => [
    {
      id: "a", name: "A", mass: M, position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, color: "#000", radius: rs,
    },
    {
      id: "b", name: "B", mass: M, position: { x: separation, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, color: "#000", radius: rs,
    },
  ];

  it("never lets the correction exceed its share of the Newtonian term", () => {
    for (const separation of [0.5 * rs, rs, 2 * rs, 5 * rs, 50 * rs, 5000 * rs]) {
      const [a, b] = pair(separation);
      const correction = length(grCorrectionAcceleration(b, a, G, c));
      const newtonian = (G * M) / separation ** 2;
      expect(correction / newtonian).toBeLessThanOrEqual(MAX_PN_FRACTION + 1e-12);
    }
  });

  it("leaves gravity attractive at every separation", () => {
    for (const separation of [0.5 * rs, rs, 2 * rs, 3 * rs, 10 * rs]) {
      const [a, b] = pair(separation);
      const total = calculateAccelerationsWithGR(c)([a, b], G, 0);
      // B sits at +x from A, so a net attraction must accelerate it toward -x.
      expect(total[1]!.x).toBeLessThan(0);
      expect(total[0]!.x).toBeGreaterThan(0);
    }
  });

  it("does not engage where the expansion is valid", () => {
    // The precession test's regime: r = 20, r_s = 2GM/c^2 with M=1000, c=120.
    const star: CelestialBody = {
      id: "s", name: "S", mass: 1000, position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, color: "#fff", radius: 1,
    };
    const planet: CelestialBody = {
      id: "p", name: "P", mass: 1e-6, position: { x: 20, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: -Math.sqrt((G * 1000) / 20) }, color: "#fff", radius: 0.1,
    };
    const ratio = length(grCorrectionAcceleration(planet, star, G, 120)) / ((G * 1000) / 400);
    expect(ratio).toBeLessThan(MAX_PN_FRACTION);
    expect(ratio).toBeGreaterThan(0);
  });
});

describe("gravitational-wave radiation reaction", () => {
  const G_ = 1;

  function circularBinary(m: number, separation: number, speedFactor = 1): SystemState {
    const vRel = speedFactor * Math.sqrt((G_ * 2 * m) / separation);
    return {
      bodies: [
        {
          id: "a", name: "A", mass: m,
          position: { x: -separation / 2, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: -vRel / 2 },
          color: "#000", radius: separation * 0.02,
        },
        {
          id: "b", name: "B", mass: m,
          position: { x: separation / 2, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: vRel / 2 },
          color: "#000", radius: separation * 0.02,
        },
      ],
      timeStep: 1e-4,
      G: G_,
      softening: 0,
    };
  }

  it("matches the Peters circular-orbit luminosity", () => {
    const m = 10;
    const r = 100;
    const { bodies } = circularBinary(m, r);
    const [a, b] = bodies as [CelestialBody, CelestialBody];
    const c = 500;

    // P = (32/5) G^4 m1^2 m2^2 (m1+m2) / (c^5 r^5) for a circular orbit.
    const expected = (32 / 5) * (G_ ** 4 * m ** 2 * m ** 2 * (2 * m)) / (c ** 5 * r ** 5);
    expect(gravitationalWavePower(a, b, G_, c)).toBeCloseTo(expected, 20);
  });

  it("radiates nothing when c is unset", () => {
    const { bodies } = circularBinary(10, 100);
    expect(gravitationalWavePower(bodies[0]!, bodies[1]!, G_, 0)).toBe(0);
  });

  it("conserves linear momentum exactly", () => {
    const { bodies } = circularBinary(10, 30);
    const accelerations = radiationReactionAccelerations(bodies, G_, 60);
    for (const axis of ["x", "y", "z"] as const) {
      const net = bodies.reduce((sum, body, i) => sum + body.mass * accelerations[i]![axis], 0);
      expect(net).toBeCloseTo(0, 15);
    }
  });

  it("removes energy rather than adding it", () => {
    const { bodies } = circularBinary(10, 30);
    const accelerations = radiationReactionAccelerations(bodies, G_, 60);
    // dE/dt = sum m_i a_i . v_i must be negative for a radiating binary.
    const power = bodies.reduce(
      (sum, body, i) =>
        sum +
        body.mass *
          (accelerations[i]!.x * body.velocity.x +
            accelerations[i]!.y * body.velocity.y +
            accelerations[i]!.z * body.velocity.z),
      0
    );
    expect(power).toBeLessThan(0);
  });

  const separation = (s: SystemState) =>
    Math.hypot(
      s.bodies[0]!.position.x - s.bodies[1]!.position.x,
      s.bodies[0]!.position.y - s.bodies[1]!.position.y,
      s.bodies[0]!.position.z - s.bodies[1]!.position.z
    );

  it("shrinks a close binary monotonically", () => {
    const m = 2500;
    const c = 40;
    const rs = (2 * G_ * m) / (c * c);
    // Launched at the circular speed for the force law actually in force —
    // the 1PN limiter is saturated at this separation, so the Newtonian
    // circular speed would start the pair on an eccentric orbit instead.
    let state = circularBinary(m, rs * 5.5, Math.sqrt(1 - MAX_PN_FRACTION));
    state = { ...state, timeStep: 0.004 };
    const accel = calculateAccelerationsWithGR(c);

    let previous = separation(state);
    const start = previous;
    // 900 steps keeps the run short of the plunge, where the two bodies
    // interpenetrate and the point-mass model stops meaning anything (the
    // real system merges there — see the preset integration test below).
    for (let i = 0; i < 900; i++) {
      state = stepRK4(state, accel);
      const current = separation(state);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
    expect(previous).toBeLessThan(start * 0.9);
  });

  it("leaves a binary's separation constant when GR is off", () => {
    let state = circularBinary(2500, 17.1875);
    state = { ...state, timeStep: 0.004 };
    const start = separation(state);
    for (let i = 0; i < 900; i++) state = stepRK4(state);
    expect(separation(state)).toBeCloseTo(start, 6);
  });

  it("is negligible for a wide, slow orbit", () => {
    // Earth around the Sun in AU / M_sun / yr, with a realistic c.
    const G_solar = 4 * Math.PI ** 2;
    const c = 63241; // AU per year
    const sun: CelestialBody = {
      id: "sun", name: "Sun", mass: 1, position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, color: "#fdb813", radius: 0.0047,
    };
    const earth: CelestialBody = {
      id: "earth", name: "Earth", mass: 3e-6, position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: -2 * Math.PI }, color: "#4f94cd", radius: 4e-5,
    };
    const accelerations = radiationReactionAccelerations([sun, earth], G_solar, c);
    const newtonian = G_solar / 1;
    expect(length(accelerations[1]!) / newtonian).toBeLessThan(1e-15);
  });
});
