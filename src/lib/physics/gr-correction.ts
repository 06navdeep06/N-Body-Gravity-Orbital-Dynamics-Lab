/**
 * Post-Newtonian corrections on top of Newtonian gravity.
 *
 * Two separate effects, both switched on by the store's `enableGR` flag:
 *
 *  1PN  — Schwarzschild precession, the effect responsible for Mercury's
 *         43″/century perihelion advance:
 *
 *           a_GR = (GM / (r² c²)) · [ (4GM/r − v²) r̂ + 4(v·r̂) v ]
 *
 *  2.5PN — gravitational-wave radiation reaction, which drains orbital
 *          energy and makes close binaries actually spiral in and merge.
 *
 * Both are perturbations on the Newtonian term, and both are *bounded* here
 * (see `MAX_PN_FRACTION`) — that limiter is not cosmetic, it is what keeps the
 * strong-field presets physical. See the note on it below.
 */

import type { AccelerationFn } from "./rk4";
import { calculateAccelerations } from "./rk4";
import type { CelestialBody, Vector3D } from "./types";
import { add, dot, length, scale, sub } from "./vector";

const EPS = 1e-9;

/**
 * Ceiling on any post-Newtonian term, as a fraction of the Newtonian
 * acceleration from the same pair.
 *
 * The 1PN radial term carries `+4GM/r`, which points *away* from the source.
 * Its size relative to Newtonian gravity is 2r_s/r, so inside r = 2r_s the
 * "correction" exceeds the force it corrects and flips gravity's sign — two
 * black holes a few Schwarzschild radii apart are pushed apart instead of
 * falling together. That is not relativity, it is a truncated series being
 * evaluated far outside its radius of convergence: at those separations the
 * expansion parameter v/c is ~0.4 and 1PN means nothing.
 *
 * Rather than let a divergent series drive the integrator, the correction is
 * capped in magnitude (direction preserved) once it would exceed this fraction
 * of the Newtonian term. Where the expansion *is* valid the cap never engages
 * — Mercury's ratio is ~10⁻⁸, and the GR precession test runs at ~10⁻² — so
 * precession rates are untouched. Where it does engage, the result is a
 * deliberately truncated approximation rather than an unphysical repulsion.
 */
export const MAX_PN_FRACTION = 0.1;

/** Scales `vec` down so its length never exceeds `limit`. */
function clampMagnitude(vec: Vector3D, limit: number): Vector3D {
  const magnitude = length(vec);
  if (magnitude <= limit || magnitude < EPS) return vec;
  return scale(vec, limit / magnitude);
}

/** GR correction acceleration on `body` due to `centralBody`. */
export function grCorrectionAcceleration(
  body: CelestialBody,
  centralBody: CelestialBody,
  G: number,
  c: number
): Vector3D {
  const r_vec = sub(body.position, centralBody.position);
  const r = length(r_vec);
  if (r < EPS || c <= 0) return { x: 0, y: 0, z: 0 };

  const r_hat = scale(r_vec, 1 / r);
  const v_vec = sub(body.velocity, centralBody.velocity);
  const v2 = dot(v_vec, v_vec);

  const mu = G * centralBody.mass;
  const radialTerm = scale(r_hat, 4 * mu / r - v2);
  const velocityTerm = scale(v_vec, 4 * dot(v_vec, r_hat));

  const correction = scale(add(radialTerm, velocityTerm), mu / (r * r * c * c));
  return clampMagnitude(correction, (MAX_PN_FRACTION * mu) / (r * r));
}

/**
 * Power radiated as gravitational waves by a two-body pair, in the quadrupole
 * (Peters & Mathews 1963) approximation:
 *
 *   P = (8/15) · G³m₁²m₂² / (c⁵ r⁴) · (12v² − 11ṙ²)
 *
 * where v is the relative speed and ṙ the radial component of it. For a
 * circular orbit (ṙ = 0, v² = GM/r) this reduces to the familiar
 * P = (32/5)·G⁴m₁²m₂²M / (c⁵r⁵).
 */
