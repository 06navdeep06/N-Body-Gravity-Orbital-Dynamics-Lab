/**
 * Gravitational-wave strain in the quadrupole (Einstein) approximation.
 *
 * The leading-order GW emission from a mass distribution comes from the
 * second time derivative of its mass quadrupole moment:
 *
 *   Q_ij = Σ_k m_k (3 x_i x_j − δ_ij |r|²)
 *   h_ij = (2G / D c⁴) · Q̈_ij
 *   P_GW = (G / 5c⁵) · ⟨ Q⃛_ij Q⃛^ij ⟩
 *
 * Derivatives are taken by finite differences across a short ring buffer of
 * recent states — Q̈ needs 3 samples, Q⃛ needs 4.
 *
 * This is a Newtonian-source approximation: it's the right leading-order
 * physics for a widely separated binary, and it's what makes the
 * characteristic inspiral chirp appear, but it is not a numerical-relativity
 * waveform and it breaks down as the separation approaches a few
 * Schwarzschild radii.
 */

import type { CelestialBody, SystemState } from "./types";

/** Symmetric 3×3 tensor flattened row-major (9 entries, Q[i*3+j]). */
export type Tensor3 = Float64Array;

export interface GwSample {
  /** Plus polarization strain. */
  hPlus: number;
  /** Cross polarization strain. */
  hCross: number;
  /** GW frequency = 2 × orbital frequency, in inverse sim-time units. */
  frequency: number;
  /** Radiated power. */
  luminosity: number;
  /** Binary separation at this sample. */
  separation: number;
  /** Simulation time of the sample. */
  time: number;
}

export interface BinaryDetection {
  primary: CelestialBody;
  secondary: CelestialBody;
  separation: number;
  /** Center of mass of the pair. */
  centerOfMass: { x: number; y: number; z: number };
  totalMass: number;
}

/**
 * Picks the two most massive bodies and reports them as a GW source when
 * they dominate the system and are close enough to be radiating
 * appreciably. `maxSeparationFactor` is in units of the sum of their radii.
 */
export function detectBinary(
  bodies: CelestialBody[],
  maxSeparationFactor = 400
): BinaryDetection | null {
  if (bodies.length < 2) return null;
  const sorted = [...bodies].sort((a, b) => b.mass - a.mass);
  const [a, b] = sorted as [CelestialBody, CelestialBody];
  if (a.mass <= 0 || b.mass <= 0) return null;

  const totalMass = bodies.reduce((sum, x) => sum + x.mass, 0);
  // The pair has to actually be the system: a planet + moon pair inside a
  // solar system isn't the dominant quadrupole.
  if ((a.mass + b.mass) / totalMass < 0.8) return null;
  // Comparable masses — an extreme ratio is a test particle, not a binary.
  if (b.mass / a.mass < 0.05) return null;

  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const separation = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const scale = (a.radius + b.radius) * maxSeparationFactor;
  if (separation > scale) return null;

  const m = a.mass + b.mass;
  return {
    primary: a,
    secondary: b,
    separation,
    centerOfMass: {
      x: (a.position.x * a.mass + b.position.x * b.mass) / m,
      y: (a.position.y * a.mass + b.position.y * b.mass) / m,
      z: (a.position.z * a.mass + b.position.z * b.mass) / m,
    },
    totalMass: m,
  };
}

/** Mass quadrupole moment Q_ij about the system's center of mass. */
export function quadrupoleMoment(bodies: CelestialBody[]): Tensor3 {
  const Q = new Float64Array(9);
  let totalMass = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const b of bodies) {
    totalMass += b.mass;
    cx += b.mass * b.position.x;
    cy += b.mass * b.position.y;
    cz += b.mass * b.position.z;
  }
  if (totalMass <= 0) return Q;
  cx /= totalMass;
  cy /= totalMass;
  cz /= totalMass;

  for (const b of bodies) {
    const x = [b.position.x - cx, b.position.y - cy, b.position.z - cz];
    const r2 = x[0]! * x[0]! + x[1]! * x[1]! + x[2]! * x[2]!;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        Q[i * 3 + j]! += b.mass * (3 * x[i]! * x[j]! - (i === j ? r2 : 0));
      }
    }
  }
  return Q;
}

