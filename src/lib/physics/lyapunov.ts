/**
 * Maximum Lyapunov exponent (MLE) via Benettin's renormalization method.
 *
 * Two copies of the system are evolved in parallel, one with a tiny
 * perturbation applied to the target body. The separation grows like
 * d(t) ≈ δ·e^(λt) in a chaotic system, so λ is read off the accumulated
 * log-stretching. The perturbation is rescaled back to δ every
 * `renormEvery` steps — without that, d saturates at system size and the
 * measured slope collapses to zero no matter how chaotic the orbit is.
 *
 *   λ = (1 / T) · Σ ln(dₖ / δ)
 *
 * λ > 0 means neighbouring trajectories diverge exponentially: chaos, with a
 * predictability horizon of order 1/λ.
 */

import { computeOrbitalElements, inferPrimaryBody } from "./orbital-elements";
import { calculateAccelerations, stepRK4 } from "./rk4";
import type { CelestialBody, SystemState } from "./types";

export const DEFAULT_PERTURBATION = 1e-8;

/**
 * Orbits the default integration window should span.
 *
 * Chaos only has meaning over many dynamical times: measured across a
 * fraction of one orbit, an ordinary Kepler ellipse's shear looks
 * indistinguishable from exponential divergence. Sizing the window from the
 * target's own orbital period is what makes the estimate comparable between
 * a tight inner planet and a distant comet.
 */
const DEFAULT_ORBITS = 24;
const MIN_STEPS = 3_000;
const MAX_STEPS = 60_000;

/** Steps needed to cover DEFAULT_ORBITS periods of the target's orbit. */
function autoStepCount(state: SystemState, targetId: string): number {
  const target = state.bodies.find((b) => b.id === targetId);
  const primary = inferPrimaryBody(state.bodies.filter((b) => b.id !== targetId));
  if (!target || !primary || state.timeStep <= 0) return 8_000;

  const elements = computeOrbitalElements(target, primary, state.G);
  if (!elements || !Number.isFinite(elements.period) || elements.period <= 0) {
    // Unbound or degenerate: fall back to a fixed budget.
    return 8_000;
  }
  const steps = Math.ceil((DEFAULT_ORBITS * elements.period) / state.timeStep);
  return Math.max(MIN_STEPS, Math.min(MAX_STEPS, steps));
}

export interface LyapunovOptions {
  /** Initial (and renormalized) separation. */
  delta?: number;
  /** Total RK4 steps. Defaults to ~24 orbits of the target (see autoStepCount). */
  steps?: number;
  /** Steps between renormalizations. */
  renormEvery?: number;
}

export interface LyapunovResult {
  /**
   * Finite-time MLE over the whole window, in inverse simulation-time units.
   * Includes the initial transient while the tangent vector is still
   * rotating onto the most unstable direction.
   */
  exponent: number;
  /**
   * MLE measured over the *second half* of the integration. This is the
   * better asymptotic estimator and the one classification uses: for a
   * regular orbit the accumulated log-stretching grows like ln(T), so the
   * late-window rate falls toward zero, while genuine chaos keeps a steady
   * positive rate.
   */
  lateExponent: number;
  /** Predictability horizon 1/λ_late; Infinity when λ_late ≤ 0. */
  lyapunovTime: number;
  /** Simulation time actually integrated. */
  elapsedTime: number;
  renormalizations: number;
  classification: "regular" | "weakly-chaotic" | "strongly-chaotic";
}

/**
 * Classifies from the late-window rate, and from whether the estimate is
 * still decaying like 1/T (the signature of a regular orbit measured over
 * finite time) rather than settling on a constant.
 */
