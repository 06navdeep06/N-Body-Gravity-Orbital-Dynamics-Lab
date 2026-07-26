/**
 * Patched-conics transfer orbit calculations: Hohmann and bi-elliptic
 * transfers between circular coplanar orbits, plus a universal-variable
 * Lambert solver (Stumpff-function formulation) for arbitrary
 * point-to-point trajectories.
 */

import type { Vector3D } from "./types";
import { add, cross, dot, length, scale, sub } from "./vector";

export interface HohmannTransfer {
  kind: "hohmann";
  deltaV1: number;
  deltaV2: number;
  totalDeltaV: number;
  transferTime: number;
  /** Semi-major axis of the transfer ellipse. */
  semiMajorAxis: number;
}

export interface BiEllipticTransfer {
  kind: "bi-elliptic";
  deltaV1: number;
  deltaV2: number;
  deltaV3: number;
  totalDeltaV: number;
  transferTime: number;
  /** The intermediate apoapsis radius used. */
  intermediateRadius: number;
}

/** Hohmann transfer between circular orbits at r1 and r2 around mass with mu = G*M. */
export function hohmannTransfer(mu: number, r1: number, r2: number): HohmannTransfer {
  const at = (r1 + r2) / 2;
  const deltaV1 = Math.abs(Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1));
  const deltaV2 = Math.abs(Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2))));
  const transferTime = Math.PI * Math.sqrt(at ** 3 / mu);
  return {
    kind: "hohmann",
    deltaV1,
    deltaV2,
    totalDeltaV: deltaV1 + deltaV2,
    transferTime,
    semiMajorAxis: at,
  };
}

/**
 * Bi-elliptic transfer via an intermediate apoapsis rb (defaults to
 * 15 * max(r1, r2), a reasonable "far" apoapsis). Only pays off over
 * Hohmann when r2/r1 > ~11.94.
 */
export function biEllipticTransfer(
  mu: number,
  r1: number,
  r2: number,
  rb: number = 15 * Math.max(r1, r2)
): BiEllipticTransfer {
  const a1 = (r1 + rb) / 2; // first transfer ellipse: r1 -> rb
  const a2 = (rb + r2) / 2; // second transfer ellipse: rb -> r2

  const vCirc1 = Math.sqrt(mu / r1);
  const vPeri1 = Math.sqrt(mu * (2 / r1 - 1 / a1));
  const deltaV1 = Math.abs(vPeri1 - vCirc1);

  const vApo1 = Math.sqrt(mu * (2 / rb - 1 / a1));
  const vApo2 = Math.sqrt(mu * (2 / rb - 1 / a2));
  const deltaV2 = Math.abs(vApo2 - vApo1);

  const vPeri2 = Math.sqrt(mu * (2 / r2 - 1 / a2));
  const vCirc2 = Math.sqrt(mu / r2);
  const deltaV3 = Math.abs(vCirc2 - vPeri2);

  const transferTime = Math.PI * (Math.sqrt(a1 ** 3 / mu) + Math.sqrt(a2 ** 3 / mu));

  return {
    kind: "bi-elliptic",
    deltaV1,
    deltaV2,
    deltaV3,
    totalDeltaV: deltaV1 + deltaV2 + deltaV3,
    transferTime,
    intermediateRadius: rb,
  };
}

// ---------------------------------------------------------------------------
// Lambert solver (universal variables, Stumpff functions)
// ---------------------------------------------------------------------------

/** Stumpff function C(z) = (1 - cos(sqrt z)) / z, with analytic continuations. */
function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24;
}

/** Stumpff function S(z) = (sqrt z - sin(sqrt z)) / sqrt(z)^3, with continuations. */
function stumpffS(z: number): number {
  if (z > 1e-6) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / sz ** 3;
  }
  if (z < -1e-6) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / sz ** 3;
  }
  return 1 / 6 - z / 120;
}

