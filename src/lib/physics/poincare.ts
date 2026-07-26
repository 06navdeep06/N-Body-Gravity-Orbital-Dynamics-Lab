/**
 * Poincaré section recorder.
 *
 * Watches successive system states and records a point every time a body's
 * trajectory pierces a section surface. Two section choices are supported:
 *
 *  - "y-plane": the classic y = 0 plane, downward crossing (per spec).
 *    Only produces points for genuinely 3D orbits.
 *  - "x-axis": passage through the +X half-plane (polar angle θ = 0 around
 *    the primary, measured in the XZ plane). This is the practical default
 *    because every built-in preset is coplanar (y ≈ 0 for all time), which
 *    makes the y = 0 section degenerate — nothing ever crosses it.
 *
 * At each crossing we store (r, v_r) in polar coordinates relative to the
 * primary. Bound regular orbits trace closed curves; chaotic orbits smear
 * into filled regions.
 *
 * Implemented as a plain module-level singleton (not React state): the
 * physics hook feeds it every worker result, and the canvas overlay polls
 * it each animation frame — no re-renders required.
 */

import type { CelestialBody, SystemState } from "./types";

export type SectionMode = "x-axis" | "y-plane";

export interface PoincarePoint {
  r: number;
  vr: number;
}

export interface PhasePoint {
  r: number;
  vr: number;
}

const MAX_SECTION_POINTS = 4000;
const MAX_PHASE_POINTS = 2000;

interface BodyBuffers {
  section: PoincarePoint[];
  phase: PhasePoint[];
  color: string;
  name: string;
}

/** Polar state of `body` relative to `primary`, in the XZ plane. */
function polarState(body: CelestialBody, primary: CelestialBody) {
  const dx = body.position.x - primary.position.x;
  const dz = body.position.z - primary.position.z;
  const dvx = body.velocity.x - primary.velocity.x;
  const dvz = body.velocity.z - primary.velocity.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  const theta = Math.atan2(dz, dx);
  const vr = r > 1e-12 ? (dx * dvx + dz * dvz) / r : 0;
  return { r, theta, vr, y: body.position.y, vy: body.velocity.y };
}

class PoincareRecorder {
  private buffers = new Map<string, BodyBuffers>();
  private prev: SystemState | null = null;
  mode: SectionMode = "x-axis";
  /** Bumped on every recorded point / clear, so pollers can skip redraws. */
  version = 0;

  record(state: SystemState, primaryId: string | null): void {
    const primary =
      (primaryId && state.bodies.find((b) => b.id === primaryId)) ||
      state.bodies.reduce<CelestialBody | null>(
        (heaviest, b) => (heaviest === null || b.mass > heaviest.mass ? b : heaviest),
        null
      );
    const prev = this.prev;
    this.prev = state;
    if (!primary || !prev) return;

    const prevPrimary = prev.bodies.find((b) => b.id === primary.id) ?? primary;

    for (const body of state.bodies) {
      if (body.id === primary.id) continue;
      const prevBody = prev.bodies.find((b) => b.id === body.id);
      if (!prevBody) continue;

      const now = polarState(body, primary);
      const before = polarState(prevBody, prevPrimary);

      let buffers = this.buffers.get(body.id);
      if (!buffers) {
        buffers = { section: [], phase: [], color: body.color, name: body.name };
        this.buffers.set(body.id, buffers);
      }

      // Continuous phase trajectory (r, r-dot), sampled every state.
      buffers.phase.push({ r: now.r, vr: now.vr });
      if (buffers.phase.length > MAX_PHASE_POINTS) buffers.phase.shift();

      const crossed =
        this.mode === "y-plane"
          ? before.y > 0 && now.y <= 0 // downward y = 0 crossing
          : // Sign change in θ near zero = passage through the +X half-plane
            // (either orbit direction); the |Δθ| < π guard excludes the ±π
            // wrap on the −X side.
            before.theta > 0 !== now.theta > 0 &&
            Math.abs(now.theta - before.theta) < Math.PI;

      if (crossed) {
        buffers.section.push({ r: now.r, vr: now.vr });
        if (buffers.section.length > MAX_SECTION_POINTS) buffers.section.shift();
      }
      this.version++;
    }
  }

  setMode(mode: SectionMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.clear();
    }
  }

  clear(): void {
    this.buffers.clear();
    this.prev = null;
    this.version++;
  }

  entries(): [string, BodyBuffers][] {
    return Array.from(this.buffers.entries());
  }
}

/** Shared recorder instance: fed by usePhysicsWorker, drawn by PhaseSpaceDiagram. */
export const poincareRecorder = new PoincareRecorder();
