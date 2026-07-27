/**
 * Unit tests for lib/physics/vector.ts — pure vector math.
 */

import { add, sub, scale, dot, cross, length, lengthSq, clone, ZERO } from "@/lib/physics/vector";
import type { Vector3D } from "@/lib/physics/types";

describe("Vector3D utilities", () => {
  const a: Vector3D = { x: 1, y: 2, z: 3 };
  const b: Vector3D = { x: 4, y: 5, z: 6 };

  // ── add ────────────────────────────────────────────────────────────
  describe("add", () => {
    it("sums component-wise", () => {
      expect(add(a, b)).toEqual({ x: 5, y: 7, z: 9 });
    });

    it("is commutative", () => {
      expect(add(a, b)).toEqual(add(b, a));
    });

    it("identity with ZERO", () => {
      expect(add(a, ZERO)).toEqual(a);
    });
  });

  // ── sub ────────────────────────────────────────────────────────────
  describe("sub", () => {
    it("subtracts component-wise", () => {
      expect(sub(a, b)).toEqual({ x: -3, y: -3, z: -3 });
    });

    it("a - a = ZERO", () => {
      expect(sub(a, a)).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  // ── scale ──────────────────────────────────────────────────────────
  describe("scale", () => {
    it("scales each component", () => {
      expect(scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    });

    it("scaling by 0 gives zero vector", () => {
      expect(scale(a, 0)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("scaling by -1 negates", () => {
      expect(scale(a, -1)).toEqual({ x: -1, y: -2, z: -3 });
    });
  });

  // ── dot ────────────────────────────────────────────────────────────
  describe("dot", () => {
    it("computes dot product", () => {
      // 1*4 + 2*5 + 3*6 = 32
      expect(dot(a, b)).toBe(32);
    });

    it("is commutative", () => {
      expect(dot(a, b)).toBe(dot(b, a));
    });

    it("dot with ZERO is 0", () => {
      expect(dot(a, ZERO)).toBe(0);
    });

    it("dot with self equals lengthSq", () => {
      expect(dot(a, a)).toBe(lengthSq(a));
    });
  });

  // ── cross ──────────────────────────────────────────────────────────
  describe("cross", () => {
    it("computes cross product", () => {
      // (1,2,3) x (4,5,6) = (2*6-3*5, 3*4-1*6, 1*5-2*4) = (-3, 6, -3)
      expect(cross(a, b)).toEqual({ x: -3, y: 6, z: -3 });
    });

    it("is anti-commutative", () => {
      const ab = cross(a, b);
      const ba = cross(b, a);
      expect(ba).toEqual({ x: -ab.x, y: -ab.y, z: -ab.z });
    });

    it("cross of parallel vectors is zero", () => {
      const c: Vector3D = { x: 2, y: 4, z: 6 }; // 2*a
      const result = cross(a, c);
      expect(Math.abs(result.x)).toBeLessThan(1e-12);
      expect(Math.abs(result.y)).toBeLessThan(1e-12);
      expect(Math.abs(result.z)).toBeLessThan(1e-12);
    });

    it("cross product is perpendicular to both inputs", () => {
      const c = cross(a, b);
      expect(Math.abs(dot(c, a))).toBeLessThan(1e-12);
      expect(Math.abs(dot(c, b))).toBeLessThan(1e-12);
    });
  });

  // ── length / lengthSq ──────────────────────────────────────────────
  describe("length", () => {
    it("computes magnitude", () => {
      // sqrt(1+4+9) = sqrt(14)
      expect(length(a)).toBeCloseTo(Math.sqrt(14));
    });

    it("ZERO has length 0", () => {
      expect(length(ZERO)).toBe(0);
    });
  });

  describe("lengthSq", () => {
    it("computes squared magnitude", () => {
      expect(lengthSq(a)).toBe(14);
    });
  });

  // ── clone ──────────────────────────────────────────────────────────
  describe("clone", () => {
    it("returns an equal but distinct object", () => {
      const c = clone(a);
      expect(c).toEqual(a);
      expect(c).not.toBe(a);
    });
  });
});
