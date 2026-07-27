"use client";

/**
 * Procedural universe generator UI: galaxy and star-system tabs, seeded and
 * reproducible, with a top-down 2D preview rendered before committing the
 * result to the 3D simulation.
 *
 * The preview is deliberately generated on the same code path as the real
 * thing — it *is* the generated system, just projected — so what you preview
 * is exactly what you load.
 */

import { Dices, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SystemState } from "@/lib/physics/types";
import {
  DEFAULT_GALAXY_PARAMS,
  generateGalaxy,
  type GalaxyParams,
} from "@/lib/procedural/galaxy-generator";
import {
  DEFAULT_SOLAR_SYSTEM_PARAMS,
  generateSolarSystem,
  type SolarSystemParams,
} from "@/lib/procedural/solar-system-generator";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

const PREVIEW_W = 340;
const PREVIEW_H = 260;
/** Preview beyond this many bodies subsamples, to keep the canvas responsive. */
const PREVIEW_MAX_POINTS = 6000;

type Tab = "galaxy" | "system";

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = `proc-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
      <span className="text-zinc-400">
        {label}: <span className="font-mono text-zinc-200">{format ? format(value) : value}</span>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32"
      />
    </label>
  );
}

/** Top-down XZ projection, auto-scaled to fit, colored by body color. */
function drawPreview(canvas: HTMLCanvasElement, state: SystemState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#05060d";
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  const bodies = state.bodies;
  if (bodies.length === 0) return;

  let maxR = 0;
  for (const b of bodies) {
    const r = Math.hypot(b.position.x, b.position.z);
    if (r > maxR) maxR = r;
  }
  if (maxR <= 0) maxR = 1;

  const scale = (Math.min(PREVIEW_W, PREVIEW_H) / 2 - 8) / maxR;
  const cx = PREVIEW_W / 2;
  const cy = PREVIEW_H / 2;

  const stride = Math.max(1, Math.ceil(bodies.length / PREVIEW_MAX_POINTS));
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < bodies.length; i += stride) {
    const b = bodies[i]!;
    const x = cx + b.position.x * scale;
    const y = cy + b.position.z * scale;
    // Big bodies (stars, cores) get a visible disc; field stars a single px.
    const size = b.isFixed || b.radius > 1 ? 3 : 1;
    ctx.fillStyle = b.color;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(180,190,210,0.85)";
  ctx.font = "9px monospace";
  ctx.fillText(`${bodies.length.toLocaleString()} bodies · extent ${maxR.toFixed(0)}`, 6, PREVIEW_H - 6);
}

export function ProceduralPanel() {
  const open = useSimulationStore((s) => s.proceduralPanelOpen);
  const setOpen = useSimulationStore((s) => s.setProceduralPanelOpen);
  const setSystem = useSimulationStore((s) => s.setSystem);
  const pause = useSimulationStore((s) => s.pause);
  const clearTrails = useSimulationStore((s) => s.clearTrails);
  const clearHistory = useTimelineStore((s) => s.clearHistory);

  const [tab, setTab] = useState<Tab>("galaxy");
  const [galaxy, setGalaxy] = useState<GalaxyParams>({ ...DEFAULT_GALAXY_PARAMS, bodyCount: 3000 });
  const [system, setSystemParams] = useState<SolarSystemParams>(DEFAULT_SOLAR_SYSTEM_PARAMS);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Preview is generated from the same functions the Generate button uses.
  const preview = useMemo<SystemState | null>(() => {
    if (!open) return null;
    return tab === "galaxy"
      ? generateGalaxy({ ...galaxy, bodyCount: Math.min(galaxy.bodyCount, 12000) })
      : generateSolarSystem(system);
  }, [open, tab, galaxy, system]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && preview) drawPreview(canvas, preview);
  }, [preview]);

  if (!open) return null;

  const handleGenerate = () => {
    const state = tab === "galaxy" ? generateGalaxy(galaxy) : generateSolarSystem(system);
    pause();
    setSystem(state);
    clearTrails();
    clearHistory();
    setOpen(false);
  };

  const randomizeSeed = () => {
    const seed = Math.floor(Math.random() * 0xffffffff);
    if (tab === "galaxy") setGalaxy({ ...galaxy, seed });
    else setSystemParams({ ...system, seed });
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Procedural universe generator"
    >
      <div className="flex max-h-full w-full max-w-3xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 p-3">
          <div className="flex items-center gap-1">
            {(["galaxy", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium ${
                  tab === t ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t === "galaxy" ? "Galaxy" : "Star System"}
              </button>
            ))}
          </div>

          {tab === "galaxy" ? (
            <>
              <Slider
                label="Bodies"
                value={galaxy.bodyCount}
                min={1000}
                max={50000}
                step={500}
                onChange={(v) => setGalaxy({ ...galaxy, bodyCount: v })}
                format={(v) => v.toLocaleString()}
              />
              <Slider label="Arms" value={galaxy.armCount} min={2} max={6} onChange={(v) => setGalaxy({ ...galaxy, armCount: v })} />
              <Slider
                label="Arm tightness"
                value={galaxy.armTightness}
                min={0.12}
                max={0.6}
                step={0.01}
                onChange={(v) => setGalaxy({ ...galaxy, armTightness: v })}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label="Bulge fraction"
                value={galaxy.bulgeFraction}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(v) => setGalaxy({ ...galaxy, bulgeFraction: v })}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label="Flat rotation v"
                value={galaxy.flatVelocity}
                min={4}
                max={40}
                step={0.5}
                onChange={(v) => setGalaxy({ ...galaxy, flatVelocity: v })}
                format={(v) => v.toFixed(1)}
              />
              <Slider
                label="Disk scale"
                value={galaxy.diskScaleLength}
                min={8}
                max={60}
                onChange={(v) => setGalaxy({ ...galaxy, diskScaleLength: v })}
              />
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Velocities follow a flat rotation curve rather than Keplerian falloff — the
                observational signature of a dark-matter halo. The halo itself is not simulated,
                so the disk will relax over time.
              </p>
            </>
          ) : (
            <>
              <Slider
                label="Star mass min"
                value={system.starMassMin}
                min={0.1}
                max={5}
                step={0.1}
                onChange={(v) => setSystemParams({ ...system, starMassMin: Math.min(v, system.starMassMax) })}
                format={(v) => `${v.toFixed(1)} M☉`}
              />
              <Slider
                label="Star mass max"
                value={system.starMassMax}
                min={1}
                max={30}
                step={0.5}
                onChange={(v) => setSystemParams({ ...system, starMassMax: Math.max(v, system.starMassMin) })}
                format={(v) => `${v.toFixed(1)} M☉`}
              />
              <Slider label="Planets min" value={system.planetCountMin} min={1} max={12} onChange={(v) => setSystemParams({ ...system, planetCountMin: Math.min(v, system.planetCountMax) })} />
              <Slider label="Planets max" value={system.planetCountMax} min={2} max={16} onChange={(v) => setSystemParams({ ...system, planetCountMax: Math.max(v, system.planetCountMin) })} />
              <Slider
                label="Moon chance"
                value={system.moonProbability}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setSystemParams({ ...system, moonProbability: v })}
                format={(v) => `${(v * 100).toFixed(0)}%`}
              />
              <label className="flex items-center justify-between text-[11px] text-zinc-300">
                <span className="text-zinc-400">Asteroid belt</span>
                <input
                  type="checkbox"
                  checked={system.includeAsteroidBelt}
                  onChange={(e) => setSystemParams({ ...system, includeAsteroidBelt: e.target.checked })}
                />
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Orbits use Titius-Bode-like geometric spacing with Rayleigh-distributed
                eccentricities and inclinations. Moons are confined to a third of their planet&apos;s
                Hill radius, beyond which they would not be stable.
              </p>
            </>
          )}

          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
            <span className="text-zinc-400">Seed</span>
            <input
              type="number"
              value={tab === "galaxy" ? galaxy.seed : system.seed}
              onChange={(e) => {
                const seed = Number(e.target.value);
                if (tab === "galaxy") setGalaxy({ ...galaxy, seed });
                else setSystemParams({ ...system, seed });
              }}
              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-right font-mono text-[11px]"
            />
          </label>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <h3 className="text-sm font-semibold text-zinc-100">Procedural Universe</h3>
            <button onClick={() => setOpen(false)} aria-label="Close generator" className="text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center p-4">
            <canvas
              ref={canvasRef}
              width={PREVIEW_W}
              height={PREVIEW_H}
              className="rounded border border-zinc-800"
              aria-label="Top-down preview of the generated system"
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-3 py-2">
            <span className="font-mono text-[10px] text-zinc-500">
              {preview ? `${preview.bodies.length.toLocaleString()} bodies` : "—"}
              {tab === "galaxy" && galaxy.bodyCount > 12000 && " (preview subsampled)"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={randomizeSeed}
                className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                <Shuffle size={12} />
                Randomize
              </button>
              <button
                onClick={handleGenerate}
                className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
              >
                <Dices size={12} />
                Generate
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
