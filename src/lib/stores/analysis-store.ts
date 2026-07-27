/**
 * Analysis results (Lyapunov exponents, chaos map) kept in their own store so
 * streaming chaos-map rows don't re-render every simulation subscriber.
 */

import { create } from "zustand";
import type { ChaosMapSpec, LyapunovResult } from "@/lib/physics/lyapunov";

interface AnalysisState {
  /** MLE per body id, plus which body is currently being measured. */
  lyapunov: Record<string, LyapunovResult | null>;
  lyapunovPending: string | null;

  chaosMap: {
    /** Row-major grid of exponents; NaN = not yet computed or failed. */
    grid: Float32Array;
    gridSize: number;
    rowsDone: number;
    spec: ChaosMapSpec;
    running: boolean;
  } | null;

  setLyapunov: (bodyId: string, result: LyapunovResult | null) => void;
  setLyapunovPending: (bodyId: string | null) => void;
  clearLyapunov: () => void;

  startChaosMap: (gridSize: number, spec: ChaosMapSpec) => void;
  setChaosMapRow: (row: number, exponents: number[]) => void;
  finishChaosMap: () => void;
  clearChaosMap: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  lyapunov: {},
  lyapunovPending: null,
  chaosMap: null,

  setLyapunov: (bodyId, result) =>
    set((s) => ({
      lyapunov: { ...s.lyapunov, [bodyId]: result },
      lyapunovPending: s.lyapunovPending === bodyId ? null : s.lyapunovPending,
    })),
  setLyapunovPending: (lyapunovPending) => set({ lyapunovPending }),
  clearLyapunov: () => set({ lyapunov: {}, lyapunovPending: null }),

  startChaosMap: (gridSize, spec) =>
    set({
      chaosMap: {
        grid: new Float32Array(gridSize * gridSize).fill(Number.NaN),
        gridSize,
        rowsDone: 0,
        spec,
        running: true,
      },
    }),

  setChaosMapRow: (row, exponents) =>
    set((s) => {
      if (!s.chaosMap) return {};
      // New array each time so subscribers see an identity change; the grid
      // is small (gridSize² floats) so copying per row is cheap.
      const grid = Float32Array.from(s.chaosMap.grid);
      const { gridSize } = s.chaosMap;
      for (let col = 0; col < Math.min(gridSize, exponents.length); col++) {
        grid[row * gridSize + col] = exponents[col]!;
      }
      return {
        chaosMap: { ...s.chaosMap, grid, rowsDone: Math.max(s.chaosMap.rowsDone, row + 1) },
      };
    }),

  finishChaosMap: () =>
    set((s) => (s.chaosMap ? { chaosMap: { ...s.chaosMap, running: false } } : {})),

  clearChaosMap: () => set({ chaosMap: null }),
}));
