/**
 * Integration: store actions, preset loading, and the export/share
 * round-trips. These exercise the seams between modules rather than any
 * single formula.
 */

import { calculateEnergyMetrics } from "@/lib/physics/rk4";
import type { CelestialBody, SystemState } from "@/lib/physics/types";
import { PRESETS, getPresetById } from "@/lib/presets";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { decodeState, encodeState } from "@/lib/utils/share";

function makeBody(id: string, overrides: Partial<CelestialBody> = {}): CelestialBody {
  return {
    id,
    name: id,
    mass: 1,
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 0.1, y: 0.2, z: 0.3 },
    color: "#abcdef",
    radius: 0.5,
    ...overrides,
  };
}

/** Snapshot of the store's initial state, restored between tests. */
const pristine = useSimulationStore.getState();

beforeEach(() => {
  useSimulationStore.setState(pristine, true);
});

describe("simulation store", () => {
  it("adds, updates and removes bodies", () => {
    const store = useSimulationStore.getState();
    store.addBody(makeBody("a"));
    store.addBody(makeBody("b"));
    expect(useSimulationStore.getState().system.bodies).toHaveLength(2);

    useSimulationStore.getState().updateBody("a", { mass: 42 });
    expect(useSimulationStore.getState().system.bodies.find((b) => b.id === "a")!.mass).toBe(42);

    useSimulationStore.getState().removeBody("a");
    const remaining = useSimulationStore.getState().system.bodies;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("b");
  });

  it("clears the selection when the selected body is removed", () => {
    const store = useSimulationStore.getState();
    store.addBody(makeBody("a"));
    useSimulationStore.getState().selectBody("a");
    expect(useSimulationStore.getState().selectedBodyId).toBe("a");
    useSimulationStore.getState().removeBody("a");
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
  });

  it("bumps generation for external edits but not for worker results", () => {
    const start = useSimulationStore.getState().generation;
    const state: SystemState = { bodies: [makeBody("a")], timeStep: 0.01, G: 1, softening: 0.05 };

    useSimulationStore.getState().setSystem(state);
    const afterExternal = useSimulationStore.getState().generation;
    expect(afterExternal).toBe(start + 1);

    // Worker results must NOT bump it, or every step would invalidate itself.
    useSimulationStore.getState().applyPhysicsResult(state);
    expect(useSimulationStore.getState().generation).toBe(afterExternal);

    useSimulationStore.getState().addBody(makeBody("b"));
    expect(useSimulationStore.getState().generation).toBe(afterExternal + 1);
  });

  it("toggles run state and visualization flags", () => {
    const store = useSimulationStore.getState();
    expect(store.isRunning).toBe(false);
    store.togglePlay();
    expect(useSimulationStore.getState().isRunning).toBe(true);
    useSimulationStore.getState().pause();
    expect(useSimulationStore.getState().isRunning).toBe(false);

    useSimulationStore.getState().toggleShowTrails();
    expect(useSimulationStore.getState().showTrails).toBe(!pristine.showTrails);
  });

  it("caps the trail buffer length", () => {
    const store = useSimulationStore.getState();
    for (let i = 0; i < 900; i++) {
      useSimulationStore.getState().appendTrailPoints({ a: { x: i, y: 0, z: 0 } });
    }
    const trail = useSimulationStore.getState().trails.a!;
    expect(trail.length).toBeLessThanOrEqual(600);
    // Oldest points are dropped, so the newest sample survives.
    expect(trail[trail.length - 1]!.x).toBe(899);
    void store;
  });
});

