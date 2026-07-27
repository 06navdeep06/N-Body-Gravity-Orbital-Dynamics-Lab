/**
 * Long-run conservation properties of the integrator, plus the remaining
 * analysis modules (tidal, resonance, GW, Poincaré, Lyapunov).
 */

import { detectAndResolveCollisions } from "@/lib/physics/collisions";
import { GwAnalyser, detectBinary, quadrupoleMoment } from "@/lib/physics/gravitational-waves";
import { computeLyapunovExponent } from "@/lib/physics/lyapunov";
import { poincareRecorder } from "@/lib/physics/poincare";
import { analyzeKirkwoodGaps, detectResonances } from "@/lib/physics/resonance";
import { calculateAccelerations, calculateEnergyMetrics, stepRK4 } from "@/lib/physics/rk4";
import { hillSphereRadius, rocheLimit, tidalAcceleration, uniformDensity } from "@/lib/physics/tidal";
import type { CelestialBody, SystemState } from "@/lib/physics/types";

const G = 1;

function body(
  id: string, mass: number, x: number, z: number, vx: number, vz: number,
  overrides: Partial<CelestialBody> = {}
): CelestialBody {
  return {
    id, name: id, mass,
    position: { x, y: 0, z },
    velocity: { x: vx, y: 0, z: vz },
    color: "#ffffff", radius: 0.2,
    ...overrides,
  };
}

describe("energy and momentum conservation", () => {
  it("holds total energy to better than 0.01% over 1000 steps (3-body)", () => {
    let state: SystemState = {
      bodies: [
        body("a", 10, 0, 0, 0, 0),
        body("b", 1, 12, 0, 0, -Math.sqrt((G * 10) / 12)),
        body("c", 1, -20, 0, 0, Math.sqrt((G * 10) / 20)),
      ],
      timeStep: 0.002, G, softening: 0.05,
    };

    const initial = calculateEnergyMetrics(state).totalEnergy;
    for (let i = 0; i < 1000; i++) state = stepRK4(state, calculateAccelerations);
    const final = calculateEnergyMetrics(state).totalEnergy;

    expect(Math.abs((final - initial) / initial)).toBeLessThan(1e-4);
  });

  it("conserves linear momentum for an isolated system", () => {
    let state: SystemState = {
      bodies: [
        body("a", 5, -10, 0, 0, 1.2),
        body("b", 5, 10, 0, 0, -1.2),
      ],
      timeStep: 0.001, G, softening: 0.05,
    };
    const momentum = (s: SystemState) =>
      s.bodies.reduce(
        (acc, b) => ({ x: acc.x + b.mass * b.velocity.x, z: acc.z + b.mass * b.velocity.z }),
        { x: 0, z: 0 }
      );

    const before = momentum(state);
    for (let i = 0; i < 500; i++) state = stepRK4(state, calculateAccelerations);
    const after = momentum(state);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.z).toBeCloseTo(before.z, 8);
  });

  it("conserves angular momentum for a two-body orbit", () => {
    let state: SystemState = {
      bodies: [
        body("star", 1000, 0, 0, 0, 0, { isFixed: true }),
        body("planet", 1, 20, 0, 0, -Math.sqrt((G * 1000) / 20)),
      ],
      timeStep: 0.002, G, softening: 0,
    };
    const before = calculateEnergyMetrics(state).angularMomentum;
    for (let i = 0; i < 2000; i++) state = stepRK4(state, calculateAccelerations);
    const after = calculateEnergyMetrics(state).angularMomentum;
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps a fixed body pinned", () => {
    let state: SystemState = {
      bodies: [
        body("anchor", 1000, 0, 0, 0, 0, { isFixed: true }),
        body("mover", 1, 15, 0, 0, -5),
      ],
      timeStep: 0.005, G, softening: 0.05,
    };
    for (let i = 0; i < 200; i++) state = stepRK4(state, calculateAccelerations);
    const anchor = state.bodies[0]!;
    expect(anchor.position.x).toBe(0);
    expect(anchor.position.z).toBe(0);
    expect(anchor.velocity.x).toBe(0);
  });
});

