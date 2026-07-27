/**
 * Time-series recorder for the analytics dashboard.
 *
 * A module-level singleton fed from the physics loop and polled by the
 * charts, so recording never triggers React re-renders. Every series is a
 * ring buffer capped at MAX_POINTS; once full, the oldest sample is dropped.
 */

import { computeOrbitalElements, inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { rocheLimit } from "@/lib/physics/tidal";
import type { EnergyMetrics, SystemState } from "@/lib/physics/types";

export const MAX_POINTS = 10_000;

export interface SeriesPoint {
  t: number;
  value: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  /** Flags a point for highlighting (e.g. an encounter inside the Roche limit). */
  flagged?: boolean;
  label?: string;
}

export type SeriesKey =
  | "kineticEnergy"
  | "potentialEnergy"
  | "totalEnergy"
  | "angularMomentum"
  | "semiMajorAxis"
  | "eccentricity"
  | "inclination"
  | "periapsis"
  | "apoapsis";

class AnalyticsRecorder {
  private series = new Map<SeriesKey, SeriesPoint[]>();
  /** Closest-approach events, as (time, distance) with a Roche flag. */
  closeEncounters: ScatterPoint[] = [];
  /** Latest snapshot of per-body scalars, refreshed on each sample. */
  masses: number[] = [];
  speeds: number[] = [];
  radii: number[] = [];

  /** Sample every Nth call; 1 = every frame. */
  sampleEvery = 3;
  private callCount = 0;
  /** Bumped whenever data changes so pollers can skip redundant redraws. */
  version = 0;

  private push(key: SeriesKey, point: SeriesPoint): void {
    let buffer = this.series.get(key);
    if (!buffer) {
      buffer = [];
      this.series.set(key, buffer);
    }
    buffer.push(point);
    if (buffer.length > MAX_POINTS) buffer.shift();
  }

  get(key: SeriesKey): SeriesPoint[] {
    return this.series.get(key) ?? [];
  }

  clear(): void {
    this.series.clear();
    this.closeEncounters = [];
    this.masses = [];
    this.speeds = [];
    this.radii = [];
    this.callCount = 0;
    this.version++;
  }

  /**
   * Records one sample. `selectedBodyId` drives the orbital-element series;
   * pass null to skip those.
   */
  record(
    state: SystemState,
    metrics: EnergyMetrics | null,
    time: number,
    selectedBodyId: string | null
  ): void {
    this.callCount++;
    if (this.callCount % this.sampleEvery !== 0) return;

    if (metrics) {
      this.push("kineticEnergy", { t: time, value: metrics.kineticEnergy });
      this.push("potentialEnergy", { t: time, value: metrics.potentialEnergy });
      this.push("totalEnergy", { t: time, value: metrics.totalEnergy });
      this.push("angularMomentum", {
        t: time,
        value: Math.hypot(
          metrics.angularMomentum.x,
          metrics.angularMomentum.y,
          metrics.angularMomentum.z
        ),
      });
    }

    // Per-body distributions, replaced wholesale each sample.
    this.masses = state.bodies.map((b) => b.mass);
    this.speeds = state.bodies.map((b) =>
      Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z)
    );
    const primary = inferPrimaryBody(state.bodies);
    this.radii = primary
      ? state.bodies
          .filter((b) => b.id !== primary.id)
          .map((b) =>
            Math.hypot(
              b.position.x - primary.position.x,
              b.position.y - primary.position.y,
              b.position.z - primary.position.z
            )
          )
      : [];

    if (selectedBodyId && primary && selectedBodyId !== primary.id) {
      const body = state.bodies.find((b) => b.id === selectedBodyId);
      if (body) {
        const elements = computeOrbitalElements(body, primary, state.G);
        if (elements) {
          this.push("semiMajorAxis", { t: time, value: elements.semiMajorAxis });
          this.push("eccentricity", { t: time, value: elements.eccentricity });
          this.push("inclination", { t: time, value: (elements.inclination * 180) / Math.PI });
          this.push("periapsis", { t: time, value: elements.periapsisDistance });
          if (Number.isFinite(elements.apoapsisDistance)) {
            this.push("apoapsis", { t: time, value: elements.apoapsisDistance });
          }
        }
      }
    }

    this.recordCloseEncounters(state, time);
    this.version++;
  }

  /**
   * Records the single closest pair this sample. Scanning all pairs is
   * O(N²), so above this many bodies the scan is skipped rather than
   * stalling the frame — the dashboard says so explicitly.
   */
  private static readonly ENCOUNTER_BODY_LIMIT = 300;

  private recordCloseEncounters(state: SystemState, time: number): void {
    const bodies = state.bodies;
    if (bodies.length < 2 || bodies.length > AnalyticsRecorder.ENCOUNTER_BODY_LIMIT) return;

    let closest = Infinity;
    let a = bodies[0]!;
    let b = bodies[1]!;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const bi = bodies[i]!;
        const bj = bodies[j]!;
        const d = Math.hypot(
          bi.position.x - bj.position.x,
          bi.position.y - bj.position.y,
          bi.position.z - bj.position.z
        );
        if (d < closest) {
          closest = d;
          a = bi;
          b = bj;
        }
      }
    }
    if (!Number.isFinite(closest)) return;

    const heavier = a.mass >= b.mass ? a : b;
    const lighter = a.mass >= b.mass ? b : a;
    const limit = rocheLimit(heavier, lighter);

    this.closeEncounters.push({
      x: time,
      y: closest,
      flagged: limit > 0 && closest < limit,
      label: `${a.name} ↔ ${b.name}`,
    });
    if (this.closeEncounters.length > MAX_POINTS) this.closeEncounters.shift();
  }

  /** All recorded series as CSV, for the export button. */
  toCsv(): string {
    const keys = Array.from(this.series.keys()).sort();
    if (keys.length === 0) return "t\n";

    // Series share a sample cadence, so align on the longest one's times.
    const longest = keys.reduce((best, k) =>
      this.get(k).length > this.get(best).length ? k : best
    );
    const times = this.get(longest).map((p) => p.t);

    const header = ["t", ...keys].join(",");
    const rows = times.map((t, i) => {
      const cells = keys.map((k) => {
        const point = this.get(k)[i];
        return point !== undefined ? String(point.value) : "";
      });
      return [String(t), ...cells].join(",");
    });
    return [header, ...rows].join("\n");
  }
}

