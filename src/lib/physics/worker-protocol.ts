/**
 * Message protocol shared between `physics.worker.ts` and its main-thread
 * consumers. Deliberately free of any `webworker`-lib types (self,
 * DedicatedWorkerGlobalScope, ...) so main-thread files can import it
 * without pulling the `webworker` lib into the main (dom-lib) TypeScript
 * program — see physics.worker.ts's header comment for why those two libs
 * can't be merged into one compilation.
 */

import type { CollisionEvent } from "./collisions";
import type { EnergyMetrics, SystemState } from "./types";

/** Sent by the main thread to request N integration steps. */
export interface PhysicsStepRequest {
  type: "STEP";
  /** Correlates this request with its response; echoed back verbatim. */
  requestId: number;
  /** Opaque value echoed back verbatim, letting the caller detect stale responses (see simulation-store's `generation`). */
  generation: number;
  state: SystemState;
  /** Number of RK4 steps to integrate before replying. Defaults to 1. */
  steps?: number;
  /** Use the Barnes-Hut octree instead of direct summation. Defaults to true. Ignored when `enableGR` is set. */
  useOctree?: boolean;
  /** Barnes-Hut opening angle. Defaults to octree.ts's DEFAULT_THETA (0.5). */
  theta?: number;
  /** Adds the post-Newtonian (Schwarzschild) precession correction to gravity. Defaults to false. */
  enableGR?: boolean;
  /** Speed of light in simulation units, used by the GR correction. Defaults to 60. */
  speedOfLight?: number;
  /**
   * When true, halves the timestep if energy drift between steps exceeds a
   * threshold, or doubles it (up to the requested `state.timeStep`) when
   * drift is negligible — automatically raising precision during close
   * encounters. Defaults to false.
   */
  adaptiveTimestep?: boolean;
}

/** Sent back to the main thread once the requested steps have run. */
export interface PhysicsStepResponse {
  type: "STEP_RESULT";
  requestId: number;
  generation: number;
  state: SystemState;
  metrics: EnergyMetrics;
  collisionEvents: CollisionEvent[];
  /** Wall-clock time this batch of steps took inside the worker, in ms. */
  stepMs: number;
  /** Total simulation time advanced by this batch (sums actual per-step dt, which varies under adaptive timestep). */
  elapsedDt: number;
}

/** Sent back to the main thread if a request could not be processed. */
export interface PhysicsErrorResponse {
  type: "ERROR";
  requestId: number;
  message: string;
}

export type PhysicsWorkerRequest = PhysicsStepRequest;
export type PhysicsWorkerResponse = PhysicsStepResponse | PhysicsErrorResponse;
