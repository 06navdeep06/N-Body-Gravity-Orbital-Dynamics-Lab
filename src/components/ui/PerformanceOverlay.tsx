"use client";

/**
 * Developer performance overlay, toggled with Ctrl+Shift+P.
 *
 * Polls the profiler singleton on an interval instead of subscribing to
 * per-frame state — a 60 Hz React update would itself distort what it's
 * measuring.
 */

import { useEffect, useState } from "react";
import { profiler, type FrameBudget, type QualityTier } from "@/lib/performance/profiler";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const POLL_MS = 250;

const TIER_COLOR: Record<QualityTier, string> = {
  high: "#4ade80",
  medium: "#facc15",
  low: "#f87171",
};

function BudgetBar({ budget }: { budget: FrameBudget }) {
  const total = budget.total || 1;
  const segments: [string, number, string][] = [
    ["physics", budget.physics, "#7dd3fc"],
    ["render", budget.render, "#c4b5fd"],
    ["ui", budget.ui, "#fbbf24"],
    ["idle", budget.idle, "#3f3f46"],
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded bg-zinc-900">
        {segments.map(([label, value, color]) => (
          <div
            key={label}
            style={{ width: `${Math.max(0, (value / total) * 100)}%`, backgroundColor: color }}
            title={`${label}: ${value.toFixed(2)} ms`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[9px] text-zinc-500">
        {segments.map(([label, value, color]) => (
          <span key={label}>
            <span style={{ color }}>■</span> {label} {value.toFixed(1)}ms
          </span>
        ))}
      </div>
    </div>
  );
}

export function PerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [, setTick] = useState(0);
  const bodyCount = useSimulationStore((s) => s.system.bodies.length);
  const activeBackend = useSimulationStore((s) => s.activeBackend);
  const fps = useSimulationStore((s) => s.fps);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const { budget, renderStats, heapBytes, quality, lastQualityChange } = profiler;
  const heapMb = heapBytes > 0 ? (heapBytes / 1024 / 1024).toFixed(0) : null;

  return (
    <div
      className="pointer-events-auto absolute bottom-20 left-1/2 z-30 w-72 max-w-[calc(100vw-1rem)] sm:bottom-16 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 font-mono text-[10px] text-zinc-200 shadow-xl"
      role="complementary"
      aria-label="Performance profiler"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wide text-zinc-300">Profiler</span>
        <button
          onClick={() => setVisible(false)}
          aria-label="Close profiler"
          className="text-zinc-500 hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div className="flex justify-between">
          <span className="text-zinc-500">FPS (60f)</span>
          <span className={fps >= 55 ? "text-emerald-400" : fps >= 30 ? "text-amber-400" : "text-red-400"}>
            {fps.toFixed(0)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">frame</span>
          <span>{budget.total.toFixed(1)}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">bodies</span>
          <span>{bodyCount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">backend</span>
          <span>{activeBackend === "gpu-webgpu" ? "GPU" : "CPU"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">draws</span>
          <span>{renderStats.drawCalls}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">tris</span>
          <span>{renderStats.triangles.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">heap</span>
          {/* performance.memory is Chrome-only — say so rather than show 0. */}
          <span>{heapMb ? `${heapMb} MB` : "n/a"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">quality</span>
          <span style={{ color: TIER_COLOR[quality] }}>{quality}</span>
        </div>
      </div>

      <BudgetBar budget={budget} />

      {lastQualityChange && (
        <p className="mt-2 text-[9px] leading-snug text-zinc-500">
          last change → <span style={{ color: TIER_COLOR[lastQualityChange.tier] }}>{lastQualityChange.tier}</span>:{" "}
          {lastQualityChange.reason}
        </p>
      )}

      <div className="mt-2 flex gap-1">
        {(["high", "medium", "low"] as const).map((tier) => (
          <button
            key={tier}
            onClick={() => profiler.forceQuality(tier)}
            className={`flex-1 rounded px-1 py-0.5 text-[9px] ${
              quality === tier ? "bg-zinc-700 text-zinc-100" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {tier}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[9px] text-zinc-600">Ctrl+Shift+P to toggle</p>
    </div>
  );
}
