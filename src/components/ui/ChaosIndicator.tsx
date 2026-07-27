"use client";

/**
 * Lyapunov-exponent readout for the selected body, shown inside the body
 * inspector. Measurement is on demand (it costs 2× the sim's integration
 * work for a few thousand steps) rather than continuous.
 */

import { Activity, Loader2 } from "lucide-react";
import { requestLyapunov } from "@/hooks/useAnalysisWorker";
import { useAnalysisStore } from "@/lib/stores/analysis-store";

const CLASSIFICATION_STYLE = {
  regular: { color: "#4ade80", label: "Regular / quasi-periodic" },
  "weakly-chaotic": { color: "#facc15", label: "Weakly chaotic" },
  "strongly-chaotic": { color: "#f87171", label: "Strongly chaotic" },
} as const;

export function ChaosIndicator({ bodyId }: { bodyId: string }) {
  const result = useAnalysisStore((s) => s.lyapunov[bodyId]);
  const pending = useAnalysisStore((s) => s.lyapunovPending === bodyId);

  return (
    <section className="space-y-1.5 border-t border-zinc-800 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Chaos (Lyapunov)
        </h3>
        <button
          onClick={() => requestLyapunov(bodyId)}
          disabled={pending}
          title="Perturb this body by 1e-8 and measure how fast the perturbed trajectory diverges. Runs in a background worker."
          className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? <Loader2 size={10} className="animate-spin" /> : <Activity size={10} />}
          {pending ? "measuring…" : "Measure"}
        </button>
      </div>

      {result === undefined && !pending && (
        <p className="text-[10px] text-zinc-500">
          Not measured yet — λ &gt; 0 means neighbouring orbits diverge exponentially (chaos).
        </p>
      )}

      {result === null && (
        <p className="text-[10px] text-zinc-500">
          Not measurable for this body (it is pinned, or the run ended early via a collision).
        </p>
      )}

      {result && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span
              className="text-zinc-500"
              title="Rate measured over the second half of the run. Preferred over the whole-window average because the early transient (the perturbation rotating onto the unstable direction) inflates it."
            >
              λ (late window)
            </span>
            <span
              className="font-mono font-semibold"
              style={{ color: CLASSIFICATION_STYLE[result.classification].color }}
            >
              {result.lateExponent.toExponential(3)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-600">λ (full window)</span>
            <span className="font-mono text-zinc-500">{result.exponent.toExponential(3)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: CLASSIFICATION_STYLE[result.classification].color }}
            />
            <span className="text-[10px] text-zinc-400">
              {CLASSIFICATION_STYLE[result.classification].label}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span
              className="text-zinc-500"
              title="1/λ — the timescale over which a small uncertainty grows by e, i.e. how far ahead prediction stays meaningful."
            >
              Predictability t=1/λ
            </span>
            <span className="font-mono text-zinc-200">
              {Number.isFinite(result.lyapunovTime) ? result.lyapunovTime.toPrecision(4) : "∞"}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span title="Window is auto-sized to ~24 orbits of this body: chaos is only meaningful over many dynamical times.">
              integrated
            </span>
            <span className="font-mono">
              t={result.elapsedTime.toPrecision(3)} · {result.renormalizations} renorms
            </span>
          </div>
        </>
      )}
    </section>
  );
}
