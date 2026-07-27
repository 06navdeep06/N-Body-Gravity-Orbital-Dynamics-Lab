"use client";

/**
 * Owns the physics engines (CPU worker + optional WebGPU) and drives the
 * simulation loop.
 *
 * Backpressure: the loop only issues a new step once the previous one has
 * been answered (`pendingRef`) — applies to both backends. If an engine
 * falls behind, frames simply skip rather than piling up a queue.
 *
 * Frame budget: if a rendered frame takes longer than 16ms (sub-60fps), the
 * loop backs off `stepsPerFrame` by one (down to a floor of 1) and logs a
 * warning, so a struggling machine degrades to slower physics rather than a
 * stalling UI.
 *
 * Backend selection: `computeBackend` is a *request*. The GPU is used only
 * when it initialized successfully; otherwise the loop silently stays on the
 * CPU worker and `activeBackend` reports what actually ran.
 */

import { useEffect, useRef } from "react";
import { createGpuEngine, type GpuEngine } from "@/lib/physics/gpu/gpu-engine";
import { calculateEnergyMetrics } from "@/lib/physics/rk4";
import type { CollisionEvent } from "@/lib/physics/collisions";
import { detectAndResolveCollisions } from "@/lib/physics/collisions";
import type { TidalDisruptionEvent } from "@/lib/physics/tidal-disruption";
import { detectAndResolveDisruptions } from "@/lib/physics/tidal-disruption";
import { gwAnalyser } from "@/lib/physics/gravitational-waves";
import { poincareRecorder } from "@/lib/physics/poincare";
import type { PhysicsStepRequest, PhysicsWorkerResponse } from "@/lib/physics/worker-protocol";
import type { SystemState, Vector3D } from "@/lib/physics/types";
import {
  GPU_AUTO_THRESHOLD,
  useSimulationStore,
  type ComputeBackend,
} from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

const FRAME_BUDGET_MS = 16;
const HISTORY_PUSH_INTERVAL_MS = 200;

/** Shared post-step bookkeeping for whichever engine produced the state. */
function applyResult(
  state: SystemState,
  options: {
    generation: number;
    stepMs: number;
    elapsedDt: number;
    collisionEvents?: CollisionEvent[];
    disruptionEvents?: TidalDisruptionEvent[];
    metricsPrecomputed?: ReturnType<typeof calculateEnergyMetrics>;
    lastHistoryPushRef: { current: number };
  }
): void {
  const store = useSimulationStore.getState();
  // Stale result for a state that's since been replaced (preset switch,
  // timeline scrub) — discard rather than clobber the new one.
  if (options.generation !== store.generation) return;

  store.applyPhysicsResult(state);
  store.setEnergyMetrics(options.metricsPrecomputed ?? calculateEnergyMetrics(state));
  store.setWorkerStepMs(options.stepMs);
  store.addSimTime(options.elapsedDt);
  if (options.collisionEvents && options.collisionEvents.length > 0) {
    store.recordCollisions(options.collisionEvents);
  }
  if (options.disruptionEvents && options.disruptionEvents.length > 0) {
    store.recordDisruptions(options.disruptionEvents);
  }
  if (store.showPhaseSpace) poincareRecorder.record(state, store.primaryBodyId);
  if (store.showGwStrain) {
    gwAnalyser.speedOfLight = store.speedOfLight;
    gwAnalyser.push(state, state.G, store.simTime);
  }

  if (store.showTrails) {
    const points: Record<string, Vector3D> = {};
    for (const body of state.bodies) points[body.id] = body.position;
    store.appendTrailPoints(points);
  }

  const now = performance.now();
  if (now - options.lastHistoryPushRef.current > HISTORY_PUSH_INTERVAL_MS) {
    options.lastHistoryPushRef.current = now;
    useTimelineStore.getState().pushState(state);
  }
}