export interface LambertSolution {
  /** Velocity at departure point r1 that puts the body on the connecting orbit. */
  v1: Vector3D;
  /** Velocity on arrival at r2. */
  v2: Vector3D;
}

/**
 * Solves Lambert's problem: find the orbit connecting positions `r1vec` and
 * `r2vec` around a body of gravitational parameter `mu` in time `tof`.
 * Universal-variable formulation (bisection on z for robustness).
 *
 * `prograde` selects the transfer direction (counter-clockwise when viewed
 * from +Y, matching this app's orbit convention).
 *
 * Returns null when no solution converges (e.g. tof too short for the
 * geometry).
 */
export function solveLambert(
  r1vec: Vector3D,
  r2vec: Vector3D,
  tof: number,
  mu: number,
  prograde = true
): LambertSolution | null {
  const r1 = length(r1vec);
  const r2 = length(r2vec);
  if (r1 < 1e-12 || r2 < 1e-12 || tof <= 0) return null;

  const crossProd = cross(r1vec, r2vec);
  let cosDnu = dot(r1vec, r2vec) / (r1 * r2);
  cosDnu = Math.max(-1, Math.min(1, cosDnu));
  let dnu = Math.acos(cosDnu);
  // Choose the sweep direction from the orbit normal: +Y normal =
  // counter-clockwise seen from above (prograde in this app).
  if (prograde ? crossProd.y < 0 : crossProd.y >= 0) {
    dnu = 2 * Math.PI - dnu;
  }

  const A = Math.sin(dnu) * Math.sqrt((r1 * r2) / (1 - Math.cos(dnu)));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-12) return null;

  const yOf = (z: number): number => {
    const C = stumpffC(z);
    const S = stumpffS(z);
    return r1 + r2 + (A * (z * S - 1)) / Math.sqrt(C);
  };

  const tofOf = (z: number): number => {
    const C = stumpffC(z);
    const S = stumpffS(z);
    const y = yOf(z);
    if (y < 0 || C <= 0) return NaN;
    const chi = Math.sqrt(y / C);
    return (chi ** 3 * S + A * Math.sqrt(y)) / Math.sqrt(mu);
  };

  // Bracket the root in z. z < 0: hyperbolic; z in (0, (2pi)^2): elliptic.
  let zLo = -4 * Math.PI * Math.PI;
  let zHi = 4 * Math.PI * Math.PI - 1e-6;
  // Raise zLo until y(zLo) > 0 (A > 0 requires it).
  for (let i = 0; i < 64 && (Number.isNaN(tofOf(zLo)) || yOf(zLo) < 0); i++) {
    zLo = zLo / 2 + 1e-8;
  }

  const f = (z: number): number => tofOf(z) - tof;
  let fLo = f(zLo);
  const fHi = f(zHi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi) || fLo * fHi > 0) return null;

  let z = 0;
  for (let i = 0; i < 120; i++) {
    z = (zLo + zHi) / 2;
    const fz = f(z);
    if (Number.isNaN(fz)) return null;
    if (Math.abs(fz) < 1e-10) break;
    if (fLo * fz < 0) {
      zHi = z;
    } else {
      zLo = z;
      fLo = fz;
    }
  }

  const y = yOf(z);
  if (y < 0) return null;

  // Lagrange coefficients.
  const fCoeff = 1 - y / r1;
  const gCoeff = A * Math.sqrt(y / mu);
  const gDot = 1 - y / r2;
  if (Math.abs(gCoeff) < 1e-12) return null;

  // v1 = (r2 - f*r1)/g,  v2 = (gdot*r2 - r1)/g
  const v1 = scale(sub(r2vec, scale(r1vec, fCoeff)), 1 / gCoeff);
  const v2 = scale(sub(scale(r2vec, gDot), r1vec), 1 / gCoeff);
  return { v1, v2 };
}

// Re-export shared vector helpers so UI code can compute transfer geometry
// without importing vector.ts separately.
export { add, length, sub };