function classify(exponent: number, lateExponent: number): LyapunovResult["classification"] {
  if (lateExponent <= 0) return "regular";
  // A large late-window rate is unambiguous divergence, even if it is still
  // falling (e.g. the Pythagorean problem, violently chaotic until it ejects
  // a body and settles).
  if (lateExponent >= 0.1) return "strongly-chaotic";
  // Otherwise a small positive value only counts as chaos if it is holding
  // steady. Still decaying like 1/T means it is the finite-time shear
  // artifact of a regular orbit, not chaos.
  const sustained = exponent > 0 ? lateExponent / exponent : 0;
  return sustained < 0.55 ? "regular" : "weakly-chaotic";
}

function cloneBodies(bodies: CelestialBody[]): CelestialBody[] {
  return bodies.map((b) => ({
    ...b,
    position: { ...b.position },
    velocity: { ...b.velocity },
  }));
}

/**
 * Norm of the full phase-space separation between two states: every body's
 * position AND velocity difference, not just the perturbed body's.
 *
 * Using the whole state matters — perturbing one body propagates into all
 * the others within an orbit or two, and measuring only the target would
 * throw away most of the divergence (and report a chaotic system as
 * regular).
 */
function phaseSpaceSeparation(a: SystemState, b: SystemState): number {
  let sum = 0;
  const n = Math.min(a.bodies.length, b.bodies.length);
  for (let i = 0; i < n; i++) {
    const p = a.bodies[i]!;
    const q = b.bodies[i]!;
    const dx = q.position.x - p.position.x;
    const dy = q.position.y - p.position.y;
    const dz = q.position.z - p.position.z;
    const dvx = q.velocity.x - p.velocity.x;
    const dvy = q.velocity.y - p.velocity.y;
    const dvz = q.velocity.z - p.velocity.z;
    sum += dx * dx + dy * dy + dz * dz + dvx * dvx + dvy * dvy + dvz * dvz;
  }
  return Math.sqrt(sum);
}

/**
 * Rebuilds the perturbed state as reference + (perturbed − reference)·scale,
 * shrinking the tangent vector back to length `delta` while preserving the
 * direction it has grown into (which is what converges onto the most
 * unstable eigendirection).
 */
function rescaleAboutReference(
  reference: SystemState,
  perturbed: SystemState,
  scale: number
): SystemState {
  const bodies = reference.bodies.map((ref, i) => {
    const per = perturbed.bodies[i];
    if (!per) return { ...ref, position: { ...ref.position }, velocity: { ...ref.velocity } };
    return {
      ...ref,
      position: {
        x: ref.position.x + (per.position.x - ref.position.x) * scale,
        y: ref.position.y + (per.position.y - ref.position.y) * scale,
        z: ref.position.z + (per.position.z - ref.position.z) * scale,
      },
      velocity: {
        x: ref.velocity.x + (per.velocity.x - ref.velocity.x) * scale,
        y: ref.velocity.y + (per.velocity.y - ref.velocity.y) * scale,
        z: ref.velocity.z + (per.velocity.z - ref.velocity.z) * scale,
      },
    };
  });
  return { ...reference, bodies };
}

/**
 * Computes the MLE for `targetId` in `state`.
 *
 * Runs 2× the integration work of the main sim, so callers should run this
 * off the render thread (see analysis.worker.ts). Returns null when the
 * target body is missing or is pinned (a fixed body has no trajectory to
 * diverge).
 */
