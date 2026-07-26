"use client";

import { Bookmark, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

export function TimelineBar() {
  const history = useTimelineStore((s) => s.history);
  const historyIndex = useTimelineStore((s) => s.historyIndex);
  const scrubTo = useTimelineStore((s) => s.scrubTo);
  const snapshots = useTimelineStore((s) => s.snapshots);
  const saveSnapshot = useTimelineStore((s) => s.saveSnapshot);
  const loadSnapshot = useTimelineStore((s) => s.loadSnapshot);
  const deleteSnapshot = useTimelineStore((s) => s.deleteSnapshot);

  const isRunning = useSimulationStore((s) => s.isRunning);
  const play = useSimulationStore((s) => s.play);
  const pause = useSimulationStore((s) => s.pause);
  const system = useSimulationStore((s) => s.system);
  const setSystem = useSimulationStore((s) => s.setSystem);

  const [showSnapshots, setShowSnapshots] = useState(false);

  const handleScrub = (index: number) => {
    pause();
    const state = scrubTo(index);
    if (state) setSystem(state);
  };

  const handleSaveSnapshot = () => {
    const name = window.prompt("Snapshot name", `Snapshot ${snapshots.length + 1}`);
    if (name) saveSnapshot(name, system);
  };

  const handleLoadSnapshot = (index: number) => {
    const state = loadSnapshot(index);
    if (state) {
      pause();
      setSystem(state);
    }
    setShowSnapshots(false);
  };

  const isLive = history.length === 0 || historyIndex >= history.length - 1;

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/90 px-4 py-2 text-zinc-100 backdrop-blur">
      <button
        onClick={() => (isRunning ? pause() : play())}
        className="flex items-center justify-center rounded-md bg-zinc-800 p-2 hover:bg-zinc-700"
        title={isRunning ? "Pause" : "Play"}
      >
        {isRunning ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0, history.length - 1)}
        value={Math.max(0, historyIndex)}
        disabled={history.length === 0}
        onChange={(e) => handleScrub(Number(e.target.value))}
        className="flex-1 accent-sky-500"
      />

      <span className="w-28 shrink-0 text-right font-mono text-[11px] text-zinc-400">
        {history.length === 0
          ? "no history"
          : `${historyIndex + 1}/${history.length}${isLive ? " (live)" : ""}`}
      </span>

      <div className="relative">
        <button
          onClick={handleSaveSnapshot}
          className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-2 text-[11px] hover:bg-zinc-700"
          title="Save current state as a snapshot"
        >
          <Bookmark size={14} />
          Save
        </button>
      </div>

      <div className="relative">
        <button
          onClick={() => setShowSnapshots((v) => !v)}
          className="rounded-md bg-zinc-800 px-2 py-2 text-[11px] hover:bg-zinc-700"
        >
          Snapshots ({snapshots.length})
        </button>
        {showSnapshots && (
          <div className="absolute bottom-full right-0 mb-2 max-h-56 w-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-1 shadow-xl">
            {snapshots.length === 0 && (
              <p className="p-2 text-[11px] text-zinc-500">No snapshots saved yet.</p>
            )}
            {snapshots.map((snap, i) => (
              <div
                key={`${snap.name}-${snap.timestamp}`}
                className="flex items-center justify-between gap-1 rounded px-2 py-1.5 text-[11px] hover:bg-zinc-800"
              >
                <button onClick={() => handleLoadSnapshot(i)} className="flex-1 text-left">
                  {snap.name}
                  <div className="text-[9px] text-zinc-500">
                    {new Date(snap.timestamp).toLocaleTimeString()}
                  </div>
                </button>
                <button onClick={() => deleteSnapshot(i)} className="text-zinc-500 hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
