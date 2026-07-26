/**
 * Central Zustand store for simulation state: the current `SystemState`,
 * run/pause control, rendering toggles, and the last physics results
 * (energy metrics, collision events) reported by the worker.
 *
 * The physics worker itself is *not* driven from here — `usePhysicsWorker`
 * owns the worker lifecycle and writes results back into this store, so
 * this file stays a plain data container with no side effects.
 */

import { create } from "zustand";
import type { CollisionEvent } from "@/lib/physics/collisions";
import type { CelestialBody, EnergyMetrics, SystemState, Vector3D } from "@/lib/physics/types";

export const MAX_TRAIL_LENGTH = 600;
export const MAX_COLLISION_LOG = 20;

export interface Preset {
  id: string;
  name: string;
  description: string;
  state: SystemState;
  /** Optional store overrides applied when this preset loads (e.g. Mercury Precession enabling GR). */
  enableGR?: boolean;
  speedOfLight?: number;
}

interface SimulationState {
  system: SystemState;
  presetId: string;
  /**
   * Bumped whenever `system` is replaced/mutated by anything other than
   * the physics worker's own step results (preset load, timeline scrub,
   * snapshot restore, add/remove body). The worker hook stamps each
   * request with the generation it was issued under and discards any
   * response whose generation has since gone stale — otherwise a slow
   * in-flight response for the *previous* preset can land after a preset
   * switch and silently overwrite the new one.
   */
  generation: number;

  isRunning: boolean;
  stepsPerFrame: number;
  useOctree: boolean;
  theta: number;
  adaptiveTimestep: boolean;

  selectedBodyId: string | null;
  primaryBodyId: string | null;

  showTrails: boolean;
  showVelocityArrows: boolean;
  showOrbitEllipses: boolean;
  showLagrangePoints: boolean;
  showFormulaOverlay: boolean;

  enableGR: boolean;
  speedOfLight: number;

  trails: Record<string, Vector3D[]>;
  energyMetrics: EnergyMetrics | null;
  collisionEvents: CollisionEvent[];
  fps: number;
  workerStepMs: number;

  // --- actions ---
  /** External replacement of the system (timeline scrub, snapshot restore) — bumps `generation`. */
  setSystem: (system: SystemState) => void;
  /** Applies a physics worker's step result — does NOT bump `generation` (it's not an external reset). */
  applyPhysicsResult: (system: SystemState) => void;
  addBody: (body: CelestialBody) => void;
  removeBody: (id: string) => void;
  updateBody: (id: string, patch: Partial<CelestialBody>) => void;

  selectBody: (id: string | null) => void;
  setPrimaryBody: (id: string | null) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;

  loadPreset: (preset: Preset) => void;

  setTimeStep: (dt: number) => void;
  setG: (g: number) => void;
  setSoftening: (s: number) => void;
  setStepsPerFrame: (n: number) => void;
  setUseOctree: (v: boolean) => void;
  setTheta: (theta: number) => void;
  setAdaptiveTimestep: (v: boolean) => void;

  toggleShowTrails: () => void;
  toggleShowVelocityArrows: () => void;
  toggleShowOrbitEllipses: () => void;
  toggleShowLagrangePoints: () => void;
  toggleShowFormulaOverlay: () => void;
  toggleEnableGR: () => void;
  setSpeedOfLight: (c: number) => void;

  appendTrailPoints: (points: Record<string, Vector3D>) => void;
  clearTrails: () => void;

  recordCollisions: (events: CollisionEvent[]) => void;
  setEnergyMetrics: (metrics: EnergyMetrics) => void;
  setFps: (fps: number) => void;
  setWorkerStepMs: (ms: number) => void;
}

const DEFAULT_SYSTEM: SystemState = {
  bodies: [],
  timeStep: 0.01,
  G: 1,
  softening: 0.05,
};

