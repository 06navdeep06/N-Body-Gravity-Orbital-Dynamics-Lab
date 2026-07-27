"use client";

/**
 * Training telemetry for the in-browser orbit predictor.
 *
 * Deliberately honest about what the numbers mean: loss and RMSE are in the
 * model's *normalized* units (positions scaled by semi-major axis), so they
 * are comparable across presets but are not distances in simulation units.
 */

import { Brain, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { orbitPredictor, REPLAY_CAPACITY, type MlStats } from "@/lib/ml/orbit-predictor";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const POLL_MS = 500;

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-center justify-between" title={title}>
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}

export function MLDashboard() {
  const show = useSimulationStore((s) => s.showMlPredictions);
  const toggle = useSimulationStore((s) => s.toggleShowMlPredictions);
  const [stats, setStats] = useState<MlStats | null>(null);

  useEffect(() => {
    if (!show) return;
    const poll = () => setStats(orbitPredictor.stats());
    // Deferred rather than called inline — a synchronous setState in an
    // effect body triggers a cascading re-render.
    const initial = setTimeout(poll, 0);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [show]);

  if (!show) return null;

  const fill = stats ? Math.min(100, (stats.samples / REPLAY_CAPACITY) * 100) : 0;

  return (
    <div className="pointer-events-auto absolute bottom-16 right-4 z-20 w-64 rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
          <Brain size={12} />
          ML Predictor
        </h3>
        <button onClick={toggle} aria-label="Close ML dashboard" className="text-zinc-500 hover:text-zinc-200">
          <X size={12} />
        </button>
      </div>

      <div className="space-y-1 px-2.5 py-2 text-[10px]">
        {!stats || !stats.ready ? (
          <p className="text-zinc-500">Loading TensorFlow.js…</p>
        ) : (
          <>
            <Stat label="backend" value={stats.backend ?? "—"} />
            <Stat label="parameters" value={stats.parameters.toLocaleString()} />
            <Stat
              label="samples"
              value={`${stats.samples.toLocaleString()} / ${REPLAY_CAPACITY.toLocaleString()}`}
              title="Replay buffer occupancy. Training starts once a full batch (256) is available."
            />
            <div className="h-1 w-full overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-violet-500" style={{ width: `${fill}%` }} />
            </div>
            <Stat label="train steps" value={stats.trainSteps.toLocaleString()} />
            <Stat
              label="loss (MSE)"
              value={stats.loss !== null ? stats.loss.toExponential(3) : "—"}
              title="Rolling mean of the last 50 batch losses, in normalized units."
            />
            <Stat
              label="RMSE"
              value={stats.rmse !== null ? stats.rmse.toExponential(3) : "—"}
              title="Root of the batch MSE, in units of the orbit's semi-major axis — not simulation distance."
            />
          </>
        )}
      </div>

      <div className="border-t border-zinc-800 px-2.5 py-1.5">
        <button
          onClick={() => orbitPredictor.reset()}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 py-1 text-[10px] text-zinc-200 hover:bg-zinc-700"
        >
          <RotateCcw size={10} />
          Reset model
        </button>
        <p className="mt-1.5 text-[9px] leading-snug text-zinc-600">
          A 3×128 MLP learning the propagator online. It will not beat RK4 — the value is seeing
          where a learned model diverges from the analytic and simulated paths.
        </p>
      </div>
    </div>
  );
}