/**
 * Rolling GW analyser: feed it successive states and it maintains the
 * quadrupole history needed for the finite-difference derivatives.
 */
export class GwAnalyser {
  /** Quadrupole samples, newest last. Needs 4 for the third derivative. */
  private history: { Q: Tensor3; time: number }[] = [];
  private readonly maxHistory = 4;

  samples: GwSample[] = [];
  readonly maxSamples: number;
  /** Bumped on each new sample so pollers can skip redundant redraws. */
  version = 0;

  /** Observer distance, in simulation units. */
  observerDistance: number;
  /** Speed of light, in simulation units. */
  speedOfLight: number;

  constructor(observerDistance = 1000, speedOfLight = 60, maxSamples = 600) {
    this.observerDistance = observerDistance;
    this.speedOfLight = speedOfLight;
    this.maxSamples = maxSamples;
  }

  reset(): void {
    this.history = [];
    this.samples = [];
    this.version++;
  }

  /**
   * Records a state. Returns the new sample, or null while the history is
   * still filling or when no binary source is present.
   */
  push(state: SystemState, G: number, time: number): GwSample | null {
    const binary = detectBinary(state.bodies);
    if (!binary) return null;

    this.history.push({ Q: quadrupoleMoment(state.bodies), time });
    if (this.history.length > this.maxHistory) this.history.shift();
    if (this.history.length < 3) return null;

    const n = this.history.length;
    const newest = this.history[n - 1]!;
    const mid = this.history[n - 2]!;
    const older = this.history[n - 3]!;
    // Uniform-step central second difference; dt is the mean sample spacing.
    const dt = (newest.time - older.time) / 2;
    if (dt <= 0) return null;

    const c = this.speedOfLight;
    const D = this.observerDistance;
    const strainFactor = (2 * G) / (D * c ** 4);

    const Qddot = new Float64Array(9);
    for (let k = 0; k < 9; k++) {
      Qddot[k] = (newest.Q[k]! - 2 * mid.Q[k]! + older.Q[k]!) / (dt * dt);
    }

    // Observer looking down +Y (the orbital-plane normal for these presets),
    // so the transverse plane is x–z: h+ = (h_xx − h_zz)/2, h× = h_xz.
    const hPlus = strainFactor * 0.5 * (Qddot[0]! - Qddot[8]!);
    const hCross = strainFactor * Qddot[2]!;

    // Third derivative needs a 4th sample; luminosity stays 0 until then.
    let luminosity = 0;
    if (n >= 4) {
      const oldest = this.history[n - 4]!;
      const h = (newest.time - oldest.time) / 3;
      if (h > 0) {
        let sumSq = 0;
        for (let k = 0; k < 9; k++) {
          const Qdddot =
            (newest.Q[k]! - 3 * mid.Q[k]! + 3 * older.Q[k]! - oldest.Q[k]!) / h ** 3;
          sumSq += Qdddot * Qdddot;
        }
        luminosity = (G / (5 * c ** 5)) * sumSq;
      }
    }

    // Orbital frequency from the Keplerian mean motion of the pair;
    // GW frequency is twice it (the quadrupole repeats every half orbit).
    const mu = G * binary.totalMass;
    const orbitalFrequency =
      binary.separation > 0 ? Math.sqrt(mu / binary.separation ** 3) / (2 * Math.PI) : 0;

    const sample: GwSample = {
      hPlus,
      hCross,
      frequency: 2 * orbitalFrequency,
      luminosity,
      separation: binary.separation,
      time,
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    this.version++;
    return sample;
  }

  latest(): GwSample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1]! : null;
  }
}

/** Shared analyser: fed by usePhysicsWorker, read by the GW plot and ripples. */
export const gwAnalyser = new GwAnalyser();
