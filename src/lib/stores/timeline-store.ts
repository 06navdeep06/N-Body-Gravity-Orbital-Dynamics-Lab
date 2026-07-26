/**
 * Timeline management: a capped history of recent SystemStates (for
 * scrubbing/rewind) plus user-named snapshots (for indefinite save/restore).
 * Kept separate from `simulation-store` so pushing a new history entry every
 * few frames doesn't force every store subscriber to re-render.
 */

import { create } from "zustand";
import type { SystemState } from "@/lib/physics/types";

export const MAX_HISTORY = 1000;

export interface Snapshot {
  name: string;
  state: SystemState;
  timestamp: number;
}

interface TimelineState {
  history: SystemState[];
  /** Index into `history` the user is currently viewing. -1 when history is empty. */
  historyIndex: number;
  snapshots: Snapshot[];

  pushState: (state: SystemState) => void;
  scrubTo: (index: number) => SystemState | null;
  clearHistory: () => void;

  saveSnapshot: (name: string, state: SystemState) => void;
  loadSnapshot: (index: number) => SystemState | null;
  deleteSnapshot: (index: number) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  history: [],
  historyIndex: -1,
  snapshots: [],

  pushState: (state) =>
    set((s) => {
      const history = s.history.length >= MAX_HISTORY ? s.history.slice(1) : s.history;
      const next = [...history, state];
      return { history: next, historyIndex: next.length - 1 };
    }),

  scrubTo: (index) => {
    const { history } = get();
    if (index < 0 || index >= history.length) return null;
    set({ historyIndex: index });
    return history[index]!;
  },

  clearHistory: () => set({ history: [], historyIndex: -1 }),

  saveSnapshot: (name, state) =>
    set((s) => ({
      snapshots: [...s.snapshots, { name, state, timestamp: Date.now() }],
    })),

  loadSnapshot: (index) => {
    const { snapshots } = get();
    return snapshots[index]?.state ?? null;
  },

  deleteSnapshot: (index) =>
    set((s) => ({ snapshots: s.snapshots.filter((_, i) => i !== index) })),
}));