describe("tidal helpers", () => {
  const primary = body("p", 1000, 0, 0, 0, 0, { radius: 5 });
  const satellite = body("s", 1, 50, 0, 0, 0, { radius: 0.5 });

  it("computes uniform density from mass and radius", () => {
    expect(uniformDensity(satellite.mass, satellite.radius)).toBeCloseTo(
      (3 * satellite.mass) / (4 * Math.PI * satellite.radius ** 3),
      12
    );
    expect(uniformDensity(1, 0)).toBe(0);
  });

  it("computes the Hill radius", () => {
    const expected = 50 * Math.cbrt(satellite.mass / (3 * primary.mass));
    expect(hillSphereRadius(satellite, primary)).toBeCloseTo(expected, 10);
    expect(hillSphereRadius(satellite, { ...primary, mass: 0 })).toBe(0);
  });

  it("computes the Roche limit and scales it with density contrast", () => {
    const limit = rocheLimit(primary, satellite);
    expect(limit).toBeGreaterThan(0);
    // A denser satellite survives closer in.
    const denser = { ...satellite, radius: satellite.radius / 2 };
    expect(rocheLimit(primary, denser)).toBeLessThan(limit);
  });

  it("computes tidal acceleration falling as 1/d^3", () => {
    const near = tidalAcceleration(1000, 10, 1, G);
    const far = tidalAcceleration(1000, 20, 1, G);
    // Doubling the distance cuts the tidal term by 2^3.
    expect(near / far).toBeCloseTo(8, 6);
  });

  it("guards a zero separation by returning 0 rather than Infinity", () => {
    // Deliberate: a non-finite value here would propagate through the
    // acceleration sum and poison the whole step.
    expect(tidalAcceleration(1000, 0, 1, G)).toBe(0);
  });
});

describe("resonance detection", () => {
  const sun = body("sun", 1000, 0, 0, 0, 0, { isFixed: true });
  const circular = (id: string, a: number, mass = 0.001) =>
    body(id, mass, a, 0, 0, -Math.sqrt((G * 1000) / a));

  it("detects a 2:1 mean-motion resonance", () => {
    const inner = circular("inner", 10);
    // a ratio for a 2:1 period ratio is 2^(2/3).
    const outer = circular("outer", 10 * Math.cbrt(4));
    const found = detectResonances([sun, inner, outer], sun, G);
    const two2one = found.find((r) => r.ratio[0] === 2 && r.ratio[1] === 1);
    expect(two2one).toBeDefined();
    expect(two2one!.strength).toBeGreaterThan(0);
  });

  it("reports no resonance for a non-commensurate pair", () => {
    const found = detectResonances([sun, circular("a", 10), circular("b", 10 * 1.9)], sun, G);
    expect(found).toHaveLength(0);
  });

  it("finds Kirkwood gap locations against the heaviest perturber", () => {
    const bodies: CelestialBody[] = [sun, circular("jupiter", 45, 30)];
    for (let i = 0; i < 120; i++) bodies.push(circular(`a${i}`, 18 + (i / 120) * 14, 1e-6));
    const analysis = analyzeKirkwoodGaps(bodies, sun, G);
    expect(analysis).not.toBeNull();
    expect(analysis!.perturberName).toBe("jupiter");
    expect(analysis!.resonances.length).toBeGreaterThan(0);
    expect(analysis!.bins.length).toBeGreaterThan(0);
  });

  it("returns null for a population too small to histogram", () => {
    expect(analyzeKirkwoodGaps([sun, circular("a", 10)], sun, G)).toBeNull();
  });
});

describe("gravitational waves", () => {
  const makeBinary = (): SystemState => ({
    bodies: [
      body("A", 100, -5, 0, 0, -2, { radius: 0.5 }),
      body("B", 100, 5, 0, 0, 2, { radius: 0.5 }),
    ],
    timeStep: 0.002, G, softening: 0.05,
  });

  it("detects a comparable-mass close binary", () => {
    const detection = detectBinary(makeBinary().bodies);
    expect(detection).not.toBeNull();
    expect(detection!.separation).toBeCloseTo(10, 6);
    expect(detection!.centerOfMass.x).toBeCloseTo(0, 9);
  });

  it("rejects an extreme mass ratio as a binary", () => {
    const bodies = [body("A", 100, 0, 0, 0, 0), body("B", 0.001, 5, 0, 0, 1)];
    expect(detectBinary(bodies)).toBeNull();
  });

  it("computes a traceless-ish quadrupole that responds to geometry", () => {
    const q = quadrupoleMoment(makeBinary().bodies);
    expect(q).toHaveLength(9);
    for (const value of q) expect(Number.isFinite(value)).toBe(true);
    // Symmetric: Q_xz === Q_zx.
    expect(q[2]).toBeCloseTo(q[6]!, 9);
  });

  it("produces an oscillating strain for an orbiting binary", () => {
    let state = makeBinary();
    const analyser = new GwAnalyser(1000, 60, 500);
    let time = 0;
    for (let i = 0; i < 4000; i++) {
      state = stepRK4(state, calculateAccelerations);
      time += state.timeStep;
      if (i % 10 === 0) analyser.push(state, G, time);
    }
    expect(analyser.samples.length).toBeGreaterThan(10);
    const hPlus = analyser.samples.map((s) => s.hPlus);
    expect(Math.max(...hPlus)).toBeGreaterThan(Math.min(...hPlus));
    const latest = analyser.latest()!;
    expect(latest.frequency).toBeGreaterThan(0);
  });

  it("resets cleanly", () => {
    const analyser = new GwAnalyser();
    analyser.push(makeBinary(), G, 0);
    analyser.reset();
    expect(analyser.samples).toHaveLength(0);
    expect(analyser.latest()).toBeNull();
  });
});

