/**
 * Minimal, allocation-explicit Vector3D math shared by the physics engine.
 * Kept separate from three.js's Vector3 so the physics core has zero
 * rendering-layer dependencies and can run inside a Web Worker untouched.
 */

import type { Vector3D } from "./types";

export const ZERO: Readonly<Vector3D> = Object.freeze({ x: 0, y: 0, z: 0 });

export function add(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vector3D, s: number): Vector3D {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vector3D, b: Vector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSq(a: Vector3D): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Vector3D): number {
  return Math.sqrt(lengthSq(a));
}

export function clone(a: Vector3D): Vector3D {
  return { x: a.x, y: a.y, z: a.z };
}
