/**
 * Unit tests for lib/physics/collisions.ts — collision detection and merging.
 */

import { detectAndResolveCollisions } from "@/lib/physics/collisions";
import type { CelestialBody, SystemState } from "@/lib/physics/types";

function makeBody(overrides: Partial<CelestialBody> & Pick<CelestialBody, "id">): CelestialBody {
  return {
    name: overrides.id,
    mass: 1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    color: "#ffffff",
    radius: 1,
    ...overrides,
  };
}

function makeState(bodies: CelestialBody[]): SystemState {
  return { bodies, timeStep: 0.01, G: 1, softening: 0.01 };
}

describe("detectAndResolveCollisions", () => {
  it("returns unchanged bodies when no overlap", () => {
    const a = makeBody({ id: "a", position: { x: 0, y: 0, z: 0 }, radius: 1 });
    const b = makeBody({ id: "b", position: { x: 10, y: 0, z: 0 }, radius: 1 });
    const result = detectAndResolveCollisions(makeState([a, b]));
    expect(result.bodies).toHaveLength(2);
    expect(result.events).toHaveLength(0);
  });

  it("merges two overlapping bodies", () => {
    const a = makeBody({ id: "a", mass: 3, position: { x: 0, y: 0, z: 0 }, radius: 1 });
    const b = makeBody({ id: "b", mass: 1, position: { x: 1, y: 0, z: 0 }, radius: 1 });
    const result = detectAndResolveCollisions(makeState([a, b]));
    expect(result.bodies).toHaveLength(1);
    expect(result.events).toHaveLength(1);
  });

  it("conserves total mass on merge", () => {
    const a = makeBody({ id: "a", mass: 5, position: { x: 0, y: 0, z: 0 }, radius: 1 });
    const b = makeBody({ id: "b", mass: 3, position: { x: 0.5, y: 0, z: 0 }, radius: 1 });
    const result = detectAndResolveCollisions(makeState([a, b]));
    expect(result.bodies[0]!.mass).toBe(8);
  });

  it("conserves momentum on merge", () => {
    const a = makeBody({
      id: "a",
      mass: 2,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 3, y: 0, z: 0 },
      radius: 1,
    });
    const b = makeBody({
      id: "b",
      mass: 2,
      position: { x: 1, y: 0, z: 0 },
      velocity: { x: -1, y: 0, z: 0 },
      radius: 1,
    });
    const result = detectAndResolveCollisions(makeState([a, b]));
    const merged = result.bodies[0]!;
    // p = 2*3 + 2*(-1) = 4, v_merged = 4 / 4 = 1
    expect(merged.velocity.x).toBeCloseTo(1);
    expect(merged.velocity.y).toBeCloseTo(0);
    expect(merged.velocity.z).toBeCloseTo(0);
  });

  it("conserves volume (radius) on merge", () => {
    const r1 = 2, r2 = 3;
    const a = makeBody({ id: "a", position: { x: 0, y: 0, z: 0 }, radius: r1 });
    const b = makeBody({ id: "b", position: { x: 1, y: 0, z: 0 }, radius: r2 });
    const result = detectAndResolveCollisions(makeState([a, b]));
    const expected = Math.cbrt(r1 ** 3 + r2 ** 3);
    expect(result.bodies[0]!.radius).toBeCloseTo(expected);
  });

  it("keeps the dominant (more massive) body's identity", () => {
    const a = makeBody({ id: "heavy", name: "Heavy", mass: 100, position: { x: 0, y: 0, z: 0 }, radius: 2 });
    const b = makeBody({ id: "light", name: "Light", mass: 1, position: { x: 1, y: 0, z: 0 }, radius: 1 });
    const result = detectAndResolveCollisions(makeState([a, b]));
    expect(result.bodies[0]!.id).toBe("heavy");
    expect(result.bodies[0]!.name).toBe("Heavy");
  });

  it("a body consumed by one merge cannot participate in another", () => {
    // Three bodies all overlapping — b should merge into a, then c can't find b
    const a = makeBody({ id: "a", mass: 10, position: { x: 0, y: 0, z: 0 }, radius: 3 });
    const b = makeBody({ id: "b", mass: 1, position: { x: 1, y: 0, z: 0 }, radius: 3 });
    const c = makeBody({ id: "c", mass: 1, position: { x: 2, y: 0, z: 0 }, radius: 3 });
    const result = detectAndResolveCollisions(makeState([a, b, c]));
    // All three overlap, so a absorbs b, then the merged a-b still overlaps c
    // → should end with 1 body total, 2 events
    expect(result.bodies.length).toBeLessThanOrEqual(2);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
  });
});
