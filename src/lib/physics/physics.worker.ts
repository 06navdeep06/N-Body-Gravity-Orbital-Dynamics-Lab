/**
 * Physics Web Worker.
 *
 * Runs RK4 integration off the main thread so the render loop never stalls
 * waiting on N-body math. Large body counts use the Barnes-Hut octree
 * (O(N log N) per step) instead of the direct O(N^2) sum; the caller
 * chooses the threshold via the request's `useOctree` flag. Collision
 * detection/merging runs after every step, and GR precession (when
 * enabled) forces direct summation since its pairwise correction isn't
 * compatible with the octree's far-field approximation.
 *
 * This file is type-checked against the "webworker" lib (see
 * tsconfig.worker.json) rather than "dom", since a dedicated worker's
 * global scope (self, postMessage, onmessage) is not a Window and the two
 * lib.d.ts sets declare incompatible globals if merged into one program.
 */

/// <reference lib="webworker" />

import type { CollisionEvent } from "./collisions";
import { detectAndResolveCollisions } from "./collisions";
import { calculateAccelerationsWithGR } from "./gr-correction";
import type { AccelerationFn } from "./rk4";
import { calculateEnergyMetrics, stepRK4 } from "./rk4";
import { calculateAccelerationsBarnesHut, DEFAULT_THETA } from "./octree";
import type { EnergyMetrics, SystemState } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Relative energy-drift bands driving adaptive-timestep adjustments. */
const ADAPTIVE_HIGH_DRIFT = 1e-5;
const ADAPTIVE_LOW_DRIFT = 1e-7;
const ADAPTIVE_MIN_DT_FACTOR = 1 / 64;

/** Sent by the main thread to request N integration steps. */
export interface PhysicsStepRequest {
  type: "STEP";
  /** Correlates this request with its response; echoed back verbatim. */
  requestId: number;
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
  state: SystemState;
  metrics: EnergyMetrics;
  collisionEvents: CollisionEvent[];
  /** Wall-clock time this batch of steps took inside the worker, in ms. */
  stepMs: number;
}

/** Sent back to the main thread if a request could not be processed. */
export interface PhysicsErrorResponse {
  type: "ERROR";
  requestId: number;
  message: string;
}

export type PhysicsWorkerRequest = PhysicsStepRequest;
export type PhysicsWorkerResponse = PhysicsStepResponse | PhysicsErrorResponse;

function pickAccelerationFn(
  request: PhysicsStepRequest
): AccelerationFn | undefined {
  if (request.enableGR) {
    return calculateAccelerationsWithGR(request.speedOfLight ?? 60);
  }
  if (request.useOctree ?? true) {
    const theta = request.theta ?? DEFAULT_THETA;
    return (bodies, G, softening) => calculateAccelerationsBarnesHut(bodies, G, softening, theta);
  }
  return undefined; // stepRK4 defaults to direct O(N^2) summation
}

function handleStep(request: PhysicsStepRequest): void {
  const start = performance.now();
  const { requestId } = request;
  const steps = request.steps ?? 1;
  const adaptiveTimestep = request.adaptiveTimestep ?? false;
  const accelerationFn = pickAccelerationFn(request);

  const requestedDt = request.state.timeStep;
  const minDt = requestedDt * ADAPTIVE_MIN_DT_FACTOR;
  const maxDt = requestedDt;

  let currentState = request.state;
  const allCollisionEvents: CollisionEvent[] = [];

  for (let i = 0; i < steps; i++) {
    const prevMetrics = adaptiveTimestep ? calculateEnergyMetrics(currentState) : null;

    let stepped = accelerationFn ? stepRK4(currentState, accelerationFn) : stepRK4(currentState);

    const { bodies, events } = detectAndResolveCollisions(stepped, Date.now());
    if (events.length > 0) {
      stepped = { ...stepped, bodies };
      allCollisionEvents.push(...events);
    }

    let nextDt = currentState.timeStep;
    if (adaptiveTimestep && prevMetrics) {
      const newMetrics = calculateEnergyMetrics(stepped);
      const reference = Math.abs(prevMetrics.totalEnergy) > 1e-12 ? Math.abs(prevMetrics.totalEnergy) : 1;
      const drift = Math.abs(newMetrics.totalEnergy - prevMetrics.totalEnergy) / reference;

      if (drift > ADAPTIVE_HIGH_DRIFT) {
        nextDt = Math.max(minDt, currentState.timeStep / 2);
      } else if (drift < ADAPTIVE_LOW_DRIFT) {
        nextDt = Math.min(maxDt, currentState.timeStep * 2);
      }
    }

    currentState = { ...stepped, timeStep: nextDt };
  }

  const metrics = calculateEnergyMetrics(currentState);
  const stepMs = performance.now() - start;

  const response: PhysicsStepResponse = {
    type: "STEP_RESULT",
    requestId,
    state: currentState,
    metrics,
    collisionEvents: allCollisionEvents,
    stepMs,
  };
  ctx.postMessage(response);
}

ctx.onmessage = (event: MessageEvent<PhysicsWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "STEP":
        handleStep(request);
        break;
      default: {
        // Exhaustiveness guard: if PhysicsWorkerRequest grows a new variant
        // without a matching case above, this line fails to compile.
        const _exhaustive: never = request.type;
        void _exhaustive;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: PhysicsErrorResponse = {
      type: "ERROR",
      requestId: request.requestId,
      message,
    };
    ctx.postMessage(errorResponse);
  }
};

export {};
