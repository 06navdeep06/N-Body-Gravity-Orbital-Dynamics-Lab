"use client";

/**
 * Lists detected mean-motion resonances and, for populations large enough to
 * be a belt, draws a semi-major-axis histogram with the strong resonance
 * locations marked — the Kirkwood-gap picture. Bars at a depleted resonance
 * are tinted red.
 */

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import {
  analyzeKirkwoodGaps,
  detectResonances,
  type KirkwoodAnalysis,
  type ResonancePair,
} from "@/lib/physics/resonance";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const REFRESH_MS = 800;
const W = 300;
const H = 130;
const PAD_L = 26;
const PAD_B = 22;

function drawHistogram(canvas: HTMLCanvasElement, analysis: KirkwoodAnalysis): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(8,10,20,0.9)";
  ctx.fillRect(0, 0, W, H);

  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_B - 10;
  const maxCount = Math.max(1, ...analysis.bins.map((b) => b.count));
  const span = analysis.maxA - analysis.minA || 1;
  const toX = (a: number) => PAD_L + ((a - analysis.minA) / span) * plotW;

  // Which bins sit under a depleted resonance (tinted red).
  const depletedAxes = analysis.resonances.filter((r) => r.depleted).map((r) => r.semiMajorAxis);
  const binWidthValue = span / analysis.bins.length;

  const barW = Math.max(1, plotW / analysis.bins.length - 1);
  for (const bin of analysis.bins) {
    const h = (bin.count / maxCount) * plotH;
    const nearDepleted = depletedAxes.some((a) => Math.abs(a - bin.center) < binWidthValue * 1.5);
    ctx.fillStyle = nearDepleted ? "rgba(248,113,113,0.85)" : "rgba(125,211,252,0.75)";
    ctx.fillRect(toX(bin.center) - barW / 2, H - PAD_B - h, barW, h);
  }

  // Resonance markers.
  ctx.font = "8px monospace";
  for (const res of analysis.resonances) {
    const x = toX(res.semiMajorAxis);
    ctx.strokeStyle = res.depleted ? "rgba(248,113,113,0.95)" : "rgba(250,204,21,0.6)";
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x, H - PAD_B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = res.depleted ? "#fca5a5" : "#fde68a";
    ctx.fillText(res.label, x - 7, 8);
  }

  // Axes.
  ctx.strokeStyle = "rgba(140,150,170,0.5)";
  ctx.beginPath();
  ctx.moveTo(PAD_L, 10);
  ctx.lineTo(PAD_L, H - PAD_B);
  ctx.lineTo(W - 8, H - PAD_B);
  ctx.stroke();

  ctx.fillStyle = "rgba(170,180,200,0.9)";
  ctx.font = "8px monospace";
  ctx.fillText(analysis.minA.toFixed(1), PAD_L - 4, H - PAD_B + 11);
  ctx.fillText(analysis.maxA.toFixed(1), W - 32, H - PAD_B + 11);
  ctx.fillText(`a (vs ${analysis.perturberName})`, PAD_L + plotW / 2 - 34, H - 4);
  ctx.save();
  ctx.translate(9, H / 2 + 12);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("count", 0, 0);
  ctx.restore();
}

export function ResonancePanel() {
  const show = useSimulationStore((s) => s.showResonances);
  const toggleShow = useSimulationStore((s) => s.toggleShowResonances);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pairs, setPairs] = useState<ResonancePair[]>([]);
  const [analysis, setAnalysis] = useState<KirkwoodAnalysis | null>(null);
  const [nameById, setNameById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!show) return;
    const refresh = () => {
      const { system } = useSimulationStore.getState();
      const primary = inferPrimaryBody(system.bodies);
      if (!primary) {
        setPairs([]);
        setAnalysis(null);
        return;
      }
      setPairs(detectResonances(system.bodies, primary, system.G).slice(0, 12));
      setAnalysis(analyzeKirkwoodGaps(system.bodies, primary, system.G));
      setNameById(Object.fromEntries(system.bodies.map((b) => [b.id, b.name])));
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [show]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && analysis) drawHistogram(canvas, analysis);
  }, [analysis]);

  if (!show) return null;

  return (
    <div className="pointer-events-auto absolute bottom-20 left-2 z-20 w-[316px] max-w-[calc(100vw-1rem)] sm:bottom-16 sm:left-4 rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
          Orbital Resonances
        </h3>
        <button onClick={toggleShow} className="text-zinc-500 hover:text-zinc-200">
          <X size={12} />
        </button>
      </div>

      <div className="max-h-40 overflow-y-auto px-2.5 py-2">
        {pairs.length === 0 ? (
          <p className="text-[10px] text-zinc-500">
            No mean-motion resonances detected (within {(0.02 * 100).toFixed(0)}% of a p:q ratio,
            p,q ≤ 7).
          </p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left font-normal">Ratio</th>
                <th className="text-left font-normal">Bodies</th>
                <th className="text-right font-normal">Strength</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {pairs.map((p) => (
                <tr key={`${p.bodyA}-${p.bodyB}`} className="text-zinc-300">
                  <td className="py-0.5 text-amber-300">
                    {p.ratio[0]}:{p.ratio[1]}
                  </td>
                  <td className="truncate py-0.5" title={`${nameById[p.bodyA]} ↔ ${nameById[p.bodyB]}`}>
                    {nameById[p.bodyA] ?? p.bodyA} ↔ {nameById[p.bodyB] ?? p.bodyB}
                  </td>
                  <td className="py-0.5 text-right">{p.strength.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {analysis && (
        <div className="border-t border-zinc-800 px-2.5 pb-2 pt-1.5">
          <div className="mb-1 text-[10px] text-zinc-400">
            Kirkwood gaps — depleted resonances in red
          </div>
          <canvas ref={canvasRef} width={W} height={H} className="block" />
        </div>
      )}
    </div>
  );
}
