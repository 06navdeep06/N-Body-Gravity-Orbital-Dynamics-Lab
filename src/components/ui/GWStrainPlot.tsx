"use client";

/**
 * Live gravitational-wave strain trace: h₊ and h× against time, plus the
 * instantaneous frequency, amplitude and radiated power. As a binary
 * inspirals the trace chirps — frequency and amplitude both climb.
 *
 * Polls the shared `gwAnalyser` each animation frame (version-gated) rather
 * than re-rendering React on every sample.
 */

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { gwAnalyser } from "@/lib/physics/gravitational-waves";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const W = 320;
const H = 150;
const PAD_L = 34;
const PAD_B = 16;

function draw(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "rgba(6,8,16,0.95)";
  ctx.fillRect(0, 0, W, H);

  const samples = gwAnalyser.samples;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_B - 10;

  ctx.strokeStyle = "rgba(120,130,150,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD_L, 8, plotW, plotH);

  if (samples.length < 2) {
    ctx.fillStyle = "rgba(140,150,170,0.7)";
    ctx.font = "10px monospace";
    ctx.fillText("waiting for a binary source…", PAD_L + 10, H / 2);
    return;
  }

  let maxAbs = 0;
  for (const s of samples) {
    maxAbs = Math.max(maxAbs, Math.abs(s.hPlus), Math.abs(s.hCross));
  }
  if (maxAbs <= 0) maxAbs = 1;

  const toX = (i: number) => PAD_L + (i / (samples.length - 1)) * plotW;
  const toY = (h: number) => 8 + plotH / 2 - (h / maxAbs) * (plotH / 2) * 0.92;

  // Zero line.
  ctx.strokeStyle = "rgba(120,130,150,0.25)";
  ctx.beginPath();
  ctx.moveTo(PAD_L, toY(0));
  ctx.lineTo(W - 8, toY(0));
  ctx.stroke();

  const series: [string, (i: number) => number][] = [
    ["#7dd3fc", (i) => samples[i]!.hPlus],
    ["#f0abfc", (i) => samples[i]!.hCross],
  ];
  for (const [color, get] of series) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(get(0)));
    for (let i = 1; i < samples.length; i++) ctx.lineTo(toX(i), toY(get(i)));
    ctx.stroke();
  }

  ctx.font = "8px monospace";
  ctx.fillStyle = "rgba(170,180,200,0.9)";
  ctx.fillText(`+${maxAbs.toExponential(1)}`, 2, 14);
  ctx.fillText(`-${maxAbs.toExponential(1)}`, 2, H - PAD_B);
  ctx.fillStyle = "#7dd3fc";
  ctx.fillText("h+", PAD_L + 4, H - 4);
  ctx.fillStyle = "#f0abfc";
  ctx.fillText("h×", PAD_L + 24, H - 4);
  ctx.fillStyle = "rgba(170,180,200,0.9)";
  ctx.fillText("time →", W - 46, H - 4);
}

export function GWStrainPlot() {
  const show = useSimulationStore((s) => s.showGwStrain);
  const toggleShow = useSimulationStore((s) => s.toggleShowGwStrain);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<{
    frequency: number;
    amplitude: number;
    luminosity: number;
    separation: number;
  } | null>(null);

  useEffect(() => {
    if (!show) return;
    let raf = 0;
    let lastVersion = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (gwAnalyser.version === lastVersion) return;
      lastVersion = gwAnalyser.version;
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
      const latest = gwAnalyser.latest();
      setReadout(
        latest
          ? {
              frequency: latest.frequency,
              amplitude: Math.hypot(latest.hPlus, latest.hCross),
              luminosity: latest.luminosity,
              separation: latest.separation,
            }
          : null
      );
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show]);

  if (!show) return null;

  return (
    <div className="pointer-events-auto absolute right-2 top-56 z-20 w-[330px] max-w-[calc(100vw-1rem)] sm:right-4 rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
          GW Strain (quadrupole)
        </h3>
        <button onClick={toggleShow} className="text-zinc-500 hover:text-zinc-200">
          <X size={12} />
        </button>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="block" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-zinc-800 px-2.5 py-1.5 font-mono text-[10px]">
        <div className="flex justify-between">
          <span className="text-zinc-500">f_GW</span>
          <span>{readout ? readout.frequency.toPrecision(4) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">|h|</span>
          <span>{readout ? readout.amplitude.toExponential(2) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">P_GW</span>
          <span>{readout ? readout.luminosity.toExponential(2) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">sep</span>
          <span>{readout ? readout.separation.toPrecision(4) : "—"}</span>
        </div>
      </div>
    </div>
  );
}
