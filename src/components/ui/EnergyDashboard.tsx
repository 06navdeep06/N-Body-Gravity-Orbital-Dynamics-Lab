"use client";

import { useSimulationStore } from "@/lib/stores/simulation-store";
import { PhysicsTooltip } from "./PhysicsTooltips";

function magnitude(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function EnergyDashboard() {
  const metrics = useSimulationStore((s) => s.energyMetrics);
  const fps = useSimulationStore((s) => s.fps);
  const workerStepMs = useSimulationStore((s) => s.workerStepMs);
  const bodyCount = useSimulationStore((s) => s.system.bodies.length);
  const collisionEvents = useSimulationStore((s) => s.collisionEvents);

  const fpsColor = fps >= 55 ? "text-emerald-400" : fps >= 30 ? "text-amber-400" : "text-red-400";

  return (
    <div className="absolute right-4 top-4 w-64 rounded-lg border border-zinc-800 bg-zinc-950/85 p-3 font-mono text-[11px] text-zinc-200 backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <PhysicsTooltip term="fps">
          <span className="text-zinc-500">FPS</span>
        </PhysicsTooltip>
        <span className={fpsColor}>{fps.toFixed(0)}</span>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <PhysicsTooltip term="workerStepMs">
          <span className="text-zinc-500">Worker step</span>
        </PhysicsTooltip>
        <span>{workerStepMs.toFixed(2)} ms</span>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-zinc-500">Bodies</span>
        <span>{bodyCount}</span>
      </div>

      {metrics && (
        <div className="space-y-0.5 border-t border-zinc-800 pt-2">
          <div className="flex items-center justify-between">
            <PhysicsTooltip term="kineticEnergy">
              <span className="text-zinc-500">Kinetic</span>
            </PhysicsTooltip>
            <span>{metrics.kineticEnergy.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between">
            <PhysicsTooltip term="potentialEnergy">
              <span className="text-zinc-500">Potential</span>
            </PhysicsTooltip>
            <span>{metrics.potentialEnergy.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between">
            <PhysicsTooltip term="totalEnergy">
              <span className="text-zinc-500">Total</span>
            </PhysicsTooltip>
            <span className={metrics.totalEnergy < 0 ? "text-sky-300" : "text-orange-300"}>
              {metrics.totalEnergy.toFixed(3)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <PhysicsTooltip term="angularMomentum">
              <span className="text-zinc-500">|Angular momentum|</span>
            </PhysicsTooltip>
            <span>{magnitude(metrics.angularMomentum).toFixed(3)}</span>
          </div>
        </div>
      )}

      {collisionEvents.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-zinc-800 pt-2">
          <div className="text-zinc-500">Recent collisions</div>
          {collisionEvents.slice(0, 4).map((c, i) => (
            <div key={`${c.timestamp}-${i}`} className="text-amber-300">
              {c.bodyA} + {c.bodyB} → {c.mergedBody.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
