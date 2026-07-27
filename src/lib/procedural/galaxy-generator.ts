/**
 * Procedural spiral galaxy generator.
 *
 * Builds a disk of stars along logarithmic spiral arms with an exponential
 * radial profile, plus a Hernquist bulge, and assigns velocities from a
 * *flat rotation curve* rather than Keplerian falloff.
 *
 * The flat curve is the point: with only the visible mass present, orbital
 * speeds should fall as v ∝ 1/√r beyond the bulge. Real galaxies don't do
 * that — they stay flat, which is the observational signature of a dark
 * matter halo. Here that halo isn't simulated as bodies; it's baked into the
 * initial velocity field, so the disk starts out rotating the way a real one
 * does. (It will still relax over time, since the N-body engine only sees
 * the visible mass.)
 */

import type { CelestialBody, SystemState } from "@/lib/physics/types";
import { createRng, sampleKroupaMass, stellarColor, type Rng } from "./random";

export interface GalaxyParams {
  seed: number;
  /** Total star count, including the bulge. */
  bodyCount: number;
  /** Number of spiral arms. */
  armCount: number;
  /** Pitch of the logarithmic spiral: r = a·e^(bθ). Larger = looser arms. */
  armTightness: number;
  /** Fraction of bodies placed in the central bulge (0–1). */
  bulgeFraction: number;
  /** Asymptotic rotation speed of the flat curve. */
  flatVelocity: number;
  /** Exponential disk scale length. */
  diskScaleLength: number;
  /** Core radius in the rotation curve — inside this, v rises ~linearly. */
  coreRadius: number;
  /** Angular scatter of stars about the arm ridge, in radians. */
  armScatter: number;
  /** Vertical (thickness) scale of the disk. */
  diskThickness: number;
  /** Mass of the central supermassive black hole; 0 to omit. */
  centralMass: number;
}

export const DEFAULT_GALAXY_PARAMS: GalaxyParams = {
  seed: 1,
  bodyCount: 5000,
  armCount: 2,
  armTightness: 0.25,
  bulgeFraction: 0.15,
  flatVelocity: 14,
  diskScaleLength: 22,
  coreRadius: 6,
  armScatter: 0.32,
  diskThickness: 1.6,
  centralMass: 8000,
};

/**
 * Flat rotation curve: v(r) = v_flat · r / √(r² + r_c²).
 * Rises approximately linearly inside the core radius, then flattens.
 */
export function rotationCurve(r: number, flatVelocity: number, coreRadius: number): number {
  return (flatVelocity * r) / Math.sqrt(r * r + coreRadius * coreRadius);
}

/** Inverse-CDF sample of an exponential disk ρ(r) ∝ e^(−r/r_d), truncated. */
function sampleDiskRadius(rng: Rng, scaleLength: number, maxRadius: number): number {
  for (let attempt = 0; attempt < 32; attempt++) {
    // For a 2D exponential disk the radial PDF is ∝ r·e^(−r/r_d); sampled
    // here via the sum of two exponentials, which is exactly that Gamma(2).
    const r = -scaleLength * (Math.log(1 - rng.next()) + Math.log(1 - rng.next()));
    if (r <= maxRadius) return r;
  }
  return rng.range(0, maxRadius);
}

/**
 * Hernquist bulge radius sample: ρ(r) ∝ 1 / (r(r+a)³), whose enclosed-mass
 * profile inverts analytically to r = a√u / (1 − √u).
 */
function sampleBulgeRadius(rng: Rng, scale: number, maxRadius: number): number {
  for (let attempt = 0; attempt < 32; attempt++) {
    const u = rng.next();
    const root = Math.sqrt(u);
    const r = (scale * root) / (1 - root);
    if (Number.isFinite(r) && r <= maxRadius) return r;
  }
  return rng.range(0, maxRadius);
}

export function generateGalaxy(partial: Partial<GalaxyParams> = {}): SystemState {
  const params: GalaxyParams = { ...DEFAULT_GALAXY_PARAMS, ...partial };
  const rng = createRng(params.seed);
  const bodies: CelestialBody[] = [];

  const maxRadius = params.diskScaleLength * 4;

  if (params.centralMass > 0) {
    bodies.push({
      id: "galaxy-core",
      name: "Galactic Core",
      mass: params.centralMass,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      color: "#ffe9b0",
      radius: 1.8,
      isFixed: true,
    });
  }

  const bulgeCount = Math.round(params.bodyCount * params.bulgeFraction);
  const diskCount = Math.max(0, params.bodyCount - bulgeCount);

  // --- Bulge: isotropic, pressure-supported (no net rotation) ------------
  const bulgeScale = params.coreRadius * 0.6;
  for (let i = 0; i < bulgeCount; i++) {
    const r = sampleBulgeRadius(rng, bulgeScale, params.coreRadius * 3);
    // Uniform direction on the sphere.
    const cosTheta = rng.range(-1, 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rng.range(0, Math.PI * 2);

    const mass = sampleKroupaMass(rng);
    // Velocity dispersion in rough virial balance with the local curve.
    const sigma = rotationCurve(Math.max(r, 0.5), params.flatVelocity, params.coreRadius) * 0.65;

    bodies.push({
      id: `bulge-${i}`,
      name: `Bulge star ${i + 1}`,
      mass,
      position: {
        x: r * sinTheta * Math.cos(phi),
        y: r * cosTheta,
        z: r * sinTheta * Math.sin(phi),
      },
      velocity: {
        x: rng.gaussian() * sigma,
        y: rng.gaussian() * sigma * 0.7,
        z: rng.gaussian() * sigma,
      },
      color: stellarColor(mass),
      radius: 0.05 + Math.cbrt(mass) * 0.05,
    });
  }

  // --- Disk: stars scattered about logarithmic spiral arms ---------------
  for (let i = 0; i < diskCount; i++) {
    const r = Math.max(params.coreRadius * 0.35, sampleDiskRadius(rng, params.diskScaleLength, maxRadius));

    // Which arm, and where along it. Inverting r = a·e^(bθ) gives the arm's
    // ridge angle at this radius: θ = ln(r/a)/b.
    const arm = rng.int(0, params.armCount - 1);
    const armOffset = (arm * 2 * Math.PI) / params.armCount;
    const ridgeAngle = Math.log(Math.max(r, 1e-3) / params.coreRadius) / params.armTightness;

    // Scatter tightens toward the arm center; widens in the outer disk where
    // the density wave is weaker.
    const scatter = params.armScatter * (0.6 + (r / maxRadius) * 0.9);
    const theta = ridgeAngle + armOffset + rng.gaussian() * scatter;

    const mass = sampleKroupaMass(rng);
    const speed = rotationCurve(r, params.flatVelocity, params.coreRadius);

    // Counter-clockwise seen from +Y, matching every other preset.
    bodies.push({
      id: `disk-${i}`,
      name: `Star ${i + 1}`,
      mass,
      position: {
        x: r * Math.cos(theta),
        y: rng.gaussian() * params.diskThickness,
        z: r * Math.sin(theta),
      },
      velocity: {
        x: speed * Math.sin(theta) + rng.gaussian() * speed * 0.04,
        y: rng.gaussian() * speed * 0.02,
        z: -speed * Math.cos(theta) + rng.gaussian() * speed * 0.04,
      },
      color: stellarColor(mass),
      radius: 0.05 + Math.cbrt(mass) * 0.05,
    });
  }

  return {
    bodies,
    timeStep: 0.004,
    G: 1,
    // Generous softening: with thousands of stars, close pairs would
    // otherwise dominate the timestep and shatter the disk.
    softening: 0.6,
  };
}