export function usePhysicsWorker() {
  const workerRef = useRef<Worker | null>(null);
  const gpuRef = useRef<GpuEngine | null>(null);
  const pendingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const lastHistoryPushRef = useRef<number>(0);
  const requestIdRef = useRef(0);

  // --- CPU worker ---------------------------------------------------------
  useEffect(() => {
    const worker = new Worker(new URL("../lib/physics/physics.worker.ts", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PhysicsWorkerResponse>) => {
      pendingRef.current = false;
      const data = event.data;

      if (data.type === "ERROR") {
        console.error("[physics worker]", data.message);
        return;
      }

      applyResult(data.state, {
        generation: data.generation,
        stepMs: data.stepMs,
        elapsedDt: data.elapsedDt,
        collisionEvents: data.collisionEvents,
        disruptionEvents: data.disruptionEvents,
        metricsPrecomputed: data.metrics,
        lastHistoryPushRef,
      });
    };

    worker.onerror = (event) => {
      console.error("[physics worker] uncaught error:", event.message);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- WebGPU engine (best-effort) ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    let engine: GpuEngine | null = null;

    void createGpuEngine().then((created) => {
      if (cancelled) {
        created?.destroy();
        return;
      }
      engine = created;
      gpuRef.current = created;
      useSimulationStore
        .getState()
        .setGpuInfo(
          created ? { adapterLabel: created.adapterLabel, maxBodies: created.getMaxBodies() } : null
        );
    });

    return () => {
      cancelled = true;
      engine?.destroy();
      gpuRef.current = null;
    };
  }, []);

  // --- Simulation loop ---------------------------------------------------
  useEffect(() => {
    function loop(now: number) {
      rafRef.current = requestAnimationFrame(loop);

      const frameMs = lastFrameTimeRef.current === 0 ? 0 : now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      const store = useSimulationStore.getState();
      if (frameMs > 0) store.setFps(1000 / frameMs);

      if (frameMs > FRAME_BUDGET_MS && store.stepsPerFrame > 1) {
        const reduced = store.stepsPerFrame - 1;
        store.setStepsPerFrame(reduced);
        console.warn(
          `[physics] frame budget exceeded (${frameMs.toFixed(1)}ms > ${FRAME_BUDGET_MS}ms); reducing stepsPerFrame to ${reduced}`
        );
      }

      const bodyCount = store.system.bodies.length;
      if (!store.isRunning || pendingRef.current || bodyCount === 0) return;

      const gpu = gpuRef.current;
      // Requested GPU, or auto-promoted for a big system — but only if the
      // device actually came up.
      const wantsGpu =
        gpu !== null &&
        (store.computeBackend === "gpu-webgpu" || bodyCount > GPU_AUTO_THRESHOLD) &&
        bodyCount <= gpu.getMaxBodies();
      const backend: ComputeBackend = wantsGpu ? "gpu-webgpu" : "cpu-worker";
      if (store.activeBackend !== backend) store.setActiveBackend(backend);

      if (wantsGpu && gpu) {
        pendingRef.current = true;
        const generation = store.generation;
        const state = store.system;
        const steps = store.stepsPerFrame;
        const startedAt = performance.now();

        void gpu
          .step(state, steps)
          .then((stepped) => {
            // Collisions and disruptions stay on the CPU: both change the
            // body count, which would mean re-allocating GPU buffers
            // mid-dispatch.
            const { bodies, events } = detectAndResolveCollisions(stepped, Date.now());
            let finalState = events.length > 0 ? { ...stepped, bodies } : stepped;

            let disruptionEvents: TidalDisruptionEvent[] = [];
            if (useSimulationStore.getState().enableTidalDisruption) {
              const disruption = detectAndResolveDisruptions(finalState, Date.now());
              if (disruption.events.length > 0) {
                finalState = { ...finalState, bodies: disruption.bodies };
                disruptionEvents = disruption.events;
              }
            }

            applyResult(finalState, {
              generation,
              stepMs: performance.now() - startedAt,
              elapsedDt: state.timeStep * steps,
              collisionEvents: events,
              disruptionEvents,
              lastHistoryPushRef,
            });
          })
          .catch((error: unknown) => {
            console.error("[gpu-engine] step failed; falling back to CPU worker:", error);
            gpuRef.current?.destroy();
            gpuRef.current = null;
            useSimulationStore.getState().setGpuInfo(null);
          })
          .finally(() => {
            pendingRef.current = false;
          });
        return;
      }

      if (!workerRef.current) return;
      pendingRef.current = true;
      requestIdRef.current += 1;

      const request: PhysicsStepRequest = {
        type: "STEP",
        requestId: requestIdRef.current,
        generation: store.generation,
        state: store.system,
        steps: store.stepsPerFrame,
        useOctree: store.useOctree,
        theta: store.theta,
        enableGR: store.enableGR,
        speedOfLight: store.speedOfLight,
        adaptiveTimestep: store.adaptiveTimestep,
        enableTidalDisruption: store.enableTidalDisruption,
      };
      workerRef.current.postMessage(request);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