export const useSimulationStore = create<SimulationState>((set, get) => ({
  system: DEFAULT_SYSTEM,
  presetId: "empty",
  generation: 0,

  isRunning: false,
  stepsPerFrame: 4,
  useOctree: true,
  theta: 0.5,
  adaptiveTimestep: false,

  selectedBodyId: null,
  primaryBodyId: null,

  showTrails: true,
  showVelocityArrows: false,
  showOrbitEllipses: false,
  showLagrangePoints: false,
  showFormulaOverlay: false,

  enableGR: false,
  speedOfLight: 60,

  trails: {},
  energyMetrics: null,
  collisionEvents: [],
  fps: 0,
  workerStepMs: 0,

  setSystem: (system) => set((s) => ({ system, generation: s.generation + 1 })),
  applyPhysicsResult: (system) => set({ system }),

  addBody: (body) =>
    set((s) => ({
      system: { ...s.system, bodies: [...s.system.bodies, body] },
      generation: s.generation + 1,
    })),

  removeBody: (id) =>
    set((s) => ({
      system: { ...s.system, bodies: s.system.bodies.filter((b) => b.id !== id) },
      selectedBodyId: s.selectedBodyId === id ? null : s.selectedBodyId,
      generation: s.generation + 1,
    })),

  updateBody: (id, patch) =>
    set((s) => ({
      system: {
        ...s.system,
        bodies: s.system.bodies.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    })),

  selectBody: (id) => set({ selectedBodyId: id }),
  setPrimaryBody: (id) => set({ primaryBodyId: id }),

  play: () => set({ isRunning: true }),
  pause: () => set({ isRunning: false }),
  togglePlay: () => set((s) => ({ isRunning: !s.isRunning })),

  loadPreset: (preset) =>
    set((s) => ({
      system: preset.state,
      presetId: preset.id,
      selectedBodyId: null,
      primaryBodyId: null,
      trails: {},
      collisionEvents: [],
      energyMetrics: null,
      isRunning: false,
      enableGR: preset.enableGR ?? false,
      speedOfLight: preset.speedOfLight ?? get().speedOfLight,
      generation: s.generation + 1,
    })),

  setTimeStep: (dt) => set((s) => ({ system: { ...s.system, timeStep: dt } })),
  setG: (g) => set((s) => ({ system: { ...s.system, G: g } })),
  setSoftening: (softening) => set((s) => ({ system: { ...s.system, softening } })),
  setStepsPerFrame: (n) => set({ stepsPerFrame: Math.max(1, Math.round(n)) }),
  setUseOctree: (useOctree) => set({ useOctree }),
  setTheta: (theta) => set({ theta }),
  setAdaptiveTimestep: (adaptiveTimestep) => set({ adaptiveTimestep }),

  toggleShowTrails: () => set((s) => ({ showTrails: !s.showTrails })),
  toggleShowVelocityArrows: () => set((s) => ({ showVelocityArrows: !s.showVelocityArrows })),
  toggleShowOrbitEllipses: () => set((s) => ({ showOrbitEllipses: !s.showOrbitEllipses })),
  toggleShowLagrangePoints: () => set((s) => ({ showLagrangePoints: !s.showLagrangePoints })),
  toggleShowFormulaOverlay: () => set((s) => ({ showFormulaOverlay: !s.showFormulaOverlay })),
  toggleEnableGR: () => set((s) => ({ enableGR: !s.enableGR })),
  setSpeedOfLight: (speedOfLight) => set({ speedOfLight }),

  appendTrailPoints: (points) =>
    set((s) => {
      const trails = { ...s.trails };
      for (const [id, point] of Object.entries(points)) {
        const existing = trails[id] ?? [];
        const next = existing.length >= MAX_TRAIL_LENGTH ? existing.slice(1) : existing;
        trails[id] = [...next, point];
      }
      return { trails };
    }),

  clearTrails: () => set({ trails: {} }),

  recordCollisions: (events) => {
    if (events.length === 0) return;
    const s = get();
    set({ collisionEvents: [...events, ...s.collisionEvents].slice(0, MAX_COLLISION_LOG) });
  },

  setEnergyMetrics: (energyMetrics) => set({ energyMetrics }),
  setFps: (fps) => set({ fps }),
  setWorkerStepMs: (workerStepMs) => set({ workerStepMs }),
}));
