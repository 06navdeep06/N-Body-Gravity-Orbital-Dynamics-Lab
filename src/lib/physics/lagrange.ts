/**
 * Lagrange point solver for a two-body (primary + secondary) subsystem.
 *
 * L1/L2/L3 are found by Newton-Raphson root-finding of the collinear
 * force-balance equation (gravity from both bodies + centrifugal force in
 * the co-rotating frame, evaluated along the primary-secondary axis). L4/L5
 * are the closed-form equilateral-triangle solutions, rotated ±60° from the
 * primary->secondary line about the orbit's normal (derived from the
 * secondary's relative angular momentum, so it works for orbits outside the
 * XZ plane too).
 */

import type { CelestialBody, Vector3D } from "./types";
import { add, cross, length, scale, sub } from "./vector";

const EPS = 1e-9;
const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-10;

/**
 * Bisection-safeguarded Newton-Raphson on a bracketed root.
 *
 * Each collinear equation has a singularity at each primary, so an
 * unguarded Newton step can leap across one and diverge; clamping it to the
 * interval edge then leaves it stuck against the boundary. Here a Newton
 * step is accepted only when it lands strictly inside the current bracket,
 * and a bisection step is taken otherwise — which keeps Newton's quadratic
 * convergence in the common case while guaranteeing convergence overall.
 */
function solveBracketed(
  f: (x: number) => number,
  fPrime: (x: number) => number,
  x0: number,
  lo: number,
  hi: number
): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  const fb = f(b);
  // Without a sign change there is no bracketed root; fall back to the seed.
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return x0;

  let x = x0 > a && x0 < b ? x0 : (a + b) / 2;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) break;
    if (Math.abs(fx) < TOLERANCE || b - a < TOLERANCE) break;

    // Tighten the bracket around the root.
    if (fa * fx <= 0) {
      b = x;
    } else {
      a = x;
      fa = fx;
    }

    const dfx = fPrime(x);
    let next = Number.isFinite(dfx) && Math.abs(dfx) > EPS ? x - fx / dfx : Number.NaN;
    if (!Number.isFinite(next) || next <= a || next >= b) {
      next = (a + b) / 2; // Newton left the bracket — bisect instead.
    }
    if (Math.abs(next - x) < TOLERANCE) {
      x = next;
      break;
    }
    x = next;
  }
  return x;
}

/**
 * Solves for the three collinear Lagrange points along the primary-secondary
 * axis, working in a 1D coordinate `x` measured from the primary (x1 = 0,
 * x2 = r12). Returns [xL1, xL2, xL3] in that same 1D coordinate.
 */
function solveCollinearPoints(m1: number, m2: number, r12: number, G: number): [number, number, number] {
  const x1 = 0;
  const x2 = r12;
  const xcm = (m2 * r12) / (m1 + m2);
  const n2 = (G * (m1 + m2)) / r12 ** 3; // square of the rotating-frame angular velocity

  // Classic small-mass-ratio approximation, used only as a Newton-Raphson
  // starting point — the iteration converges to the exact root regardless.
  const hillOffset = r12 * Math.cbrt(m2 / (3 * m1));

  // Brackets are opened by a hair so the endpoints avoid the singularities
  // sitting exactly at x1 and x2.
  const nudge = r12 * 1e-9;

  // L1: between the bodies. Attraction from m1 pulls -x, from m2 pulls +x.
  //   f(x) = -Gm₁/(x-x₁)² + Gm₂/(x-x₂)² + n²(x-x_cm)
  // d/dx of +Gm₂(x-x₂)⁻² is -2Gm₂(x-x₂)⁻³ — the sign here matters, and
  // getting it wrong drives the iteration onto the bracket edge and parks
  // L1 on top of the secondary.
  const fL1 = (x: number) => -G * m1 / (x - x1) ** 2 + G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL1p = (x: number) => (2 * G * m1) / (x - x1) ** 3 - (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL1 = solveBracketed(fL1, fL1p, x2 - hillOffset, x1 + nudge, x2 - nudge);

  // L2: beyond the secondary. Both primaries pull -x.
  const fL2 = (x: number) => -G * m1 / (x - x1) ** 2 - G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL2p = (x: number) => (2 * G * m1) / (x - x1) ** 3 + (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL2 = solveBracketed(fL2, fL2p, x2 + hillOffset, x2 + nudge, x2 + 10 * r12);

  // L3: beyond the primary, opposite the secondary. Both pull +x.
  const fL3 = (x: number) => G * m1 / (x - x1) ** 2 + G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL3p = (x: number) => -(2 * G * m1) / (x - x1) ** 3 - (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL3 = solveBracketed(fL3, fL3p, x1 - r12 * (1 + m2 / (3 * m1)), x1 - 10 * r12, x1 - nudge);

  return [xL1, xL2, xL3];
}

/**
 * Computes the five Lagrange points of the `primary`/`secondary` two-body
 * subsystem. Returns world-space positions in the order [L1, L2, L3, L4, L5].
 */
export function computeLagrangePoints(
  primary: CelestialBody,
  secondary: CelestialBody,
  G: number
): Vector3D[] {
  const axis = sub(secondary.position, primary.position);
  const r12 = length(axis);
  if (r12 < EPS) {
    return [primary.position, primary.position, primary.position, primary.position, primary.position];
  }
  const uHat = scale(axis, 1 / r12);

  const [xL1, xL2, xL3] = solveCollinearPoints(primary.mass, secondary.mass, r12, G);
  const toWorld = (x: number): Vector3D => add(primary.position, scale(uHat, x));

  const L1 = toWorld(xL1);
  const L2 = toWorld(xL2);
  const L3 = toWorld(xL3);

  // Orbit normal for the triangular points, from the secondary's angular
  // momentum relative to the primary; falls back to world-up if the two
  // bodies have no relative velocity (degenerate/static configuration).
  const relVelocity = sub(secondary.velocity, primary.velocity);
  const angularMomentum = cross(axis, relVelocity);
  const normal =
    length(angularMomentum) > EPS
      ? scale(angularMomentum, 1 / length(angularMomentum))
      : { x: 0, y: 1, z: 0 };

  const L4 = add(primary.position, rotateAroundAxis(axis, normal, Math.PI / 3));
  const L5 = add(primary.position, rotateAroundAxis(axis, normal, -Math.PI / 3));

  return [L1, L2, L3, L4, L5];
}

/** Rodrigues' rotation formula: rotates `v` by `angle` radians about unit axis `k`. */
function rotateAroundAxis(v: Vector3D, k: Vector3D, angle: number): Vector3D {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const kCrossV = cross(k, v);
  const kDotV = k.x * v.x + k.y * v.y + k.z * v.z;

  return add(
    add(scale(v, cosA), scale(kCrossV, sinA)),
    scale(k, kDotV * (1 - cosA))
  );
}
