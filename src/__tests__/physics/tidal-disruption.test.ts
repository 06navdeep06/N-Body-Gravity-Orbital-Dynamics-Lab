/**
 * Tidal disruption: the trigger condition, and the conservation laws the
 * fragment cloud must obey.
 */

import { detectAndResolveCollisions } from "@/lib/physics/collisions";
import {
  detectAndResolveDisruptions,
  generateFragments,
  selfGravityAtSurface,
  shouldDisrupt,
  tidalAccelerationAcross,
} from "@/lib/physics/tidal-disruption";
import type { CelestialBody, SystemState } from "@/lib/physics/types";

const G = 1;

const blackHole: CelestialBody = {
  id: "bh", name: "BH", mass: 1e6,
  position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
  color: "#000000", radius: 2, isFixed: true, isBlackHole: true,
};

function starAt(distance: number, overrides: Partial<CelestialBody> = {}): CelestialBody {
  return {
    id: "star", name: "Star", mass: 1,
    position: { x: distance, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: Math.sqrt((G * blackHole.mass) / distance) },
    color: "#ffcc44", radius: 0.5,
    ...overrides,
  };
}

describe("tidal disruption", () => {
  describe("trigger condition", () => {
    it("disrupts only when tidal acceleration beats self-gravity", () => {
      for (const distance of [200, 80, 40, 20, 10]) {
        const star = starAt(distance);
        const tidal = tidalAccelerationAcross(blackHole.mass, star.radius, distance, G);
        const self = selfGravityAtSurface(star, G);
        expect(shouldDisrupt(star, blackHole, G)).toBe(tidal > self && shouldDisrupt(star, blackHole, G));
        // The decisive inequality must agree with the predicate at the extremes.
        if (distance >= 200) expect(tidal).toBeLessThan(self);
        if (distance <= 20) expect(tidal).toBeGreaterThan(self);
      }
    });

    it("does not disrupt far from the disruptor", () => {
      expect(shouldDisrupt(starAt(500), blackHole, G)).toBe(false);
    });

    it("disrupts deep inside the Roche limit", () => {
      expect(shouldDisrupt(starAt(20), blackHole, G)).toBe(true);
    });

    it("never disrupts a black hole or a fixed body", () => {
      expect(shouldDisrupt(starAt(10, { isBlackHole: true }), blackHole, G)).toBe(false);
      expect(shouldDisrupt(starAt(10, { isFixed: true }), blackHole, G)).toBe(false);
    });

    it("requires a large mass ratio", () => {
      // A disruptor only 10x heavier is below the 100:1 threshold.
      const light: CelestialBody = { ...blackHole, mass: 10, isBlackHole: false };
      expect(shouldDisrupt(starAt(3), light, G)).toBe(false);
    });

    it("ignores degenerate bodies", () => {
      expect(shouldDisrupt(starAt(10, { mass: 0 }), blackHole, G)).toBe(false);
      expect(shouldDisrupt(starAt(10, { radius: 0 }), blackHole, G)).toBe(false);
    });
  });

  describe("fragment generation", () => {
    const victim = starAt(20);
    const fragments = generateFragments(victim, blackHole, G, 12345);

    it("produces between 20 and 80 fragments", () => {
      expect(fragments.length).toBeGreaterThanOrEqual(20);
      expect(fragments.length).toBeLessThanOrEqual(80);
    });

    it("conserves mass exactly", () => {
      const total = fragments.reduce((sum, f) => sum + f.mass, 0);
      expect(total).toBeCloseTo(victim.mass, 12);
    });

    it("conserves momentum", () => {
      const px = fragments.reduce((s, f) => s + f.mass * f.velocity.x, 0);
      const py = fragments.reduce((s, f) => s + f.mass * f.velocity.y, 0);
      const pz = fragments.reduce((s, f) => s + f.mass * f.velocity.z, 0);
      expect(px).toBeCloseTo(victim.mass * victim.velocity.x, 9);
      expect(py).toBeCloseTo(victim.mass * victim.velocity.y, 9);
      expect(pz).toBeCloseTo(victim.mass * victim.velocity.z, 9);
    });

    it("preserves the center of mass", () => {
      const total = fragments.reduce((s, f) => s + f.mass, 0);
      const cx = fragments.reduce((s, f) => s + f.mass * f.position.x, 0) / total;
      const cz = fragments.reduce((s, f) => s + f.mass * f.position.z, 0) / total;
      expect(cx).toBeCloseTo(victim.position.x, 9);
      expect(cz).toBeCloseTo(victim.position.z, 9);
    });

    it("follows a decreasing power-law mass spectrum", () => {
      for (let i = 1; i < fragments.length; i++) {
        expect(fragments[i]!.mass).toBeLessThanOrEqual(fragments[i - 1]!.mass);
      }
      // Steep enough that the largest piece dominates the smallest.
      expect(fragments[0]!.mass / fragments[fragments.length - 1]!.mass).toBeGreaterThan(10);
    });

    it("marks fragments so they cannot re-disrupt", () => {
      for (const fragment of fragments) expect(fragment.isFragment).toBe(true);
    });

    it("is deterministic for the same victim and timestamp", () => {
      const again = generateFragments(victim, blackHole, G, 12345);
      expect(again.map((f) => f.mass)).toEqual(fragments.map((f) => f.mass));
      expect(again[0]!.position.x).toBe(fragments[0]!.position.x);
    });

    it("gives fragments a velocity shear rather than identical velocities", () => {
      const speeds = fragments.map((f) => Math.hypot(f.velocity.x, f.velocity.y, f.velocity.z));
      expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(0);
    });
  });

  describe("full pipeline", () => {
    it("replaces the victim with fragments and reports the event", () => {
      const state: SystemState = {
        bodies: [blackHole, starAt(20)],
        timeStep: 0.001, G, softening: 0.01,
      };
      const { bodies, events } = detectAndResolveDisruptions(state, 1);

      expect(events).toHaveLength(1);
      expect(events[0]!.disruptedBody).toBe("star");
      expect(events[0]!.disruptorBody).toBe("bh");
      expect(bodies.length).toBeGreaterThan(2);
      expect(bodies.some((b) => b.id === "star")).toBe(false);
      expect(bodies.some((b) => b.id === "bh")).toBe(true);
    });

    it("does not cascade — fragments are never re-disrupted", () => {
      const state: SystemState = {
        bodies: [blackHole, starAt(20)],
        timeStep: 0.001, G, softening: 0.01,
      };
      const first = detectAndResolveDisruptions(state, 1);
      const second = detectAndResolveDisruptions({ ...state, bodies: first.bodies }, 2);
      expect(second.events).toHaveLength(0);
      expect(second.bodies).toHaveLength(first.bodies.length);
    });

    it("does not cascade through a collision merge", () => {
      // Regression: mergeBodies used to drop `isFragment`, so two fragments
      // colliding produced a body that was eligible for disruption again.
      // Each disruption multiplies the body count, so that runs away.
      const state: SystemState = {
        bodies: [blackHole, starAt(20)],
        timeStep: 0.001, G, softening: 0.01,
      };
      const { bodies } = detectAndResolveDisruptions(state, 1);
      const fragments = bodies.filter((b) => b.isFragment);
      expect(fragments.length).toBeGreaterThan(1);

      // Force two fragments to overlap so they merge.
      const [a, b] = [fragments[0]!, fragments[1]!];
      const overlapping: CelestialBody[] = [
        blackHole,
        { ...a, radius: 5, position: { x: 20, y: 0, z: 0 } },
        { ...b, radius: 5, position: { x: 20.1, y: 0, z: 0 } },
      ];
      const merged = detectAndResolveCollisions(
        { ...state, bodies: overlapping },
        2
      );
      expect(merged.events).toHaveLength(1);
      expect(merged.events[0]!.mergedBody.isFragment).toBe(true);

      // …and the merged fragment must still be exempt from disruption.
      const after = detectAndResolveDisruptions({ ...state, bodies: merged.bodies }, 3);
      expect(after.events).toHaveLength(0);
    });

    it("leaves a stable system untouched", () => {
      const state: SystemState = {
        bodies: [blackHole, starAt(500)],
        timeStep: 0.001, G, softening: 0.01,
      };
      const { bodies, events } = detectAndResolveDisruptions(state, 1);
      expect(events).toHaveLength(0);
      expect(bodies).toHaveLength(2);
    });

    it("conserves total system mass through a disruption", () => {
      const state: SystemState = {
        bodies: [blackHole, starAt(20)],
        timeStep: 0.001, G, softening: 0.01,
      };
      const before = state.bodies.reduce((s, b) => s + b.mass, 0);
      const { bodies } = detectAndResolveDisruptions(state, 1);
      const after = bodies.reduce((s, b) => s + b.mass, 0);
      expect(after).toBeCloseTo(before, 9);
    });
  });
});
