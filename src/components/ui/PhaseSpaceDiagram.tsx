"use client";

/**
 * Real-time Poincaré section / phase-space plot, drawn on a plain 2D
 * canvas that polls the shared `poincareRecorder` every animation frame
 * (no React re-renders in the draw path). Draggable by its title bar.
 *
 * Tabs:
 *  - "Poincaré": one dot per section crossing (r vs v_r). Regular orbits
 *    trace closed curves; chaos fills regions.
 *  - "Phase": continuous (r, r-dot) trajectory per body.
 */

import { Eraser, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { poincareRecorder, type SectionMode } from "@/lib/physics/poincare";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const W = 320;
const H = 240;
const PAD = 30;

type Tab = "poincare" | "phase";

function drawDiagram(canvas: HTMLCanvasElement, tab: Tab): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "rgba(6,8,16,0.95)";
  ctx.fillRect(0, 0, W, H);

  const entries = poincareRecorder.entries();

  // Common bounds across all bodies for a shared axis.
  let rMin = Infinity, rMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [, buffers] of entries) {
    const pts = tab === "poincare" ? buffers.section : buffers.phase;
    for (const p of pts) {
      if (p.r < rMin) rMin = p.r;
      if (p.r > rMax) rMax = p.r;
      if (p.vr < vMin) vMin = p.vr;
      if (p.vr > vMax) vMax = p.vr;
    }
  }

  ctx.strokeStyle = "rgba(120,130,150,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD, 8, W - PAD - 8, H - PAD - 8);

  ctx.fillStyle = "rgba(160,170,190,0.9)";
  ctx.font = "9px monospace";
  ctx.fillText("v_r", 4, 14);
  ctx.fillText("r", W - 12, H - 8);

  if (!Number.isFinite(rMin) || rMax - rMin < 1e-12) {
    ctx.fillStyle = "rgba(140,150,170,0.7)";
    ctx.font = "10px monospace";
    ctx.fillText(
      tab === "poincare" ? "waiting for section crossings…" : "waiting for trajectory…",
      PAD + 12,
      H / 2
    );
    return;
  }

  const rPadding = (rMax - rMin) * 0.08 || 0.1;
  const vPadding = (vMax - vMin) * 0.08 || 0.1;
  rMin -= rPadding; rMax += rPadding;
  vMin -= vPadding; vMax += vPadding;

  const toX = (r: number) => PAD + ((r - rMin) / (rMax - rMin)) * (W - PAD - 8);
  const mapY = (v: number) => 8 + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD - 8);

  // v_r = 0 axis line.
  if (vMin < 0 && vMax > 0) {
    ctx.strokeStyle = "rgba(120,130,150,0.25)";
    ctx.beginPath();
    ctx.moveTo(PAD, mapY(0));
    ctx.lineTo(W - 8, mapY(0));
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(160,170,190,0.9)";
  ctx.font = "8px monospace";
  ctx.fillText(rMin.toFixed(2), PAD, H - 12);
  ctx.fillText(rMax.toFixed(2), W - 44, H - 12);
  ctx.fillText(vMax.toFixed(2), 2, 24);
  ctx.fillText(vMin.toFixed(2), 2, H - PAD);

  for (const [, buffers] of entries) {
    if (tab === "poincare") {
      ctx.fillStyle = buffers.color;
      for (const p of buffers.section) {
        ctx.fillRect(toX(p.r) - 1, mapY(p.vr) - 1, 2, 2);
      }
    } else {
      const pts = buffers.phase;
      if (pts.length < 2) continue;
      ctx.strokeStyle = buffers.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(toX(pts[0]!.r), mapY(pts[0]!.vr));
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(toX(pts[i]!.r), mapY(pts[i]!.vr));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

export function PhaseSpaceDiagram() {
  const show = useSimulationStore((s) => s.showPhaseSpace);
  const toggleShow = useSimulationStore((s) => s.toggleShowPhaseSpace);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<Tab>("poincare");
  const [mode, setMode] = useState<SectionMode>("x-axis");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    if (!show) return;
    let raf = 0;
    let lastVersion = -1;
    let lastTab: Tab | null = null;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (poincareRecorder.version === lastVersion && tab === lastTab) return;
      lastVersion = poincareRecorder.version;
      lastTab = tab;
      drawDiagram(canvas, tab);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show, tab]);

  useEffect(() => {
    poincareRecorder.setMode(mode);
  }, [mode]);

  if (!show) return null;

  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.baseX + e.clientX - d.startX, y: d.baseY + e.clientY - d.startY });
  };
  const onDragEnd = () => {
    dragRef.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-20 right-2 z-20 max-w-[calc(100vw-1rem)] rounded-lg sm:bottom-16 sm:right-4 border border-zinc-700 bg-zinc-950/95 shadow-xl"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 border-b border-zinc-800 px-2 py-1.5"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <div className="flex items-center gap-1">
          {(["poincare", "phase"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                tab === t ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "poincare" ? "Poincaré" : "Phase"}
            </button>
          ))}
          {tab === "poincare" && (
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SectionMode)}
              className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[9px] text-zinc-300"
              title="Section surface. +X axis crossing works for coplanar orbits; y=0 plane needs 3D orbits."
            >
              <option value="x-axis">+X axis section</option>
              <option value="y-plane">y=0 plane section</option>
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => poincareRecorder.clear()}
            title="Clear recorded points"
            className="text-zinc-500 hover:text-zinc-200"
          >
            <Eraser size={12} />
          </button>
          <button onClick={toggleShow} className="text-zinc-500 hover:text-zinc-200">
            <X size={12} />
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="block" />
    </div>
  );
}
