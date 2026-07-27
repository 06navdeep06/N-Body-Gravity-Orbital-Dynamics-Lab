/**
 * Analysis worker: Lyapunov exponents and chaos maps.
 *
 * Deliberately separate from physics.worker.ts — a chaos map integrates
 * gridSize² independent systems and can take many seconds, which would stall
 * the simulation loop if it shared that worker's message queue.
 *
 * Chaos-map rows are posted back as they finish so the heatmap fills in
 * progressively, and a CANCEL message drops an in-flight sweep (the row loop
 * yields to the message queue between rows so cancellation can land).
 *
 * Type-checked against the "webworker" lib (tsconfig.worker.json).
 */

/// <reference lib="webworker" />

import type {
  AnalysisErrorResponse,
  AnalysisRequest,
  ChaosMapDoneResponse,
  ChaosMapRequest,
  ChaosMapRowResponse,
  LyapunovRequest,
  LyapunovResponse,
} from "./analysis-protocol";
import {
  buildTestParticleSystem,
  computeLyapunovExponent,
  DEFAULT_CHAOS_MAP_SPEC,
  type ChaosMapSpec,
} from "./lyapunov";
import { inferPrimaryBody } from "./orbital-elements";
import type { CelestialBody } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Request ids whose sweeps should stop at the next row boundary. */
const cancelled = new Set<number>();

function handleLyapunov(request: LyapunovRequest): void {
  const result = computeLyapunovExponent(request.state, request.targetId, {
    steps: request.steps,
  });
  const response: LyapunovResponse = {
    type: "LYAPUNOV_RESULT",
    requestId: request.requestId,
    targetId: request.targetId,
    result,
  };
  ctx.postMessage(response);
}

/** Yields to the event loop so queued CANCEL messages get processed. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function handleChaosMap(request: ChaosMapRequest): Promise<void> {
  const spec: ChaosMapSpec = { ...DEFAULT_CHAOS_MAP_SPEC, ...request.spec };
  const { state, requestId } = request;

  const primary = inferPrimaryBody(state.bodies);
  if (!primary) {
    ctx.postMessage({
      type: "ERROR",
      requestId,
      message: "chaos map needs a primary body",
    } satisfies AnalysisErrorResponse);
    return;
  }

  // Only the gravitationally significant bodies drive a test particle's
  // dynamics; carrying a 200-particle ring into every sample would make the
  // sweep quadratically slower for no change in the result.
  const totalMass = state.bodies.reduce((sum, b) => sum + b.mass, 0);
  const massive: CelestialBody[] = state.bodies.filter(
    (b) => b.mass / totalMass > 1e-4 || b.id === primary.id
  );

  const { gridSize } = spec;
  const radiusStep = (spec.radiusMax - spec.radiusMin) / Math.max(1, gridSize - 1);
  const speedStep =
    (spec.speedFactorMax - spec.speedFactorMin) / Math.max(1, gridSize - 1);

  for (let row = 0; row < gridSize; row++) {
    if (cancelled.has(requestId)) break;

    const speedFactor = spec.speedFactorMin + row * speedStep;
    const exponents: number[] = new Array(gridSize);

    for (let col = 0; col < gridSize; col++) {
      const radius = spec.radiusMin + col * radiusStep;
      const { system, testId } = buildTestParticleSystem(
        state,
        primary,
        radius,
        speedFactor,
        massive
      );
      const result = computeLyapunovExponent(system, testId, {
        steps: spec.stepsPerSample,
        renormEvery: 50,
      });
      exponents[col] = result ? result.exponent : Number.NaN;
    }

    ctx.postMessage({
      type: "CHAOS_MAP_ROW",
      requestId,
      gridSize,
      row,
      exponents,
      spec,
    } satisfies ChaosMapRowResponse);

    await nextTick();
  }

  cancelled.delete(requestId);
  ctx.postMessage({ type: "CHAOS_MAP_DONE", requestId } satisfies ChaosMapDoneResponse);
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "LYAPUNOV":
        handleLyapunov(request);
        break;
      case "CHAOS_MAP":
        void handleChaosMap(request);
        break;
      case "CANCEL":
        cancelled.add(request.requestId);
        break;
      default: {
        const _exhaustive: never = request;
        void _exhaustive;
      }
    }
  } catch (err) {
    ctx.postMessage({
      type: "ERROR",
      requestId: (request as { requestId?: number }).requestId ?? -1,
      message: err instanceof Error ? err.message : String(err),
    } satisfies AnalysisErrorResponse);
  }
};

export {};
