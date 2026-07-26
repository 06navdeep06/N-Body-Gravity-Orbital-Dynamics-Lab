"use client";

/**
 * Reusable hover-card tooltip for numeric physics quantities shown
 * elsewhere in the UI (EnergyDashboard, BodyInspector, ...) — explains
 * what a value means and its units on hover.
 */

import { useState, type ReactNode } from "react";

export const PHYSICS_TERMS = {
  kineticEnergy:
    "The energy of motion: ½mv² summed across all bodies. Units: mass·length²/time².",
  potentialEnergy:
    "Gravitational binding energy summed across all body pairs. Negative means bound.",
  totalEnergy:
    "Kinetic + potential energy. In a stable, isolated system this stays constant (conservation of energy) — drift indicates numerical error.",
  angularMomentum:
    "Magnitude of Σ m·(r×v). Conserved when there's no external torque on the system.",
  mass: "How much matter the body has. Determines its gravitational pull and inertia.",
  velocity:
    "Rate of change of position. Its magnitude is speed; direction sets the orbit's shape.",
  eccentricity:
    "How elongated the orbit is: 0 = circle, 0<e<1 = ellipse, 1 = parabola, e>1 = hyperbola.",
  semiMajorAxis:
    "Half the longest diameter of the orbital ellipse — sets the orbital period via Kepler's third law.",
  fps: "Rendered frames per second. Below ~30 the simulation will feel sluggish.",
  workerStepMs: "Wall-clock time the physics worker spent on the last batch of integration steps.",
} as const;

export type PhysicsTerm = keyof typeof PHYSICS_TERMS;

export function PhysicsTooltip({ term, children }: { term: PhysicsTerm; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const description = PHYSICS_TERMS[term];

  return (
    <span
      className="relative inline-flex cursor-help items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-52 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[10px] font-sans font-normal normal-case leading-snug text-zinc-200 shadow-xl">
          {description}
        </span>
      )}
    </span>
  );
}
