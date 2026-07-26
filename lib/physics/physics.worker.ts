/**
 * Physics Web Worker.
 *
 * Runs RK4 integration off the main thread so the render loop never stalls
 * waiting on N-body math. Large body counts use the Barnes-Hut octree
 * (O(N log N) per step) instead of the direct O(N^2) sum; the caller
 * chooses the threshold via the request's `useOctree` flag.
 *
 * This file is type-checked against the "webworker" lib (see
 * tsconfig.worker.json) rather than "dom", since a dedicated worker's
 * global scope (self, postMessage, onmessage) is not a Window and the two
 * lib.d.ts sets declare incompatible globals if merged into one program.
 */

/// <reference lib="webworker" />

import type { EnergyMetrics, SystemState } from "./types";
import { calculateEnergyMetrics, stepRK4 } from "./rk4";
import { calculateAccelerationsBarnesHut, DEFAULT_THETA } from "./octree";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Sent by the main thread to request N integration steps. */
export interface PhysicsStepRequest {
  type: "STEP";
  /** Correlates this request with its response; echoed back verbatim. */
  requestId: number;
  state: SystemState;
  /** Number of RK4 steps to integrate before replying. Defaults to 1. */
  steps?: number;
  /** Use the Barnes-Hut octree instead of direct summation. Defaults to true. */
  useOctree?: boolean;
  /** Barnes-Hut opening angle. Defaults to octree.ts's DEFAULT_THETA (0.5). */
  theta?: number;
}

/** Sent back to the main thread once the requested steps have run. */
export interface PhysicsStepResponse {
  type: "STEP_RESULT";
  requestId: number;
  state: SystemState;
  metrics: EnergyMetrics;
}

/** Sent back to the main thread if a request could not be processed. */
export interface PhysicsErrorResponse {
  type: "ERROR";
  requestId: number;
  message: string;
}

export type PhysicsWorkerRequest = PhysicsStepRequest;
export type PhysicsWorkerResponse = PhysicsStepResponse | PhysicsErrorResponse;

function handleStep(request: PhysicsStepRequest): void {
  const { state, requestId } = request;
  const steps = request.steps ?? 1;
  const useOctree = request.useOctree ?? true;
  const theta = request.theta ?? DEFAULT_THETA;

  const accelerationFn = useOctree
    ? (bodies: SystemState["bodies"], G: number, softening: number) =>
        calculateAccelerationsBarnesHut(bodies, G, softening, theta)
    : undefined;

  let nextState = state;
  for (let i = 0; i < steps; i++) {
    nextState = accelerationFn ? stepRK4(nextState, accelerationFn) : stepRK4(nextState);
  }

  const metrics = calculateEnergyMetrics(nextState);

  const response: PhysicsStepResponse = {
    type: "STEP_RESULT",
    requestId,
    state: nextState,
    metrics,
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
