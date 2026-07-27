/**
 * Decides how each body is drawn.
 *
 * Three renderers now share the body list and must not draw the same body
 * twice: `<Bodies />` (one instanced sphere mesh, the fast path),
 * `<PhotorealisticBodies />` (multi-layer PBR shells) and
 * `<InstancedDebris />` (instanced rock geometry). This module is the single
 * pure function all three call, so the partition is by construction disjoint
 * — each of them keys off the same result computed from the same state.
 *
 * It is deliberately free of React and of THREE so it can be called from
 * inside `useFrame` without allocating a subscription.
 */

import type { CelestialBody } from "@/lib/physics/types";
import type { RenderFeatures } from "./quality-preset";

export type BodyRole = "featured" | "debris" | "instanced";

/**
 * Below this fraction of the largest body's radius, a small body is a
 * candidate for the debris renderer.
 */
const DEBRIS_RADIUS_FRACTION = 0.12;

/**
 * ...but only once there are enough of them to look like a belt. A two-body
 * "Sun & Planet" preset must never demote its planet to an asteroid just
 * because the sun dwarfs it.
 */
const MIN_DEBRIS_FIELD = 24;

export interface RoleAssignment {
  /** Role per body, parallel to the input array. */
  roles: BodyRole[];
  /** Indices of bodies drawn by `<PhotorealisticBodies />`. */
  featured: number[];
  /** Indices of bodies drawn by `<InstancedDebris />`. */
  debris: number[];
}

const EMPTY: RoleAssignment = { roles: [], featured: [], debris: [] };

/**
 * Partitions bodies across the three renderers.
 *
 * @param bodies       Live body list from the simulation store.
 * @param features     Effective quality features.
 * @param excludedIds  Bodies with their own dedicated renderer (black holes),
 *                     which must stay on the plain instanced path so nothing
 *                     draws a lit sphere over an event horizon.
 */
export function assignBodyRoles(
  bodies: CelestialBody[],
  features: RenderFeatures,
  excludedIds?: ReadonlySet<string>
): RoleAssignment {
  if (bodies.length === 0) return EMPTY;

  const roles: BodyRole[] = new Array(bodies.length).fill("instanced");
  const featured: number[] = [];
  const debris: number[] = [];

  let maxRadius = 0;
  for (const body of bodies) {
    if (body.radius > maxRadius) maxRadius = body.radius;
  }

  // --- Debris ------------------------------------------------------------
  if (features.instancedDebris && maxRadius > 0) {
    const smallThreshold = maxRadius * DEBRIS_RADIUS_FRACTION;
    const fragments: number[] = [];
    const small: number[] = [];

    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      if (excludedIds?.has(body.id)) continue;
      if (body.isFragment) fragments.push(i);
      else if (body.radius <= smallThreshold) small.push(i);
    }

    // Tidal-disruption fragments are always debris — that is literally what
    // they are. Ordinary small bodies only become debris in a crowd.
    const candidates =
      small.length >= MIN_DEBRIS_FIELD ? fragments.concat(small) : fragments;

    for (const index of candidates) {
      if (debris.length >= features.debrisBudget) break;
      roles[index] = "debris";
      debris.push(index);
    }
  }

  // --- Featured ----------------------------------------------------------
  if (features.pbrMaterials && features.featuredBodyBudget > 0) {
    const candidates: number[] = [];
    for (let i = 0; i < bodies.length; i++) {
      if (roles[i] !== "instanced") continue;
      if (excludedIds?.has(bodies[i]!.id)) continue;
      candidates.push(i);
    }
    // Largest first: the bodies that occupy the most screen area are the ones
    // where a hundred-times-costlier material actually shows.
    candidates.sort((a, b) => bodies[b]!.radius - bodies[a]!.radius);

    for (const index of candidates.slice(0, features.featuredBodyBudget)) {
      roles[index] = "featured";
      featured.push(index);
    }
  }

  return { roles, featured, debris };
}

/**
 * Hash of the body set's *identity* — ids, radii, fragment flags — ignoring
 * anything that changes as bodies move.
 *
 * The physics worker hands back a freshly allocated `bodies` array on every
 * step, so a component that subscribes to that array re-renders sixty times a
 * second even when nothing about the scene's composition changed. Subscribing
 * to this number instead means role assignment recomputes on preset loads,
 * collisions, disruptions and launches, and at no other time.
 *
 * FNV-1a over the ids: order-dependent and collision-resistant enough for the
 * purpose, and a few thousand integer multiplies per store update, which is
 * far cheaper than the React reconciliation it avoids.
 */
export function topologySignature(bodies: CelestialBody[]): number {
  let hash = 0x811c9dc5;
  for (const body of bodies) {
    for (let i = 0; i < body.id.length; i++) {
      hash = Math.imul(hash ^ body.id.charCodeAt(i), 16777619);
    }
    // Radius decides both display size and role, so a change has to invalidate.
    hash = Math.imul(hash ^ Math.round(body.radius * 1e6), 16777619);
    hash = Math.imul(hash ^ (body.isFragment ? 1 : 0), 16777619);
  }
  return hash >>> 0;
}
