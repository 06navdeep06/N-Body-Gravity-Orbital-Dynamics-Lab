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
/**
 * Hard cap on subdivision depth.
 *
 * Two bodies at identical (or near-identical) positions always fall into the
 * same octant, so subdividing to separate them never terminates. Past this
 * depth a leaf simply keeps a bucket of bodies instead of splitting again.
 */
const MAX_DEPTH = 24;

export class OctreeNode {
  bounds: Octant;
  readonly depth: number;

  /** Total mass contained in this node's subtree. */
  mass = 0;
  /** Mass-weighted center of mass of this node's subtree. */
  centerOfMass: Vector3D = { x: 0, y: 0, z: 0 };

  /**
   * Bodies held directly by this leaf. Normally at most one; only a
   * depth-capped leaf holding coincident bodies has more.
   */
  bodies: CelestialBody[] = [];

  /** Set once this node has been subdivided into up to 8 octants. */
  children: (OctreeNode | null)[] | null = null;

  constructor(bounds: Octant, depth = 0) {
    this.bounds = bounds;
    this.depth = depth;
  }

  /** The single body in this leaf, if it holds exactly one. */
  get body(): CelestialBody | null {
    return this.bodies.length === 1 ? this.bodies[0]! : null;
  }

  /** True when `position` lies inside this node's cube. */
  contains(position: Vector3D): boolean {
    const half = this.bounds.size / 2;
    return (
      Math.abs(position.x - this.bounds.cx) <= half &&
      Math.abs(position.y - this.bounds.cy) <= half &&
      Math.abs(position.z - this.bounds.cz) <= half
    );
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

  private insertIntoChild(body: CelestialBody): void {
    const index = this.octantIndexFor(body.position);
    const children = this.children!;
    if (!children[index]) {
      children[index] = new OctreeNode(this.childBounds(index), this.depth + 1);
    }
    children[index]!.insert(body);
  }

  insert(body: CelestialBody): void {
    // Accumulate aggregate mass / center of mass for every node this body
    // passes through, whether it ends up here as a leaf or deeper down.
    const newMass = this.mass + body.mass;
    if (newMass > 0) {
      this.centerOfMass = {
        x: (this.centerOfMass.x * this.mass + body.position.x * body.mass) / newMass,
        y: (this.centerOfMass.y * this.mass + body.position.y * body.mass) / newMass,
        z: (this.centerOfMass.z * this.mass + body.position.z * body.mass) / newMass,
      };
    }
    this.mass = newMass;

    if (this.isLeaf) {
      // Empty leaf, or a depth-capped bucket: store here.
      if (this.bodies.length === 0 || this.depth >= MAX_DEPTH) {
        this.bodies.push(body);
        return;
      }
      // Occupied leaf: split into octants and push everything down.
      const existing = this.bodies;
      this.bodies = [];
      this.children = new Array(8).fill(null);
      for (const previous of existing) this.insertIntoChild(previous);
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

  const eps2 = softening * softening;

  if (node.isLeaf) {
    // Sum the leaf's bodies individually (normally one; more only in a
    // depth-capped bucket of coincident bodies), skipping self-interaction.
    for (const other of node.bodies) {
      if (other === body) continue;
      const offset = sub(other.position, body.position);
      const distSq = offset.x * offset.x + offset.y * offset.y + offset.z * offset.z + eps2;
      const dist = Math.sqrt(distSq);
      const scalar = (G * other.mass) / (distSq * dist);
      out.x += offset.x * scalar;
      out.y += offset.y * scalar;
      out.z += offset.z * scalar;
    }
    return;
  }

  const offset = sub(node.centerOfMass, body.position);
  const distSq = offset.x * offset.x + offset.y * offset.y + offset.z * offset.z + eps2;
  const dist = Math.sqrt(distSq);

  // A node that contains this body must always be opened: collapsing it to
  // a center of mass would fold the body's *own* mass into the force acting
  // on it. Softening makes this reachable — it floors `dist`, so a small
  // enclosing node can otherwise satisfy size/dist < theta and be accepted.
  const enclosesBody = node.contains(body.position);

  if (!enclosesBody && node.bounds.size / dist < theta) {
    const scalar = (G * node.mass) / (distSq * dist);
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
