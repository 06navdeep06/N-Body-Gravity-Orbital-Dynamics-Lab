/**
 * 3D Barnes-Hut Octree.
 *
 * Recursively partitions space into eight octants so that distant clusters
 * of bodies can be approximated by a single pseudo-body at their center of
 * mass, rather than summing every pairwise interaction. This turns the
 * O(N^2) all-pairs gravity sum into an O(N log N) traversal: for each body,
 * we walk the tree and only recurse into a node when it's "close enough"
 * that its internal structure matters (s / d >= theta); otherwise we treat
 * the whole node as one point mass.
 */

import type { CelestialBody, Vector3D } from "./types";
import { length, sub } from "./vector";

/** Opening-angle threshold: node size / distance. Smaller = more accurate, slower. */
export const DEFAULT_THETA = 0.5;

interface Octant {
  cx: number;
  cy: number;
  cz: number;
  /** Full edge length of this cubic region. */
  size: number;
}

/**
 * A single node of the octree. Every node covers a cubic region of space
 * (`bounds`). A node is one of:
 *  - empty (mass === 0, no body, no children)
 *  - a leaf holding exactly one body
 *  - an internal node with up to 8 children, tracking the aggregate
 *    mass/center-of-mass of everything beneath it
 */
export class OctreeNode {
  bounds: Octant;

  /** Total mass contained in this node's subtree. */
  mass = 0;
  /** Mass-weighted center of mass of this node's subtree. */
  centerOfMass: Vector3D = { x: 0, y: 0, z: 0 };

  /** Set when this node is a leaf directly holding one body. */
  body: CelestialBody | null = null;

  /** Set once this node has been subdivided into up to 8 octants. */
  children: (OctreeNode | null)[] | null = null;

  constructor(bounds: Octant) {
    this.bounds = bounds;
  }

  get isLeaf(): boolean {
    return this.children === null;
  }

  private octantIndexFor(position: Vector3D): number {
    let index = 0;
    if (position.x >= this.bounds.cx) index |= 1;
    if (position.y >= this.bounds.cy) index |= 2;
    if (position.z >= this.bounds.cz) index |= 4;
    return index;
  }

  private childBounds(index: number): Octant {
    const quarter = this.bounds.size / 4;
    return {
      cx: this.bounds.cx + (index & 1 ? quarter : -quarter),
      cy: this.bounds.cy + (index & 2 ? quarter : -quarter),
      cz: this.bounds.cz + (index & 4 ? quarter : -quarter),
      size: this.bounds.size / 2,
    };
  }

  private subdivideAndReinsert(existing: CelestialBody): void {
    this.children = new Array(8).fill(null);
    this.body = null;
    this.insertIntoChild(existing);
  }

  private insertIntoChild(body: CelestialBody): void {
    const index = this.octantIndexFor(body.position);
    const children = this.children!;
    if (!children[index]) {
      children[index] = new OctreeNode(this.childBounds(index));
    }
    children[index]!.insert(body);
  }

  insert(body: CelestialBody): void {
    // Accumulate aggregate mass / center of mass for every node this body
    // passes through, whether it ends up here as a leaf or deeper down.
    const newMass = this.mass + body.mass;
    this.centerOfMass = {
      x: (this.centerOfMass.x * this.mass + body.position.x * body.mass) / newMass,
      y: (this.centerOfMass.y * this.mass + body.position.y * body.mass) / newMass,
      z: (this.centerOfMass.z * this.mass + body.position.z * body.mass) / newMass,
    };
    this.mass = newMass;

    if (this.isLeaf && this.body === null) {
      // Empty leaf: just store the body here.
      this.body = body;
      return;
    }

    if (this.isLeaf && this.body !== null) {
      // Occupied leaf: split into 8 octants and push both bodies down.
      const existing = this.body;
      this.subdivideAndReinsert(existing);
      this.insertIntoChild(body);
      return;
    }

    // Internal node: descend.
    this.insertIntoChild(body);
  }
}

/** Computes a cubic bounding region that contains every body, with margin. */
function computeBounds(bodies: CelestialBody[]): Octant {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const body of bodies) {
    const { x, y, z } = body.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  // Pad and round up so bodies sitting exactly on the boundary, or a
  // future body moving slightly outside it, still fit comfortably.
  const size = span * 2.2;

  return { cx, cy, cz, size };
}

/** Builds a fresh Barnes-Hut octree from the current body positions. */
export function buildOctree(bodies: CelestialBody[]): OctreeNode | null {
  if (bodies.length === 0) return null;

  const root = new OctreeNode(computeBounds(bodies));
  for (const body of bodies) {
    root.insert(body);
  }
  return root;
}

/**
 * Accumulates the gravitational acceleration on `body` from everything in
 * `node`'s subtree, using the Barnes-Hut approximation: a node is treated
 * as a single point mass at its center of mass whenever
 * (node size / distance to body) < theta; otherwise we recurse into its
 * children for a more exact contribution.
 */
function accumulateAcceleration(
  node: OctreeNode,
  body: CelestialBody,
  G: number,
  softening: number,
  theta: number,
  out: Vector3D
): void {
  if (node.mass === 0) return;

  // Leaf holding the same body as itself contributes nothing (no self-force).
  if (node.isLeaf && node.body === body) return;

  const offset = sub(node.centerOfMass, body.position);
  const eps2 = softening * softening;
  const distSq = offset.x * offset.x + offset.y * offset.y + offset.z * offset.z + eps2;
  const dist = Math.sqrt(distSq);

  const isFarEnough = node.isLeaf || node.bounds.size / dist < theta;

  if (isFarEnough) {
    const invDist3 = 1 / (distSq * dist);
    const scalar = G * node.mass * invDist3;
    out.x += offset.x * scalar;
    out.y += offset.y * scalar;
    out.z += offset.z * scalar;
    return;
  }

  for (const child of node.children!) {
    if (child) accumulateAcceleration(child, body, G, softening, theta, out);
  }
}

/**
 * Barnes-Hut accelerations for every body — an O(N log N) drop-in
 * alternative to the direct O(N^2) sum in `calculateAccelerations`
 * (rk4.ts), intended for large body counts where brute force becomes the
 * bottleneck.
 */
export function calculateAccelerationsBarnesHut(
  bodies: CelestialBody[],
  G: number,
  softening: number,
  theta: number = DEFAULT_THETA
): Vector3D[] {
  const root = buildOctree(bodies);
  const accelerations: Vector3D[] = bodies.map(() => ({ x: 0, y: 0, z: 0 }));

  if (!root) return accelerations;

  for (let i = 0; i < bodies.length; i++) {
    accumulateAcceleration(root, bodies[i]!, G, softening, theta, accelerations[i]!);
  }

  return accelerations;
}

// Re-exported for callers that just want a distance helper without pulling
// in the whole vector module.
export function distanceBetween(a: Vector3D, b: Vector3D): number {
  return length(sub(a, b));
}
