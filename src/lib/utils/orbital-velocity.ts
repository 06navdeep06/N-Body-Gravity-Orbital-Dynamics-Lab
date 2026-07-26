/**
 * Reference orbital-velocity formulas, used both by the launch preview UI
 * (so users know how hard to fling a body) and anywhere else a quick
 * two-body estimate is useful.
 */

/** Circular orbit speed at `orbitalRadius` around a body of `centralMass`: v = sqrt(GM/r). */
export function circularOrbitVelocity(
  centralMass: number,
  orbitalRadius: number,
  G: number
): number {
  if (orbitalRadius <= 0) return 0;
  return Math.sqrt((G * centralMass) / orbitalRadius);
}

/** Escape velocity at `distance` from a body of `centralMass`: v_esc = sqrt(2GM/r). */
export function escapeVelocity(
  centralMass: number,
  distance: number,
  G: number
): number {
  if (distance <= 0) return 0;
  return Math.sqrt((2 * G * centralMass) / distance);
}

/**
 * Delta-v burns for a Hohmann transfer from a circular orbit at r1 to a
 * circular orbit at r2 (both around the same `centralMass`).
 *  - deltaV1: burn at r1 to enter the transfer ellipse
 *  - deltaV2: burn at r2 to circularize
 */
export function hohmannTransferVelocity(
  centralMass: number,
  r1: number,
  r2: number,
  G: number
): { deltaV1: number; deltaV2: number } {
  const mu = G * centralMass;
  const vCircular1 = Math.sqrt(mu / r1);
  const vCircular2 = Math.sqrt(mu / r2);

  const transferSemiMajorAxis = (r1 + r2) / 2;
  const vTransferAtR1 = Math.sqrt(mu * (2 / r1 - 1 / transferSemiMajorAxis));
  const vTransferAtR2 = Math.sqrt(mu * (2 / r2 - 1 / transferSemiMajorAxis));

  return {
    deltaV1: Math.abs(vTransferAtR1 - vCircular1),
    deltaV2: Math.abs(vCircular2 - vTransferAtR2),
  };
}
