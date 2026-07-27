/**
 * Publishes star meshes to the post-processing pipeline.
 *
 * `GodRaysEffect` does not take a position — it renders the light source's
 * own geometry into an occlusion buffer and radially blurs it, which is the
 * only way the rays get correctly interrupted by anything passing in front.
 * So the pipeline needs the actual `THREE.Mesh`, and only the component that
 * drew it has that.
 *
 * A plain module-level map with a subscription rather than a store: this is
 * written from a mount effect and read once per pipeline render, so
 * `useSyncExternalStore` semantics are all it needs and a zustand store would
 * only add indirection.
 */

import type * as THREE from "three";

const starMeshes = new Map<string, THREE.Mesh>();
const listeners = new Set<() => void>();

/** Snapshot identity, bumped on every mutation so subscribers can memoise. */
let version = 0;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function registerStarMesh(id: string, mesh: THREE.Mesh): void {
  starMeshes.set(id, mesh);
  notify();
}

export function unregisterStarMesh(id: string): void {
  if (starMeshes.delete(id)) notify();
}

/** Changes whenever the registered set changes; stable otherwise. */
export function starRegistryVersion(): number {
  return version;
}

export function getStarMesh(id: string): THREE.Mesh | null {
  return starMeshes.get(id) ?? null;
}

export function subscribeToStarMeshes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
