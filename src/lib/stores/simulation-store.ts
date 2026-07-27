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

export type CameraMode = "free" | "follow" | "topdown" | "flyby" | "corotating" | "dolly";

/** Which engine advances the physics. */
export type ComputeBackend = "cpu-worker" | "gpu-webgpu";

/** Body count above which the GPU path is auto-selected when available. */
export const GPU_AUTO_THRESHOLD = 500;

/** Simulation-unit speed of light used when a preset doesn't specify one. */
export const DEFAULT_SPEED_OF_LIGHT = 60;

/** A computed transfer awaiting execution; rendered as an arc in the scene. */
export interface PlannedTransfer {
  departureId: string;
  arrivalId: string;
  primaryId: string;
  r1: number;
  r2: number;
  deltaV1: number;
  deltaV2: number;
  transferTime: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  state: SystemState;
  /** Optional store overrides applied when this preset loads (e.g. Mercury Precession enabling GR). */
  enableGR?: boolean;
  speedOfLight?: number;
  /** Visual-only multiplier applied to body radii at render time (Real Solar System). */
  visualRadiusScale?: number;
  /** Cap on displayed radius in sim units (0 = uncapped) so the Sun doesn't swallow inner planets at high exaggeration. */
  maxDisplayRadius?: number;
  /** How to convert simulation time units to human time for display. */
  timeUnit?: { label: string; earthDaysPerUnit: number };
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
  showSpacetimeGrid: boolean;
  showHillSpheres: boolean;
  showRocheLimits: boolean;
  showPhaseSpace: boolean;
  showResonances: boolean;
  showChaosMap: boolean;
  showGwStrain: boolean;
  showLensing: boolean;

  /** Requested backend; `activeBackend` is what actually ended up running. */
  computeBackend: ComputeBackend;
  activeBackend: ComputeBackend;
  gpuAdapterLabel: string | null;
  gpuMaxBodies: number | null;

  scriptEditorOpen: boolean;

  cameraMode: CameraMode;
  /** Visual-only radius multiplier (see Preset.visualRadiusScale). */
  visualRadiusScale: number;
  maxDisplayRadius: number;
  /** Accumulated simulation time since the preset was loaded, in sim time units. */
  simTime: number;
  timeUnit: { label: string; earthDaysPerUnit: number } | null;

  plannedTransfer: PlannedTransfer | null;
  transferPlannerOpen: boolean;

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
  toggleShowSpacetimeGrid: () => void;
  toggleShowHillSpheres: () => void;
  toggleShowRocheLimits: () => void;
  toggleShowPhaseSpace: () => void;
  toggleShowResonances: () => void;
  toggleShowChaosMap: () => void;
  toggleShowGwStrain: () => void;
  toggleShowLensing: () => void;

  setComputeBackend: (backend: ComputeBackend) => void;
  setGpuInfo: (info: { adapterLabel: string; maxBodies: number } | null) => void;
  setActiveBackend: (backend: ComputeBackend) => void;
  setScriptEditorOpen: (open: boolean) => void;
  toggleEnableGR: () => void;
  setSpeedOfLight: (c: number) => void;

  setCameraMode: (mode: CameraMode) => void;
  setVisualRadiusScale: (s: number) => void;
  addSimTime: (dt: number) => void;
  setPlannedTransfer: (t: PlannedTransfer | null) => void;
  setTransferPlannerOpen: (open: boolean) => void;

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
  showSpacetimeGrid: false,
  showHillSpheres: false,
  showRocheLimits: false,
  showPhaseSpace: false,
  showResonances: false,
  showChaosMap: false,
  showGwStrain: false,
  showLensing: true,

  computeBackend: "cpu-worker",
  activeBackend: "cpu-worker",
  gpuAdapterLabel: null,
  gpuMaxBodies: null,

  scriptEditorOpen: false,

  cameraMode: "free",
  visualRadiusScale: 1,
  maxDisplayRadius: 0,
  simTime: 0,
  timeUnit: null,

  plannedTransfer: null,
  transferPlannerOpen: false,

  enableGR: false,
  speedOfLight: DEFAULT_SPEED_OF_LIGHT,

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
      // Reset rather than carrying over: c controls the Schwarzschild radius
      // used for black-hole rendering, so a leftover value from a black-hole
      // preset would make an ordinary star in the next preset render as one.
      speedOfLight: preset.speedOfLight ?? DEFAULT_SPEED_OF_LIGHT,
      visualRadiusScale: preset.visualRadiusScale ?? 1,
      maxDisplayRadius: preset.maxDisplayRadius ?? 0,
      simTime: 0,
      timeUnit: preset.timeUnit ?? null,
      plannedTransfer: null,
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
  toggleShowSpacetimeGrid: () => set((s) => ({ showSpacetimeGrid: !s.showSpacetimeGrid })),
  toggleShowHillSpheres: () => set((s) => ({ showHillSpheres: !s.showHillSpheres })),
  toggleShowRocheLimits: () => set((s) => ({ showRocheLimits: !s.showRocheLimits })),
  toggleShowPhaseSpace: () => set((s) => ({ showPhaseSpace: !s.showPhaseSpace })),
  toggleShowResonances: () => set((s) => ({ showResonances: !s.showResonances })),
  toggleShowChaosMap: () => set((s) => ({ showChaosMap: !s.showChaosMap })),
  toggleShowGwStrain: () => set((s) => ({ showGwStrain: !s.showGwStrain })),
  toggleShowLensing: () => set((s) => ({ showLensing: !s.showLensing })),

  setComputeBackend: (computeBackend) => set({ computeBackend }),
  setActiveBackend: (activeBackend) => set({ activeBackend }),
  setGpuInfo: (info) =>
    set(
      info
        ? { gpuAdapterLabel: info.adapterLabel, gpuMaxBodies: info.maxBodies }
        : { gpuAdapterLabel: null, gpuMaxBodies: null }
    ),
  setScriptEditorOpen: (scriptEditorOpen) => set({ scriptEditorOpen }),
  toggleEnableGR: () => set((s) => ({ enableGR: !s.enableGR })),
  setSpeedOfLight: (speedOfLight) => set({ speedOfLight }),

  setCameraMode: (cameraMode) => set({ cameraMode }),
  setVisualRadiusScale: (visualRadiusScale) => set({ visualRadiusScale }),
  addSimTime: (dt) => set((s) => ({ simTime: s.simTime + dt })),
  setPlannedTransfer: (plannedTransfer) => set({ plannedTransfer }),
  setTransferPlannerOpen: (transferPlannerOpen) => set({ transferPlannerOpen }),

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
