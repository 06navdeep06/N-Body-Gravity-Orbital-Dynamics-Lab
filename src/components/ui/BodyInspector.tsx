"use client";

import { Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { computeOrbitalElements, inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { ChaosIndicator } from "./ChaosIndicator";
import { PhysicsTooltip, type PhysicsTerm } from "./PhysicsTooltips";

const RAD_TO_DEG = 180 / Math.PI;

function Field({
  label,
  value,
  onChange,
  step = 0.1,
  term,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  term?: PhysicsTerm;
}) {
  const labelEl = <span className="text-zinc-500">{label}</span>;
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-300">
      {term ? <PhysicsTooltip term={term}>{labelEl}</PhysicsTooltip> : labelEl}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-right text-xs"
      />
    </label>
  );
}

function Stat({ label, value, term }: { label: string; value: string; term?: PhysicsTerm }) {
  const labelEl = <span className="text-zinc-500">{label}</span>;
  return (
    <div className="flex items-center justify-between text-xs">
      {term ? <PhysicsTooltip term={term}>{labelEl}</PhysicsTooltip> : labelEl}
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}

export function BodyInspector() {
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);
  const updateBody = useSimulationStore((s) => s.updateBody);
  const removeBody = useSimulationStore((s) => s.removeBody);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const setPrimaryBody = useSimulationStore((s) => s.setPrimaryBody);
  const primaryBodyId = useSimulationStore((s) => s.primaryBodyId);

  const body = bodies.find((b) => b.id === selectedBodyId);

  // Inferred from the FULL body list (not excluding the selected body) so
  // that selecting the system's actual primary correctly resolves to
  // itself — excluding it here would instead pick the next-heaviest body
  // as a fake "primary" and compute nonsense orbital elements for the
  // primary "orbiting" that lesser body.
  const primary = useMemo(() => {
    if (!body) return null;
    const explicit = primaryBodyId && bodies.find((b) => b.id === primaryBodyId);
    return explicit || inferPrimaryBody(bodies);
  }, [body, bodies, primaryBodyId]);

  const isPrimary = !!(body && primary && body.id === primary.id);

  const elements = useMemo(() => {
    if (!body || !primary || isPrimary) return null;
    return computeOrbitalElements(body, primary, G);
  }, [body, primary, isPrimary, G]);

  if (!body) {
    return (
      <div className="w-72 border-l border-zinc-800 bg-zinc-950/90 p-4 text-xs text-zinc-500">
        Select a body to inspect it.
      </div>
    );
  }

  return (
    <div className="flex w-72 flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950/90 p-4 text-zinc-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: body.color }}
          />
          <h2 className="text-sm font-semibold">{body.name}</h2>
        </div>
        <button onClick={() => selectBody(null)} className="text-zinc-500 hover:text-zinc-200">
          <X size={14} />
        </button>
      </div>

      <section className="space-y-1.5 border-t border-zinc-800 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Properties
        </h3>
        <Field
          label="Mass"
          value={body.mass}
          term="mass"
          onChange={(v) => updateBody(body.id, { mass: v })}
        />
        <Field
          label="Radius"
          value={body.radius}
          step={0.05}
          onChange={(v) => updateBody(body.id, { radius: v })}
        />
        <Field
          label="Position X"
          value={body.position.x}
          onChange={(v) => updateBody(body.id, { position: { ...body.position, x: v } })}
        />
        <Field
          label="Position Y"
          value={body.position.y}
          onChange={(v) => updateBody(body.id, { position: { ...body.position, y: v } })}
        />
        <Field
          label="Position Z"
          value={body.position.z}
          onChange={(v) => updateBody(body.id, { position: { ...body.position, z: v } })}
        />
        <Field
          label="Velocity X"
          value={body.velocity.x}
          term="velocity"
          onChange={(v) => updateBody(body.id, { velocity: { ...body.velocity, x: v } })}
        />
        <Field
          label="Velocity Y"
          value={body.velocity.y}
          term="velocity"
          onChange={(v) => updateBody(body.id, { velocity: { ...body.velocity, y: v } })}
        />
        <Field
          label="Velocity Z"
          value={body.velocity.z}
          term="velocity"
          onChange={(v) => updateBody(body.id, { velocity: { ...body.velocity, z: v } })}
        />
        <label className="flex items-center justify-between text-xs text-zinc-300">
          <span className="text-zinc-500">Fixed</span>
          <input
            type="checkbox"
            checked={!!body.isFixed}
            onChange={(e) => updateBody(body.id, { isFixed: e.target.checked })}
          />
        </label>
      </section>

      <section className="space-y-1.5 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Orbital Elements
          </h3>
          {primary && !isPrimary && (
            <button
              onClick={() => setPrimaryBody(primary.id)}
              title="Use this body's inferred primary as the reference for all orbital-element calculations"
              className="text-[10px] text-sky-400 hover:underline"
            >
              rel. {primary.name}
            </button>
          )}
        </div>
        {!elements ? (
          <p className="text-[11px] text-zinc-500">
            {isPrimary
              ? "This is the system's primary body — orbital elements are computed for other bodies relative to it."
              : "No orbit relative to a primary body (velocities may be degenerate)."}
          </p>
        ) : (
          <>
            <Stat label="Type" value={elements.orbitType} />
            <Stat
              label="Semi-major axis (a)"
              value={elements.semiMajorAxis.toFixed(3)}
              term="semiMajorAxis"
            />
            <Stat
              label="Eccentricity (e)"
              value={elements.eccentricity.toFixed(4)}
              term="eccentricity"
            />
            <Stat label="Inclination (i)" value={`${(elements.inclination * RAD_TO_DEG).toFixed(2)}°`} />
            <Stat label="RAAN (Ω)" value={`${(elements.raan * RAD_TO_DEG).toFixed(2)}°`} />
            <Stat label="Arg. periapsis (ω)" value={`${(elements.argPeriapsis * RAD_TO_DEG).toFixed(2)}°`} />
            <Stat label="True anomaly (ν)" value={`${(elements.trueAnomaly * RAD_TO_DEG).toFixed(2)}°`} />
            <Stat
              label="Period"
              value={Number.isFinite(elements.period) ? elements.period.toFixed(3) : "∞ (unbound)"}
            />
            <Stat
              label="Apoapsis"
              value={Number.isFinite(elements.apoapsisDistance) ? elements.apoapsisDistance.toFixed(3) : "∞"}
            />
            <Stat label="Periapsis" value={elements.periapsisDistance.toFixed(3)} />
          </>
        )}
      </section>

      <ChaosIndicator bodyId={body.id} />

      <button
        onClick={() => removeBody(body.id)}
        className="mt-auto flex items-center justify-center gap-2 rounded-md bg-red-900/60 py-2 text-xs font-medium text-red-200 hover:bg-red-800/70"
      >
        <Trash2 size={14} />
        Remove body
      </button>
    </div>
  );
}