export function computeLyapunovExponent(
  state: SystemState,
  targetId: string,
  options: LyapunovOptions = {}
): LyapunovResult | null {
  const delta = options.delta ?? DEFAULT_PERTURBATION;
  const renormEvery = options.renormEvery ?? 100;

  const targetIndex = state.bodies.findIndex((b) => b.id === targetId);
  if (targetIndex < 0) return null;
  if (state.bodies[targetIndex]!.isFixed) return null;

  const totalSteps = options.steps ?? autoStepCount(state, targetId);

  let reference: SystemState = { ...state, bodies: cloneBodies(state.bodies) };
  const perturbedBodies = cloneBodies(state.bodies);
  // Perturb along +x; the MLE is the same for any generic direction, since
  // an arbitrary offset almost surely has a component along the most
  // unstable eigendirection, which then dominates the growth.
  perturbedBodies[targetIndex]!.position.x += delta;
  let perturbed: SystemState = { ...state, bodies: perturbedBodies };

  let logSum = 0;
  let renormalizations = 0;
  let elapsedTime = 0;
  // Snapshot at the midpoint, so the second-half rate can be recovered.
  const halfStep = Math.floor(totalSteps / 2);
  let logSumAtHalf = 0;
  let timeAtHalf = 0;

  for (let step = 0; step < totalSteps; step++) {
    reference = stepRK4(reference, calculateAccelerations);
    perturbed = stepRK4(perturbed, calculateAccelerations);
    elapsedTime += reference.timeStep;

    if ((step + 1) % renormEvery !== 0) continue;

    // Collisions can merge bodies away mid-run, desynchronizing the two
    // copies; stop rather than report garbage.
    if (reference.bodies.length !== perturbed.bodies.length) break;
    if (reference.bodies[targetIndex]?.id !== targetId) break;

    const d = phaseSpaceSeparation(reference, perturbed);
    if (!Number.isFinite(d) || d <= 0) break;

    logSum += Math.log(d / delta);
    renormalizations++;
    if (step < halfStep) {
      logSumAtHalf = logSum;
      timeAtHalf = elapsedTime;
    }

    perturbed = rescaleAboutReference(reference, perturbed, delta / d);
  }

  if (renormalizations === 0 || elapsedTime <= 0) return null;

  const exponent = logSum / elapsedTime;
  const lateSpan = elapsedTime - timeAtHalf;
  const lateExponent = lateSpan > 0 ? (logSum - logSumAtHalf) / lateSpan : exponent;

  return {
    exponent,
    lateExponent,
    lyapunovTime: lateExponent > 0 ? 1 / lateExponent : Infinity,
    elapsedTime,
    renormalizations,
    classification: classify(exponent, lateExponent),
  };
}

// ---------------------------------------------------------------------------
// Chaos map: MLE over a grid of test-particle initial conditions
// ---------------------------------------------------------------------------

export interface ChaosMapSpec {
  /** Radial range (distance from the primary) sampled on the X axis. */
  radiusMin: number;
  radiusMax: number;
  /** Multiplier on the local circular velocity, sampled on the Y axis. */
  speedFactorMin: number;
  speedFactorMax: number;
  gridSize: number;
  /** Integration steps per sample — small, since this runs gridSize² times. */
  stepsPerSample: number;
}

export const DEFAULT_CHAOS_MAP_SPEC: ChaosMapSpec = {
  radiusMin: 4,
  radiusMax: 40,
  speedFactorMin: 0.4,
  speedFactorMax: 1.5,
  gridSize: 24,
  stepsPerSample: 600,
};

/**
 * Builds the restricted system used for one chaos-map sample: the massive
 * bodies of the real system (which dominate the dynamics) plus a single
 * massless test particle at (radius, speedFactor).
 *
 * The test particle carries ~zero mass so it never back-reacts on the
 * massive bodies — that's what makes each sample independent and lets the
 * grid be filled in any order.
 */
export function buildTestParticleSystem(
  state: SystemState,
  primary: CelestialBody,
  radius: number,
  speedFactor: number,
  massiveBodies: CelestialBody[]
): { system: SystemState; testId: string } {
  const vCircular = Math.sqrt((state.G * primary.mass) / radius);
  const speed = vCircular * speedFactor;
  const testId = "chaos-test-particle";

  const test: CelestialBody = {
    id: testId,
    name: "test",
    mass: 1e-12,
    position: { x: primary.position.x + radius, y: primary.position.y, z: primary.position.z },
    velocity: { x: primary.velocity.x, y: primary.velocity.y, z: primary.velocity.z - speed },
    color: "#ffffff",
    radius: 0,
  };

  return {
    system: { ...state, bodies: [...cloneBodies(massiveBodies), test] },
    testId,
  };
}
