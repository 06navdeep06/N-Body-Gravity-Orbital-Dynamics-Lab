/**
 * 4th-Order Runge-Kutta gravitational integrator.
 *
 * Euler integration is intentionally avoided: for a conservative system like
 * gravity, first-order integration accumulates energy drift every step,
 * which visibly spirals orbits inward/outward over time. RK4 evaluates the
 * derivative at four points per step (bracketing the interval), giving
 * fourth-order accuracy and much better long-run energy conservation for a
 * comparable time step.
 */

import type { CelestialBody, EnergyMetrics, SystemState, Vector3D } from "./types";
import { add, cross, dot, length, scale, sub, ZERO } from "./vector";

/**
 * Newtonian gravity with Plummer softening:
 *   F_ij = G * m_i * m_j * (r_j - r_i) / (|r_j - r_i|^2 + eps^2)^(3/2)
 *
 * Softening prevents the force (and thus acceleration) from diverging to
 * infinity as two bodies approach r = 0, which would otherwise blow up the
 * integrator during close encounters.
 *
 * Returns one acceleration vector per body, in `bodies` order. Fixed bodies
 * still receive an acceleration value here (for API symmetry / diagnostics)
 * — callers integrating state are responsible for not applying it to them.
 */
export function calculateAccelerations(
  bodies: CelestialBody[],
  G: number,
  softening: number
): Vector3D[] {
  const n = bodies.length;
  const accelerations: Vector3D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    accelerations[i] = { x: 0, y: 0, z: 0 };
  }

  const eps2 = softening * softening;

  for (let i = 0; i < n; i++) {
    const bodyI = bodies[i]!;
    for (let j = i + 1; j < n; j++) {
      const bodyJ = bodies[j]!;

      const dx = bodyJ.position.x - bodyI.position.x;
      const dy = bodyJ.position.y - bodyI.position.y;
      const dz = bodyJ.position.z - bodyI.position.z;

      const distSq = dx * dx + dy * dy + dz * dz + eps2;
      const invDist3 = 1 / (distSq * Math.sqrt(distSq));

      // a_i = G * m_j * (r_j - r_i) / (distSq)^1.5, and a_j is the exact
      // opposite (Newton's third law) — compute the pair force once.
      const forceScalar = G * invDist3;

      const ax = dx * forceScalar;
      const ay = dy * forceScalar;
      const az = dz * forceScalar;

      const accI = accelerations[i]!;
      accI.x += ax * bodyJ.mass;
      accI.y += ay * bodyJ.mass;
      accI.z += az * bodyJ.mass;

      const accJ = accelerations[j]!;
      accJ.x -= ax * bodyI.mass;
      accJ.y -= ay * bodyI.mass;
      accJ.z -= az * bodyI.mass;
    }
  }

  return accelerations;
}

/** Internal per-body kinematic state used while integrating. */
interface Derivative {
  dPosition: Vector3D; // = velocity
  dVelocity: Vector3D; // = acceleration
}

/** Signature shared by the O(N^2) and Barnes-Hut acceleration calculators. */
export type AccelerationFn = (
  bodies: CelestialBody[],
  G: number,
  softening: number
) => Vector3D[];

/**
 * Evaluates the system derivative (d/dt of position and velocity) at a given
 * set of positions/velocities, without mutating the input arrays.
 */
function evaluateDerivative(
  positions: Vector3D[],
  velocities: Vector3D[],
  bodies: CelestialBody[],
  G: number,
  softening: number,
  accelerationFn: AccelerationFn
): Derivative[] {
  // Build a lightweight view of bodies at these trial positions so the
  // acceleration calculator can be reused verbatim.
  const trialBodies: CelestialBody[] = bodies.map((body, i) => ({
    ...body,
    position: positions[i]!,
  }));

  const accelerations = accelerationFn(trialBodies, G, softening);

  return bodies.map((_, i) => ({
    dPosition: velocities[i]!,
    dVelocity: accelerations[i]!,
  }));
}

