/**
 * Scenario scripting sandbox.
 *
 * User scripts run through the `Function` constructor with an explicitly
 * shadowed global surface: every capability-bearing global a script might
 * reach for (`window`, `fetch`, `document`, `localStorage`, `import`,
 * `eval`, …) is declared as a parameter and passed `undefined`, so the
 * identifier resolves to a local binding instead of walking the scope chain
 * to the real global.
 *
 * This is a *containment* boundary, not a security boundary. It stops a
 * script from casually reaching the network or storage, but it is not
 * escape-proof: `eval` cannot be shadowed (illegal as a strict-mode
 * parameter name), and the prototype chain still leads back to the real
 * global via `(()=>{}).constructor("return globalThis")()`. The meaningful
 * isolation comes from *where* this runs — script.worker.ts, a worker scope
 * with no DOM and no access to the page. That is acceptable because scripts
 * are authored by the person running them; it would not be acceptable for
 * scripts arriving from another user, which would need a cross-origin
 * iframe or a network-denied worker.
 *
 * Scripts are also bounded on output: at most MAX_BODIES bodies, and a
 * wall-clock budget checked from inside the api (a runaway `while(true)`
 * that never calls the api can't be interrupted from here — see the note on
 * TIMEOUT_MS below).
 */

import type { CelestialBody, SystemState, Vector3D } from "@/lib/physics/types";
import { circularOrbitVelocity, escapeVelocity } from "@/lib/utils/orbital-velocity";

export const MAX_BODIES = 10_000;
export const TIMEOUT_MS = 5_000;

export interface ScriptBodySpec {
  name?: string;
  mass: number;
  position: [number, number, number] | Vector3D;
  velocity: [number, number, number] | Vector3D;
  color?: string;
  radius?: number;
  isFixed?: boolean;
  isBlackHole?: boolean;
}

export type ScriptResult =
  | { ok: true; state: SystemState; bodyCount: number; elapsedMs: number }
  | { ok: false; error: string; line?: number };

function toVector(v: [number, number, number] | Vector3D): Vector3D {
  return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
}

function assertFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number (got ${String(value)})`);
  }
  return value;
}

/** Globals shadowed to `undefined` inside script scope. */
const BLOCKED_GLOBALS = [
  "window",
  "globalThis",
  "self",
  "document",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "navigator",
  "location",
  "history",
  // NOTE: "eval" and "arguments" are deliberately absent — they are illegal
  // as parameter names under "use strict", and including them makes the
  // Function constructor throw before the script ever runs. `eval` therefore
  // stays reachable; see the file header on why that is acceptable here.
  "Function",
  "require",
  "process",
  "importScripts",
  "postMessage",
  "alert",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
] as const;

/** Extracts a 1-based line number for the user's script from an error stack. */
function extractLine(error: unknown): number | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  // Function-constructor bodies report as "<anonymous>:LINE:COL"; the wrapper
  // adds 2 lines ("function anonymous(" + the parameter list) before the body.
  const match = /<anonymous>:(\d+):\d+/.exec(error.stack);
  if (!match) return undefined;
  const raw = Number(match[1]);
  return Number.isFinite(raw) ? Math.max(1, raw - 2) : undefined;
}

/**
 * Executes `source` and returns the SystemState it built.
 * `base` supplies the starting G / softening / timeStep, which the script
 * may override.
 */
export function runScript(source: string, base: SystemState): ScriptResult {
  const bodies: CelestialBody[] = [];
  let G = base.G;
  let softening = base.softening;
  let timeStep = base.timeStep;
  let autoId = 0;

  const startedAt = Date.now();
  const checkBudget = () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(`script exceeded its ${TIMEOUT_MS / 1000}s time budget`);
    }
  };

  const api = {
    addBody(spec: ScriptBodySpec): string {
      checkBudget();
      if (bodies.length >= MAX_BODIES) {
        throw new Error(`body limit reached (${MAX_BODIES})`);
      }
      if (!spec || typeof spec !== "object") throw new Error("addBody needs an object");

      const position = toVector(spec.position);
      const velocity = toVector(spec.velocity);
      assertFinite(position.x, "position.x");
      assertFinite(position.y, "position.y");
      assertFinite(position.z, "position.z");
      assertFinite(velocity.x, "velocity.x");
      assertFinite(velocity.y, "velocity.y");
      assertFinite(velocity.z, "velocity.z");
      assertFinite(spec.mass, "mass");

      autoId += 1;
      const bodyId = `script-${autoId}`;
      bodies.push({
        id: bodyId,
        name: spec.name ?? `Body ${autoId}`,
        mass: spec.mass,
        position,
        velocity,
        color: spec.color ?? "#9ca3af",
        radius: spec.radius ?? 0.3,
        ...(spec.isFixed ? { isFixed: true } : {}),
        ...(spec.isBlackHole ? { isBlackHole: true } : {}),
      });
      return bodyId;
    },

    removeBody(nameOrId: string): boolean {
      checkBudget();
      const index = bodies.findIndex((b) => b.id === nameOrId || b.name === nameOrId);
      if (index < 0) return false;
      bodies.splice(index, 1);
      return true;
    },

    setG(value: number): void {
      G = assertFinite(value, "G");
    },
    setSoftening(value: number): void {
      softening = assertFinite(value, "softening");
    },
    setTimeStep(value: number): void {
      timeStep = assertFinite(value, "timeStep");
    },

    circularOrbitVelocity(centralMass: number, radius: number): number {
      return circularOrbitVelocity(centralMass, radius, G);
    },
    escapeVelocity(centralMass: number, distance: number): number {
      return escapeVelocity(centralMass, distance, G);
    },

    /** Count of bodies added so far — handy for progress in long loops. */
    get bodyCount(): number {
      return bodies.length;
    },
    log(...args: unknown[]): void {
      console.info("[script]", ...args);
    },
  };

  try {
    // `new Function` is the sandbox boundary itself here — see file header
    // for what it does and does not contain.
    const factory = new Function(
      "api",
      "Math",
      "console",
      ...BLOCKED_GLOBALS,
      `"use strict";\n${source}`
    );
    factory(api, Math, { log: api.log, info: api.log, warn: api.log, error: api.log });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      line: extractLine(error),
    };
  }

  if (bodies.length === 0) {
    return { ok: false, error: "script finished without adding any bodies" };
  }

  return {
    ok: true,
    state: { bodies, G, softening, timeStep },
    bodyCount: bodies.length,
    elapsedMs: Date.now() - startedAt,
  };
}
