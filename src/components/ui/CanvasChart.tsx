"use client";

/**
 * Minimal canvas charting primitive — line, scatter, histogram and heatmap —
 * built from scratch rather than pulling in a charting library, so the
 * dashboard adds no bundle weight and can stream points without a full
 * React re-render.
 *
 * Drawing is imperative and driven by a version counter the caller bumps,
 * so a 10k-point series redraws on demand rather than every frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ChartKind = "line" | "scatter" | "histogram" | "heatmap";

export interface ChartSeries {
  label: string;
  color: string;
  points: { x: number; y: number; flagged?: boolean }[];
  /** Dash pattern, so series stay distinguishable without relying on color. */
  dash?: number[];
  /**
   * Overrides the chart's kind for this series only. Needed for analytic
   * overlays on a histogram — e.g. a Maxwell-Boltzmann fit must draw as a
   * line *over* the bars, not as a second set of bars hiding them.
   */
  renderAs?: ChartKind;
}

export interface CanvasChartProps {
  kind: ChartKind;
  series: ChartSeries[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  /** Bump to trigger a redraw. */
  version?: number;
  /** Forces the y-axis to include zero (useful for energy plots). */
  includeZero?: boolean;
  /** Renders y on a log10 axis. */
  logY?: boolean;
  /** Highlight color for points flagged by the data source. */
  flagColor?: string;
  emptyMessage?: string;
}

const PAD_L = 46;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 28;

interface Viewport {
  /** Horizontal zoom factor and pan offset, in data units. */
  zoom: number;
  panX: number;
}

function niceTick(span: number): number {
  if (span <= 0) return 1;
  const raw = span / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return step * magnitude;
}

function formatTick(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
}

export function CanvasChart({
  kind,
  series,
  width = 420,
  height = 200,
  xLabel,
  yLabel,
  version = 0,
  includeZero = false,
  logY = false,
  flagColor = "#f87171",
  emptyMessage = "no data yet",
}: CanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0 });
  const dragRef = useRef<{ startX: number; basePan: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(6,8,16,0.96)";
    ctx.fillRect(0, 0, width, height);

    const plotW = width - PAD_L - PAD_R;
    const plotH = height - PAD_T - PAD_B;

    const allPoints = series.flatMap((s) => s.points);
    if (allPoints.length === 0) {
      ctx.fillStyle = "rgba(140,150,170,0.7)";
      ctx.font = "10px monospace";
      ctx.fillText(emptyMessage, PAD_L + 8, height / 2);
      return;
    }

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of allPoints) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      const y = logY ? (p.y > 0 ? Math.log10(p.y) : NaN) : p.y;
      if (Number.isFinite(y)) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (includeZero && !logY) {
      yMin = Math.min(yMin, 0);
      yMax = Math.max(yMax, 0);
    }

    // Apply zoom/pan to the x window only — the y axis stays auto-scaled.
    const xSpanFull = xMax - xMin || 1;
    const xSpan = xSpanFull / viewport.zoom;
    const xCenter = (xMin + xMax) / 2 + viewport.panX;
    let xLo = xCenter - xSpan / 2;
    let xHi = xCenter + xSpan / 2;
    if (kind === "histogram") {
      xLo = xMin;
      xHi = xMax;
    }

    const ySpan = yMax - yMin || 1;
    const yPad = ySpan * 0.08;
    const yLo = yMin - yPad;
    const yHi = yMax + yPad;

    const toX = (x: number) => PAD_L + ((x - xLo) / (xHi - xLo || 1)) * plotW;
    const toY = (y: number) => {
      const v = logY ? (y > 0 ? Math.log10(y) : yLo) : y;
      return PAD_T + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;
    };

    // --- grid + axes ------------------------------------------------------
    ctx.strokeStyle = "rgba(120,130,150,0.14)";
    ctx.lineWidth = 1;
    const yStep = niceTick(yHi - yLo);
    ctx.font = "8px monospace";
    for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi; v += yStep) {
      const y = PAD_T + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(width - PAD_R, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(160,170,190,0.85)";
      ctx.fillText(formatTick(logY ? Math.pow(10, v) : v), 2, y + 3);
    }

    const xStep = niceTick(xHi - xLo);
    for (let v = Math.ceil(xLo / xStep) * xStep; v <= xHi; v += xStep) {
      const x = toX(v);
      if (x < PAD_L || x > width - PAD_R) continue;
      ctx.strokeStyle = "rgba(120,130,150,0.14)";
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + plotH);
      ctx.stroke();
      ctx.fillStyle = "rgba(160,170,190,0.85)";
      ctx.fillText(formatTick(v), x - 10, height - PAD_B + 11);
    }

    ctx.strokeStyle = "rgba(140,150,170,0.5)";
    ctx.strokeRect(PAD_L, PAD_T, plotW, plotH);

    // --- data -------------------------------------------------------------
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, PAD_T, plotW, plotH);
    ctx.clip();

    // Bars first, then any line overlays, so analytic fits sit on top.
    const ordered = [...series].sort((a, b) => {
      const rank = (x: ChartSeries) => ((x.renderAs ?? kind) === "histogram" ? 0 : 1);
      return rank(a) - rank(b);
    });

    for (const s of ordered) {
      if (s.points.length === 0) continue;
      const kindForSeries = s.renderAs ?? kind;

      if (kindForSeries === "line") {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash(s.dash ?? []);
        ctx.beginPath();
        let started = false;
        for (const p of s.points) {
          const px = toX(p.x);
          const py = toY(p.y);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          if (started) ctx.lineTo(px, py);
          else {
            ctx.moveTo(px, py);
            started = true;
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (kindForSeries === "scatter") {
        for (const p of s.points) {
          ctx.fillStyle = p.flagged ? flagColor : s.color;
          const size = p.flagged ? 3 : 2;
          ctx.fillRect(toX(p.x) - size / 2, toY(p.y) - size / 2, size, size);
        }
      } else if (kindForSeries === "histogram") {
        const barW = Math.max(1, plotW / s.points.length - 1);
        for (const p of s.points) {
          const y = toY(p.y);
          const baseY = toY(logY ? Math.pow(10, yLo) : Math.max(0, yLo));
          ctx.fillStyle = p.flagged ? flagColor : s.color;
          ctx.fillRect(toX(p.x) - barW / 2, y, barW, Math.max(0, baseY - y));
        }
      } else if (kindForSeries === "heatmap") {
        // Points carry their intensity in `y`, position in `x`; used for
        // simple 1D intensity strips.
        const cellW = plotW / Math.max(1, s.points.length);
        for (let i = 0; i < s.points.length; i++) {
          const intensity = Math.max(0, Math.min(1, s.points[i]!.y));
          ctx.fillStyle = `hsl(${(1 - intensity) * 220}, 80%, ${25 + intensity * 40}%)`;
          ctx.fillRect(PAD_L + i * cellW, PAD_T, cellW + 1, plotH);
        }
      }
    }
    ctx.restore();

    // --- labels + legend ---------------------------------------------------
    ctx.fillStyle = "rgba(170,180,200,0.9)";
    ctx.font = "9px monospace";
    if (xLabel) ctx.fillText(xLabel, PAD_L + plotW / 2 - xLabel.length * 2.5, height - 3);
    if (yLabel) {
      ctx.save();
      ctx.translate(9, PAD_T + plotH / 2 + yLabel.length * 2.5);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    if (series.length > 1) {
      let lx = PAD_L + 4;
      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(s.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(lx, PAD_T + 6);
        ctx.lineTo(lx + 12, PAD_T + 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(200,205,220,0.95)";
        ctx.fillText(s.label, lx + 15, PAD_T + 9);
        lx += 18 + s.label.length * 5.4;
      }
    }
  }, [
    series, width, height, kind, xLabel, yLabel, includeZero, logY, flagColor, emptyMessage, viewport,
  ]);

  useEffect(() => {
    draw();
  }, [draw, version]);

  const supportsZoom = kind === "line" || kind === "scatter";

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`block rounded border border-zinc-800 ${supportsZoom ? "cursor-ew-resize" : ""}`}
      role="img"
      aria-label={`${kind} chart${yLabel ? ` of ${yLabel}` : ""}${xLabel ? ` against ${xLabel}` : ""}`}
      onWheel={(e) => {
        if (!supportsZoom) return;
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        setViewport((v) => ({ ...v, zoom: Math.max(1, Math.min(50, v.zoom * factor)) }));
      }}
      onPointerDown={(e) => {
        if (!supportsZoom) return;
        dragRef.current = { startX: e.clientX, basePan: viewport.panX };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const all = series.flatMap((s) => s.points);
        if (all.length === 0) return;
        const xs = all.map((p) => p.x);
        const span = (Math.max(...xs) - Math.min(...xs)) / viewport.zoom || 1;
        const perPixel = span / (width - PAD_L - PAD_R);
        setViewport((v) => ({ ...v, panX: drag.basePan - (e.clientX - drag.startX) * perPixel }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onDoubleClick={() => setViewport({ zoom: 1, panX: 0 })}
    />
  );
}