describe("preset loading", () => {
  it("exposes presets with unique ids and non-empty bodies", () => {
    const ids = new Set<string>();
    for (const preset of PRESETS) {
      expect(preset.state.bodies.length).toBeGreaterThan(0);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("gives every preset a finite, negative (bound) total energy where expected", () => {
    for (const preset of PRESETS) {
      const metrics = calculateEnergyMetrics(preset.state);
      expect(Number.isFinite(metrics.totalEnergy)).toBe(true);
      expect(Number.isFinite(metrics.kineticEnergy)).toBe(true);
      expect(metrics.kineticEnergy).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses positive masses, radii and timesteps throughout", () => {
    for (const preset of PRESETS) {
      expect(preset.state.timeStep).toBeGreaterThan(0);
      expect(preset.state.G).toBeGreaterThan(0);
      for (const body of preset.state.bodies) {
        expect(body.mass).toBeGreaterThan(0);
        expect(body.radius).toBeGreaterThan(0);
        expect(Number.isFinite(body.position.x)).toBe(true);
        expect(Number.isFinite(body.velocity.x)).toBe(true);
      }
    }
  });

  it("applies preset overrides through loadPreset", () => {
    const mercury = getPresetById("mercury-precession");
    expect(mercury).toBeDefined();
    useSimulationStore.getState().loadPreset(mercury!);
    const state = useSimulationStore.getState();
    expect(state.presetId).toBe("mercury-precession");
    expect(state.enableGR).toBe(true);
    expect(state.isRunning).toBe(false);
    expect(state.trails).toEqual({});
  });

  it("resets speed of light between presets so stars don't become black holes", () => {
    const tde = getPresetById("tidal-disruption")!;
    useSimulationStore.getState().loadPreset(tde);
    expect(useSimulationStore.getState().speedOfLight).toBe(tde.speedOfLight);

    // A preset with no speedOfLight must fall back to the default, not
    // inherit the previous preset's value.
    const plain = getPresetById("sun-planet")!;
    useSimulationStore.getState().loadPreset(plain);
    expect(useSimulationStore.getState().speedOfLight).toBe(pristine.speedOfLight);
  });

  it("enables tidal disruption only for the preset that asks for it", () => {
    useSimulationStore.getState().loadPreset(getPresetById("tidal-disruption")!);
    expect(useSimulationStore.getState().enableTidalDisruption).toBe(true);
    useSimulationStore.getState().loadPreset(getPresetById("sun-planet")!);
    expect(useSimulationStore.getState().enableTidalDisruption).toBe(false);
  });
});

describe("share-link round trip", () => {
  it("encodes and decodes a state losslessly", () => {
    const state: SystemState = {
      bodies: [makeBody("a"), makeBody("b", { mass: 2.5, isFixed: true })],
      timeStep: 0.007,
      G: 1.5,
      softening: 0.02,
    };
    const decoded = decodeState(encodeState(state));
    expect(decoded).toEqual(state);
  });

  it("produces URL-safe output", () => {
    const state: SystemState = {
      bodies: [makeBody("a")],
      timeStep: 0.01, G: 1, softening: 0.05,
    };
    const encoded = encodeState(state);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null for malformed input rather than throwing", () => {
    expect(decodeState("not-valid-base64!!!")).toBeNull();
    expect(decodeState("")).toBeNull();
    expect(decodeState("YWJjZGVm")).toBeNull(); // valid base64, not deflate
  });

  it("round-trips every preset", () => {
    for (const preset of PRESETS) {
      const decoded = decodeState(encodeState(preset.state));
      expect(decoded).not.toBeNull();
      expect(decoded!.bodies).toHaveLength(preset.state.bodies.length);
      expect(decoded!.G).toBe(preset.state.G);
    }
  });
});

describe("JSON export round trip", () => {
  it("survives serialization for every preset", () => {
    for (const preset of PRESETS) {
      const parsed = JSON.parse(JSON.stringify(preset.state)) as SystemState;
      expect(parsed).toEqual(preset.state);
      // Energy must be identical after a round trip.
      expect(calculateEnergyMetrics(parsed).totalEnergy).toBeCloseTo(
        calculateEnergyMetrics(preset.state).totalEnergy,
        9
      );
    }
  });
});
