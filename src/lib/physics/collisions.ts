/**
 * Inelastic collision detection and merging.
 *
 * Run once per RK4 step, after positions/velocities have been integrated.
 * Two bodies are considered collided when their separation drops below the
 * sum of their radii. Colliding bodies are merged pairwise (in the order
 * pairs are found) into a single body that conserves mass and momentum.
 */

import type { CelestialBody, SystemState, Vector3D } from "./types";
import { add, scale } from "./vector";

export interface CollisionEvent {
  bodyA: string;
  bodyB: string;
  mergedBody: CelestialBody;
  timestamp: number;
}

function mergeBodies(a: CelestialBody, b: CelestialBody): CelestialBody {
  const totalMass = a.mass + b.mass;
  const dominant = a.mass >= b.mass ? a : b;

  const position: Vector3D = scale(
    add(scale(a.position, a.mass), scale(b.position, b.mass)),
    1 / totalMass
  );
  const velocity: Vector3D = scale(
    add(scale(a.velocity, a.mass), scale(b.velocity, b.mass)),
    1 / totalMass
  );
  const radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);

  return {
    id: dominant.id,
    name: dominant.name,
    color: dominant.color,
    mass: totalMass,
    position,
    velocity,
    radius,
    // If either progenitor was fixed (e.g. a planet falling into the
    // central star), the merged body stays fixed.
    isFixed: a.isFixed || b.isFixed || undefined,
    // A merged black hole is still a black hole.
    isBlackHole: a.isBlackHole || b.isBlackHole || undefined,
    // Crucially, debris stays debris. `isFragment` exempts a body from
    // further tidal disruption; dropping it here lets merged fragments be
    // shredded again, and since each disruption multiplies the body count
    // that cascade runs away — observed at 14,000+ bodies from a system
    // that started with ~200.
    isFragment: a.isFragment || b.isFragment || undefined,
  };
}

/**
 * Detects and resolves all collisions in `state.bodies` for this step.
 * Returns the (possibly unchanged) body list and any collision events that
 * occurred, so the caller/UI can react to them.
 *
 * Bodies are processed pairwise in array order; once a body has been
 * consumed by a merge it is skipped for the remainder of this pass (a body
 * can only participate in one merge per step).
 */
export function detectAndResolveCollisions(
  state: SystemState,
  timestamp: number = Date.now()
): { bodies: CelestialBody[]; events: CollisionEvent[] } {
  const { bodies } = state;
  const consumed = new Set<string>();
  const events: CollisionEvent[] = [];
  const survivors: CelestialBody[] = [];

  for (let i = 0; i < bodies.length; i++) {
    const bodyI = bodies[i]!;
    if (consumed.has(bodyI.id)) continue;

    let current = bodyI;

    for (let j = i + 1; j < bodies.length; j++) {
      const bodyJ = bodies[j]!;
      if (consumed.has(bodyJ.id)) continue;

      const dx = bodyJ.position.x - current.position.x;
      const dy = bodyJ.position.y - current.position.y;
      const dz = bodyJ.position.z - current.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const collisionDist = current.radius + bodyJ.radius;

      if (distSq < collisionDist * collisionDist) {
        const merged = mergeBodies(current, bodyJ);
        events.push({
          bodyA: current.id,
          bodyB: bodyJ.id,
          mergedBody: merged,
          timestamp,
        });
        consumed.add(bodyJ.id);
        current = merged;
      }
    }

    survivors.push(current);
  }

  return { bodies: survivors, events };
}