export const analyticsRecorder = new AnalyticsRecorder();

// ---------------------------------------------------------------------------
// Derived statistics used by the distribution charts
// ---------------------------------------------------------------------------

export interface Histogram {
  bins: { center: number; count: number }[];
  min: number;
  max: number;
}

export function histogram(values: number[], binCount = 30, logScale = false): Histogram | null {
  const usable = values.filter((v) => Number.isFinite(v) && (!logScale || v > 0));
  if (usable.length === 0) return null;

  const transformed = logScale ? usable.map((v) => Math.log10(v)) : usable;
  const min = Math.min(...transformed);
  const max = Math.max(...transformed);
  const span = max - min || 1;
  const width = span / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    center: min + (i + 0.5) * width,
    count: 0,
  }));
  for (const value of transformed) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index]!.count++;
  }
  return { bins, min, max };
}

/**
 * Maxwell-Boltzmann speed distribution fitted to the sample's RMS speed.
 * A thermalized N-body system relaxes toward this shape, so the overlay
 * shows how far from equilibrium the system currently is.
 */
export function maxwellBoltzmannFit(speeds: number[], atSpeed: number[]): number[] {
  const usable = speeds.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length === 0) return atSpeed.map(() => 0);

  const meanSquare = usable.reduce((s, v) => s + v * v, 0) / usable.length;
  // <v²> = 3a² for the 3D Maxwell-Boltzmann distribution.
  const a = Math.sqrt(meanSquare / 3);
  if (a <= 0) return atSpeed.map(() => 0);

  const norm = Math.sqrt(2 / Math.PI) / (a * a * a);
  return atSpeed.map((v) => norm * v * v * Math.exp(-(v * v) / (2 * a * a)));
}

/**
 * Radial density profile ρ(r): bodies per unit shell volume, which is the
 * quantity that distinguishes a Plummer core from a Hernquist cusp.
 */
export function radialDensityProfile(radii: number[], binCount = 24): Histogram | null {
  const base = histogram(radii, binCount, false);
  if (!base) return null;

  const width = (base.max - base.min) / binCount || 1;
  const bins = base.bins.map((bin) => {
    const inner = Math.max(0, bin.center - width / 2);
    const outer = bin.center + width / 2;
    const shellVolume = (4 / 3) * Math.PI * (outer ** 3 - inner ** 3);
    return { center: bin.center, count: shellVolume > 0 ? bin.count / shellVolume : 0 };
  });
  return { bins, min: base.min, max: base.max };
}

/**
 * Two-body correlation function g(r): the observed pair-separation
 * histogram divided by what a uniform random distribution of the same
 * density would give. g(r) > 1 means clustering at that separation.
 */
export function pairCorrelation(
  positions: { x: number; y: number; z: number }[],
  binCount = 24,
  maxPairs = 20_000
): Histogram | null {
  if (positions.length < 2) return null;

  // Subsample pairs for large N — the full set is O(N²).
  const stride = Math.max(1, Math.ceil(Math.sqrt((positions.length * positions.length) / (2 * maxPairs))));
  const separations: number[] = [];
  for (let i = 0; i < positions.length; i += stride) {
    for (let j = i + stride; j < positions.length; j += stride) {
      const a = positions[i]!;
      const b = positions[j]!;
      separations.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  const raw = histogram(separations, binCount, false);
  if (!raw) return null;

  const width = (raw.max - raw.min) / binCount || 1;
  const total = separations.length;
  const rMax = raw.max || 1;

  const bins = raw.bins.map((bin) => {
    const inner = Math.max(0, bin.center - width / 2);
    const outer = bin.center + width / 2;
    // Expected fraction of pairs in this shell for a uniform sphere of
    // radius rMax: the shell's volume share.
    const expectedFraction = (outer ** 3 - inner ** 3) / rMax ** 3;
    const expected = total * expectedFraction;
    return { center: bin.center, count: expected > 0 ? bin.count / expected : 0 };
  });
  return { bins, min: raw.min, max: raw.max };
}