/**
 * Advances the system by one `state.timeStep` using classical RK4:
 *   k1 = f(y)
 *   k2 = f(y + dt/2 * k1)
 *   k3 = f(y + dt/2 * k2)
 *   k4 = f(y + dt   * k3)
 *   y_{n+1} = y_n + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
 *
 * where y = (position, velocity) per body and f is the derivative
 * (velocity, acceleration). Bodies with `isFixed: true` are excluded from
 * the update (position/velocity held constant) but still participate in
 * force calculations for every other body.
 *
 * `accelerationFn` defaults to the direct O(N^2) sum; pass
 * `calculateAccelerationsBarnesHut` (octree.ts) for large N.
 */
export function stepRK4(
  state: SystemState,
  accelerationFn: AccelerationFn = calculateAccelerations
): SystemState {
  const { bodies, timeStep: dt, G, softening } = state;
  const n = bodies.length;

  const p0 = bodies.map((b) => b.position);
  const v0 = bodies.map((b) => b.velocity);

  const k1 = evaluateDerivative(p0, v0, bodies, G, softening, accelerationFn);

  const p1 = p0.map((p, i) => add(p, scale(k1[i]!.dPosition, dt / 2)));
  const v1 = v0.map((v, i) => add(v, scale(k1[i]!.dVelocity, dt / 2)));
  const k2 = evaluateDerivative(p1, v1, bodies, G, softening, accelerationFn);

  const p2 = p0.map((p, i) => add(p, scale(k2[i]!.dPosition, dt / 2)));
  const v2 = v0.map((v, i) => add(v, scale(k2[i]!.dVelocity, dt / 2)));
  const k3 = evaluateDerivative(p2, v2, bodies, G, softening, accelerationFn);

  const p3 = p0.map((p, i) => add(p, scale(k3[i]!.dPosition, dt)));
  const v3 = v0.map((v, i) => add(v, scale(k3[i]!.dVelocity, dt)));
  const k4 = evaluateDerivative(p3, v3, bodies, G, softening, accelerationFn);

  const newBodies: CelestialBody[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const body = bodies[i]!;

    if (body.isFixed) {
      newBodies[i] = body;
      continue;
    }

    const dPos = scale(
      add(add(k1[i]!.dPosition, scale(k2[i]!.dPosition, 2)), add(scale(k3[i]!.dPosition, 2), k4[i]!.dPosition)),
      dt / 6
    );
    const dVel = scale(
      add(add(k1[i]!.dVelocity, scale(k2[i]!.dVelocity, 2)), add(scale(k3[i]!.dVelocity, 2), k4[i]!.dVelocity)),
      dt / 6
    );

    newBodies[i] = {
      ...body,
      position: add(body.position, dPos),
      velocity: add(body.velocity, dVel),
    };
  }

  return {
    ...state,
    bodies: newBodies,
  };
}

/**
 * Computes system-wide conserved quantities, useful for validating that the
 * integrator is behaving (energy and angular momentum should stay
 * approximately constant over time for an isolated system).
 */
export function calculateEnergyMetrics(state: SystemState): EnergyMetrics {
  const { bodies, G, softening } = state;
  const eps2 = softening * softening;

  let kineticEnergy = 0;
  let potentialEnergy = 0;
  let angularMomentum: Vector3D = { ...ZERO };

  for (let i = 0; i < bodies.length; i++) {
    const bodyI = bodies[i]!;

    kineticEnergy += 0.5 * bodyI.mass * dot(bodyI.velocity, bodyI.velocity);
    angularMomentum = add(
      angularMomentum,
      scale(cross(bodyI.position, bodyI.velocity), bodyI.mass)
    );

    for (let j = i + 1; j < bodies.length; j++) {
      const bodyJ = bodies[j]!;
      const r = length(sub(bodyJ.position, bodyI.position));
      const softenedR = Math.sqrt(r * r + eps2);
      potentialEnergy += -(G * bodyI.mass * bodyJ.mass) / softenedR;
    }
  }

  return {
    kineticEnergy,
    potentialEnergy,
    totalEnergy: kineticEnergy + potentialEnergy,
    angularMomentum,
  };
}
