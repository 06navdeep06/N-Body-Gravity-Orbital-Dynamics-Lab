"use client";

/**
 * Full-screen analytics view: eight chart panels driven by the shared
 * `analyticsRecorder` ring buffers, plus CSV export.
 *
 * Charts poll the recorder's version counter on an interval rather than
 * subscribing to the store, so a 10k-point series never re-renders React on
 * the physics cadence.
 */

import { Download, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  analyticsRecorder,
  histogram,
  maxwellBoltzmannFit,
  pairCorrelation,
  radialDensityProfile,
} from "@/lib/analytics/recorder";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { CanvasChart, type ChartSeries } from "./CanvasChart";

const REFRESH_MS = 400;
const CHART_W = 430;
const CHART_H = 190;

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">{title}</h3>
      <p className="mb-2 text-[10px] leading-snug text-zinc-500">{description}</p>
      {children}
    </section>
  );
}

export function AnalyticsDashboard() {
  const open = useSimulationStore((s) => s.analyticsOpen);
  const setOpen = useSimulationStore((s) => s.setAnalyticsOpen);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setVersion(analyticsRecorder.version), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  const toSeries = (
    key: Parameters<typeof analyticsRecorder.get>[0],
    label: string,
    color: string,
    dash?: number[]
  ): ChartSeries => ({
    label,
    color,
    dash,
    points: analyticsRecorder.get(key).map((p) => ({ x: p.t, y: p.value })),
  });

  const energySeries = useMemo<ChartSeries[]>(
    () => [
      toSeries("kineticEnergy", "KE", "#7dd3fc"),
      toSeries("potentialEnergy", "PE", "#f0abfc", [4, 3]),
      toSeries("totalEnergy", "TE", "#4ade80", [8, 3]),
      toSeries("angularMomentum", "|L|", "#fbbf24", [2, 2]),
    ],
    // Recomputed whenever the recorder advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const elementSeries = useMemo<ChartSeries[]>(
    () => [
      toSeries("semiMajorAxis", "a", "#7dd3fc"),
      toSeries("eccentricity", "e", "#fbbf24", [4, 3]),
      toSeries("inclination", "i (deg)", "#f0abfc", [2, 2]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const apsisSeries = useMemo<ChartSeries[]>(
    () => [
      toSeries("periapsis", "periapsis", "#f87171"),
      toSeries("apoapsis", "apoapsis", "#60a5fa", [5, 3]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const encounterSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: "closest approach",
        color: "#a5b4fc",
        points: analyticsRecorder.closeEncounters.map((p) => ({
          x: p.x,
          y: p.y,
          flagged: p.flagged,
        })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const massSeries = useMemo<ChartSeries[]>(() => {
    const h = histogram(analyticsRecorder.masses, 28, true);
    return h ? [{ label: "log10 mass", color: "#818cf8", points: h.bins.map((b) => ({ x: b.center, y: b.count })) }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const velocitySeries = useMemo<ChartSeries[]>(() => {
    const h = histogram(analyticsRecorder.speeds, 28, false);
    if (!h) return [];
    const centers = h.bins.map((b) => b.center);
    const fit = maxwellBoltzmannFit(analyticsRecorder.speeds, centers);
    // Scale the analytic curve to the histogram's area for comparison.
    const observedPeak = Math.max(...h.bins.map((b) => b.count), 1);
    const fitPeak = Math.max(...fit, 1e-12);
    return [
      { label: "observed", color: "#34d399", points: h.bins.map((b) => ({ x: b.center, y: b.count })) },
      {
        label: "Maxwell-Boltzmann",
        color: "#fbbf24",
        dash: [4, 3],
        // Line overlay, not bars — otherwise it hides the observed histogram.
        renderAs: "line" as const,
        points: centers.map((c, i) => ({ x: c, y: (fit[i]! / fitPeak) * observedPeak })),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const densitySeries = useMemo<ChartSeries[]>(() => {
    const profile = radialDensityProfile(analyticsRecorder.radii, 24);
    return profile
      ? [{ label: "rho(r)", color: "#fb923c", points: profile.bins.map((b) => ({ x: b.center, y: b.count })) }]
      : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const correlationSeries = useMemo<ChartSeries[]>(() => {
    const g = pairCorrelation(bodies.map((b) => b.position), 24);
    return g
      ? [{ label: "g(r)", color: "#22d3ee", points: g.bins.map((b) => ({ x: b.center, y: b.count })) }]
      : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, bodies]);

  if (!open) return null;

  const handleExport = () => {
    const csv = analyticsRecorder.toCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const selectedName = bodies.find((b) => b.id === selectedBodyId)?.name;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 overflow-y-auto bg-zinc-950/98 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Analytics dashboard"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Analytics</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
          >
            <Download size={12} />
            Export CSV
          </button>
          <button
            onClick={() => {
              analyticsRecorder.clear();
              setVersion((v) => v + 1);
            }}
            className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
          >
            <Trash2 size={12} />
            Clear
          </button>
          <button onClick={() => setOpen(false)} aria-label="Close analytics" className="rounded bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="Energy conservation"
          description="KE, PE, total energy and |L| against simulation time. A well-conserved run keeps TE and |L| flat — visible drift means the timestep is too large."
        >
          <CanvasChart kind="line" series={energySeries} width={CHART_W} height={CHART_H} version={version} xLabel="t" yLabel="energy" includeZero />
        </Panel>

        <Panel
          title={`Orbital elements${selectedName ? ` — ${selectedName}` : ""}`}
          description={selectedName ? "Semi-major axis, eccentricity and inclination for the selected body. Secular trends show up as slow drift, resonances as oscillation." : "Select a body to record its orbital elements."}
        >
          <CanvasChart kind="line" series={elementSeries} width={CHART_W} height={CHART_H} version={version} xLabel="t" emptyMessage="select a body to record elements" />
        </Panel>

        <Panel
          title="Pericenter / apocenter history"
          description="Min and max orbital distance over time. Under GR precession these stay level while the apsidal line rotates; under perturbation they breathe."
        >
          <CanvasChart kind="line" series={apsisSeries} width={CHART_W} height={CHART_H} version={version} xLabel="t" yLabel="r" emptyMessage="select a bound body" />
        </Panel>

        <Panel
          title="Close encounters"
          description="Closest pair separation per sample. Points inside the pair's Roche limit are red — those are the encounters that can shred a body."
        >
          <CanvasChart kind="scatter" series={encounterSeries} width={CHART_W} height={CHART_H} version={version} xLabel="t" yLabel="min separation" />
        </Panel>

        <Panel
          title="Mass distribution"
          description="Histogram of body masses on a log10 axis. Collisions merge bodies, so the distribution shifts rightward and thins over time."
        >
          <CanvasChart kind="histogram" series={massSeries} width={CHART_W} height={CHART_H} version={version} xLabel="log10(mass)" yLabel="count" />
        </Panel>

        <Panel
          title="Velocity distribution"
          description="Speed histogram with a Maxwell-Boltzmann curve fitted to the same RMS speed. Agreement indicates the system has thermalized."
        >
          <CanvasChart kind="histogram" series={velocitySeries} width={CHART_W} height={CHART_H} version={version} xLabel="|v|" yLabel="count" />
        </Panel>

        <Panel
          title="Radial density profile"
          description="Bodies per unit shell volume against distance from the primary — the shape that separates a flat Plummer core from a Hernquist cusp."
        >
          <CanvasChart kind="line" series={densitySeries} width={CHART_W} height={CHART_H} version={version} xLabel="r" yLabel="rho(r)" logY />
        </Panel>

        <Panel
          title="Pair correlation g(r)"
          description="Observed pair separations divided by the uniform-random expectation. g(r) > 1 means clustering at that scale; g(r) ≈ 1 means no structure."
        >
          <CanvasChart kind="line" series={correlationSeries} width={CHART_W} height={CHART_H} version={version} xLabel="r" yLabel="g(r)" />
        </Panel>
      </div>

      <p className="mt-3 text-[10px] text-zinc-600">
        Series are ring buffers capped at 10,000 points, sampled every{" "}
        {analyticsRecorder.sampleEvery} physics results. Drag to pan and scroll to zoom the
        time-series charts; double-click to reset. Close-encounter scanning is skipped above 300
        bodies, where the all-pairs sweep would cost more than the frame budget allows.
      </p>
    </div>
  );
}
