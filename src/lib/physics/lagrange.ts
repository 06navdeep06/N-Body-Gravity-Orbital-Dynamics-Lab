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

/** Newton-Raphson root find, clamped to stay within (lo, hi). */
function newtonRaphson(
  f: (x: number) => number,
  fPrime: (x: number) => number,
  x0: number,
  lo: number,
  hi: number
): number {
  let x = x0;
  const margin = (hi - lo) * 1e-6;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const fx = f(x);
    if (Math.abs(fx) < TOLERANCE) break;
    const dfx = fPrime(x);
    if (Math.abs(dfx) < EPS) break;
    let next = x - fx / dfx;
    // Keep the iterate strictly inside the valid open interval so we don't
    // jump across one of the (x - x1)/(x - x2) singularities.
    next = Math.max(lo + margin, Math.min(hi - margin, next));
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

  // L1: between the bodies. sign(x-x1)=+1, sign(x-x2)=-1.
  const fL1 = (x: number) => -G * m1 / (x - x1) ** 2 + G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL1p = (x: number) => (2 * G * m1) / (x - x1) ** 3 + (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL1 = newtonRaphson(fL1, fL1p, x2 - hillOffset, x1, x2);

  // L2: beyond the secondary. sign(x-x1)=+1, sign(x-x2)=+1.
  const fL2 = (x: number) => -G * m1 / (x - x1) ** 2 - G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL2p = (x: number) => (2 * G * m1) / (x - x1) ** 3 + (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL2 = newtonRaphson(fL2, fL2p, x2 + hillOffset, x2, x2 + 10 * r12);

  // L3: beyond the primary, on the far side from the secondary.
  // sign(x-x1)=-1, sign(x-x2)=-1.
  const fL3 = (x: number) => G * m1 / (x - x1) ** 2 + G * m2 / (x - x2) ** 2 + n2 * (x - xcm);
  const fL3p = (x: number) => -(2 * G * m1) / (x - x1) ** 3 - (2 * G * m2) / (x - x2) ** 3 + n2;
  const xL3 = newtonRaphson(fL3, fL3p, x1 - r12 * (1 + m2 / (3 * m1)), x1 - 10 * r12, x1);

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