describe("Poincaré recorder", () => {
  it("records section crossings for an orbiting body", () => {
    poincareRecorder.clear();
    let state: SystemState = {
      bodies: [
        body("sun", 1000, 0, 0, 0, 0, { isFixed: true }),
        body("planet", 1, 20, 0, 0, -Math.sqrt((G * 1000) / 20)),
      ],
      timeStep: 0.005, G, softening: 0.02,
    };
    // The orbital period here is 2π√(20³/1000) ≈ 17.8, so at dt = 0.005 a
    // section crossing needs well over 3600 steps — run several orbits.
    for (let i = 0; i < 12000; i++) {
      state = stepRK4(state, calculateAccelerations);
      poincareRecorder.record(state, "sun");
    }
    const entries = poincareRecorder.entries();
    expect(entries.length).toBeGreaterThan(0);
    const [, buffers] = entries[0]!;
    expect(buffers.phase.length).toBeGreaterThan(0);
    expect(buffers.section.length).toBeGreaterThan(0);
    poincareRecorder.clear();
    expect(poincareRecorder.entries()).toHaveLength(0);
  });
});

describe("Lyapunov exponent", () => {
  it("classifies a circular two-body orbit as regular", () => {
    const state: SystemState = {
      bodies: [
        body("sun", 1000, 0, 0, 0, 0, { isFixed: true }),
        body("planet", 1, 20, 0, 0, -Math.sqrt((G * 1000) / 20)),
      ],
      timeStep: 0.002, G, softening: 0.02,
    };
    const result = computeLyapunovExponent(state, "planet");
    expect(result).not.toBeNull();
    expect(result!.classification).toBe("regular");
  });

  it("classifies the Pythagorean three-body problem as chaotic", () => {
    const state: SystemState = {
      bodies: [
        body("m3", 3, 1, 3, 0, 0, { radius: 0.05 }),
        body("m4", 4, -2, -1, 0, 0, { radius: 0.05 }),
        body("m5", 5, 1, -1, 0, 0, { radius: 0.05 }),
      ],
      timeStep: 0.0008, G, softening: 0.001,
    };
    const result = computeLyapunovExponent(state, "m3", { steps: 8000 });
    expect(result).not.toBeNull();
    expect(result!.lateExponent).toBeGreaterThan(0);
    expect(result!.classification).toBe("strongly-chaotic");
  });

  it("returns null for a pinned or missing body", () => {
    const state: SystemState = {
      bodies: [body("anchor", 1000, 0, 0, 0, 0, { isFixed: true })],
      timeStep: 0.002, G, softening: 0.02,
    };
    expect(computeLyapunovExponent(state, "anchor")).toBeNull();
    expect(computeLyapunovExponent(state, "nope")).toBeNull();
  });
});

describe("collisions", () => {
  it("merges overlapping bodies conserving mass and momentum", () => {
    const state: SystemState = {
      bodies: [
        body("a", 3, 0, 0, 1, 0, { radius: 1 }),
        body("b", 1, 0.5, 0, -1, 0, { radius: 1 }),
      ],
      timeStep: 0.001, G, softening: 0.05,
    };
    const { bodies, events } = detectAndResolveCollisions(state, 1);
    expect(events).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    const merged = bodies[0]!;
    expect(merged.mass).toBe(4);
    // Momentum: 3*1 + 1*(-1) = 2, over mass 4 => 0.5
    expect(merged.velocity.x).toBeCloseTo(0.5, 12);
    // Volume-preserving radius: cbrt(1^3 + 1^3)
    expect(merged.radius).toBeCloseTo(Math.cbrt(2), 12);
  });
});