export function gravitationalWavePower(
  a: CelestialBody,
  b: CelestialBody,
  G: number,
  c: number
): number {
  if (c <= 0) return 0;
  const r_vec = sub(b.position, a.position);
  const r = length(r_vec);
  if (r < EPS) return 0;

  const v_vec = sub(b.velocity, a.velocity);
  const v2 = dot(v_vec, v_vec);
  const rDot = dot(v_vec, scale(r_vec, 1 / r));

  const power =
    ((8 / 15) * G ** 3 * a.mass ** 2 * b.mass ** 2 * (12 * v2 - 11 * rDot * rDot)) /
    (c ** 5 * r ** 4);
  // The bracket is positive for any real orbit (12v² ≥ 11ṙ² since v² ≥ ṙ²);
  // clamp anyway so numerical noise can never feed energy *into* the binary.
  return Math.max(0, power);
}

/**
 * Radiation-reaction accelerations for every pair, summed per body.
 *
 * Modelled as a drag on each pair's *relative* motion, tuned to remove energy
 * at exactly the quadrupole luminosity above. Equal and opposite forces mean
 * linear momentum is conserved to machine precision and the centre of mass
 * never drifts — the orbit shrinks, the pair does not get pushed anywhere.
 *
 * This is not the full 2.5PN acceleration: that term also redistributes
 * angular momentum in a way that circularises eccentric orbits, which this
 * does not reproduce. What it does get right is the inspiral *rate*, which is
 * what makes a binary decay on the Peters timescale and merge — for a circular
 * binary the two are equivalent.
 */
export function radiationReactionAccelerations(
  bodies: CelestialBody[],
  G: number,
  c: number
): Vector3D[] {
  const accelerations: Vector3D[] = bodies.map(() => ({ x: 0, y: 0, z: 0 }));
  if (c <= 0) return accelerations;

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (a.mass <= 0 || b.mass <= 0) continue;

      const r_vec = sub(b.position, a.position);
      const r = length(r_vec);
      if (r < EPS) continue;

      const v_vec = sub(b.velocity, a.velocity);
      const v2 = dot(v_vec, v_vec);
      if (v2 < EPS) continue;

      const power = gravitationalWavePower(a, b, G, c);
      if (power <= 0) continue;

      // a_rel = −(P / (μ v²)) v_rel, split so that m_a·a_a + m_b·a_b = 0.
      const dragA = power / (a.mass * v2);
      const dragB = power / (b.mass * v2);

      // Same validity argument as the 1PN cap: energy may only be drained at a
      // rate that stays a perturbation on the orbit it is draining.
      const limitA = (MAX_PN_FRACTION * G * b.mass) / (r * r);
      const limitB = (MAX_PN_FRACTION * G * a.mass) / (r * r);

      // v_rel = v_b − v_a, so the drag on `a` runs along +v_rel and on `b`
      // along −v_rel: each is slowed relative to the other.
      accelerations[i] = add(accelerations[i]!, clampMagnitude(scale(v_vec, dragA), limitA));
      accelerations[j] = add(accelerations[j]!, clampMagnitude(scale(v_vec, -dragB), limitB));
    }
  }

  return accelerations;
}

/**
 * Newtonian gravity plus pairwise-summed 1PN precession and 2.5PN radiation
 * reaction: for every ordered pair (i, j), body i receives
 * `grCorrectionAcceleration(i, j)` in addition to the usual softened Newtonian
 * term, and every unordered pair exchanges a radiation-reaction drag. This
 * generalizes the two-body results to N bodies the same way pairwise Newtonian
 * forces generalize to N-body gravity — an approximation, but the right
 * leading-order behavior for near-Keplerian systems.
 *
 * O(N^2), same as `calculateAccelerations` — the octree's far-field
 * approximation isn't compatible with these pairwise corrections, so GR mode
 * always uses direct summation.
 */
export const calculateAccelerationsWithGR: (c: number) => AccelerationFn =
  (c: number) => (bodies: CelestialBody[], G: number, softening: number): Vector3D[] => {
    const newtonian = calculateAccelerations(bodies, G, softening);
    const radiation = radiationReactionAccelerations(bodies, G, c);

    return bodies.map((bodyI, i) => {
      let acc = add(newtonian[i]!, radiation[i]!);
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        acc = add(acc, grCorrectionAcceleration(bodyI, bodies[j]!, G, c));
      }
      return acc;
    });
  };
