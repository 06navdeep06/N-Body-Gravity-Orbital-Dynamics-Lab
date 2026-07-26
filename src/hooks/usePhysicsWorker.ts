"use client";

/**
 * Owns the physics Web Worker's lifecycle and drives the simulation loop.
 *
 * Backpressure: the loop only sends a new STEP request once the previous
 * one has been answered (`pendingRef`). If the worker falls behind, frames
 * simply don't issue new requests rather than piling up a queue — the
 * worker never processes stale/overlapping batches.
 *
 * Frame budget: if a rendered frame takes longer than 16ms (sub-60fps), the
 * loop backs off `stepsPerFrame` by one (down to a floor of 1) and logs a
 * warning, so a struggling machine degrades to slower physics rather than a
 * stalling UI.
 */

import { useEffect, useRef } from "react";
import type { PhysicsStepRequest, PhysicsWorkerResponse } from "@/lib/physics/worker-protocol";
import type { Vector3D } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

const FRAME_BUDGET_MS = 16;
const HISTORY_PUSH_INTERVAL_MS = 200;

export function usePhysicsWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const lastHistoryPushRef = useRef<number>(0);
  const requestIdRef = useRef(0);

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

      const store = useSimulationStore.getState();
      store.setSystem(data.state);
      store.setEnergyMetrics(data.metrics);
      store.setWorkerStepMs(data.stepMs);
      if (data.collisionEvents.length > 0) store.recordCollisions(data.collisionEvents);

      if (store.showTrails) {
        const points: Record<string, Vector3D> = {};
        for (const body of data.state.bodies) points[body.id] = body.position;
        store.appendTrailPoints(points);
      }

      const now = performance.now();
      if (now - lastHistoryPushRef.current > HISTORY_PUSH_INTERVAL_MS) {
        lastHistoryPushRef.current = now;
        useTimelineStore.getState().pushState(data.state);
      }
    };

    worker.onerror = (event) => {
      console.error("[physics worker] uncaught error:", event.message);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

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
          `[physics worker] frame budget exceeded (${frameMs.toFixed(1)}ms > ${FRAME_BUDGET_MS}ms); reducing stepsPerFrame to ${reduced}`
        );
      }

      if (!store.isRunning || pendingRef.current || !workerRef.current) return;
      if (store.system.bodies.length === 0) return;

      pendingRef.current = true;
      requestIdRef.current += 1;

      const request: PhysicsStepRequest = {
        type: "STEP",
        requestId: requestIdRef.current,
        state: store.system,
        steps: store.stepsPerFrame,
        useOctree: store.useOctree,
        theta: store.theta,
        enableGR: store.enableGR,
        speedOfLight: store.speedOfLight,
        adaptiveTimestep: store.adaptiveTimestep,
      };
      workerRef.current.postMessage(request);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
