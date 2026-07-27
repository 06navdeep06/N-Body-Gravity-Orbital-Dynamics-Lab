"use client";

/**
 * Owns the analysis worker and exposes request helpers via a module-level
 * singleton, so any component can kick off a Lyapunov measurement or chaos
 * map without prop-drilling a worker reference.
 */

import { useEffect } from "react";
import type { AnalysisRequest, AnalysisResponse } from "@/lib/physics/analysis-protocol";
import { DEFAULT_CHAOS_MAP_SPEC, type ChaosMapSpec } from "@/lib/physics/lyapunov";
import { useAnalysisStore } from "@/lib/stores/analysis-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";

let worker: Worker | null = null;
let requestCounter = 0;
let activeChaosMapRequest: number | null = null;

function post(request: AnalysisRequest): boolean {
  if (!worker) return false;
  worker.postMessage(request);
  return true;
}

/** Measures the MLE for one body. No-op if the worker isn't up yet. */
export function requestLyapunov(bodyId: string, steps?: number): void {
  const { system } = useSimulationStore.getState();
  if (!system.bodies.some((b) => b.id === bodyId)) return;
  useAnalysisStore.getState().setLyapunovPending(bodyId);
  requestCounter += 1;
  const sent = post({
    type: "LYAPUNOV",
    requestId: requestCounter,
    state: system,
    targetId: bodyId,
    steps,
  });
  if (!sent) useAnalysisStore.getState().setLyapunovPending(null);
}

/** Starts (or restarts) a chaos-map sweep over test-particle initial conditions. */
export function requestChaosMap(partialSpec?: Partial<ChaosMapSpec>): void {
  const { system } = useSimulationStore.getState();
  if (system.bodies.length === 0) return;

  if (activeChaosMapRequest !== null) {
    post({ type: "CANCEL", requestId: activeChaosMapRequest });
  }

  const spec: ChaosMapSpec = { ...DEFAULT_CHAOS_MAP_SPEC, ...partialSpec };
  requestCounter += 1;
  activeChaosMapRequest = requestCounter;
  useAnalysisStore.getState().startChaosMap(spec.gridSize, spec);
  const sent = post({ type: "CHAOS_MAP", requestId: requestCounter, state: system, spec });
  if (!sent) {
    activeChaosMapRequest = null;
    useAnalysisStore.getState().clearChaosMap();
  }
}

export function cancelChaosMap(): void {
  if (activeChaosMapRequest === null) return;
  post({ type: "CANCEL", requestId: activeChaosMapRequest });
  activeChaosMapRequest = null;
  useAnalysisStore.getState().finishChaosMap();
}

export function useAnalysisWorker() {
  useEffect(() => {
    const instance = new Worker(new URL("../lib/physics/analysis.worker.ts", import.meta.url));
    worker = instance;

    instance.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const data = event.data;
      const store = useAnalysisStore.getState();
      switch (data.type) {
        case "LYAPUNOV_RESULT":
          store.setLyapunov(data.targetId, data.result);
          break;
        case "CHAOS_MAP_ROW":
          if (data.requestId === activeChaosMapRequest) {
            store.setChaosMapRow(data.row, data.exponents);
          }
          break;
        case "CHAOS_MAP_DONE":
          if (data.requestId === activeChaosMapRequest) {
            activeChaosMapRequest = null;
            store.finishChaosMap();
          }
          break;
        case "ERROR":
          console.error("[analysis worker]", data.message);
          store.setLyapunovPending(null);
          break;
      }
    };

    instance.onerror = (event) => {
      console.error("[analysis worker] uncaught error:", event.message);
    };

    return () => {
      instance.terminate();
      worker = null;
      activeChaosMapRequest = null;
    };
  }, []);
}
