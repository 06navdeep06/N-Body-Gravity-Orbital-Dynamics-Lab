"use client";

/**
 * "Add Body" builder.
 *
 * The panel exists because raw state vectors are the wrong interface for
 * adding a body. Typing a mass, a radius and three velocity components by hand
 * gets you an object on an unstable orbit almost every time — the velocity
 * that produces a closed orbit depends on G, on the host's mass and on the
 * distance, and no one holds sqrt(GM/r) in their head while filling a form.
 *
 * So the panel asks the two questions that actually determine the answer —
 * *what* are you adding and *what* is it going around — and derives the rest:
 *
 *   catalogue entry  ->  mass, radius, colour, render profile
 *   host + geometry  ->  position and velocity at periapsis
 *
 * The Custom tab keeps the original raw-value form, unchanged in capability,
 * for the cases the catalogue cannot express.
 *
 * Unit handling lives in `lib/data/preset-spawn`, not here: the catalogue is
 * in M☉/AU and the loaded scene may be in anything, so every catalogue value
 * passes through a scale factor measured from the scene's heaviest body.
 */

import { Orbit, Rocket, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ASTRONOMICAL_PRESETS,
  PRESET_CATEGORIES,
  formatRadius,
  formatRelativeMass,
  getPresetsByCategory,
  searchPresets,
  type AstronomicalPreset,
  type PresetCategory,
} from "@/lib/data/astronomical-presets";
import {
  CANONICAL_SCALE,
  buildSpawnedBody,
  nextSpawnId,
  orbitalStateVectors,
  sceneScale,
  suggestedOrbitRadius,
} from "@/lib/data/preset-spawn";
import type { CelestialBody } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const DEFAULT_COLOR = "#22d3ee";

/** Beyond this many bodies the host dropdown lists only the heaviest. */
const MAX_HOST_OPTIONS = 100;

/** Eccentricity is capped below 1 — an unbound "orbit" is an escape, not an orbit. */
const MAX_ECCENTRICITY = 0.95;

const INPUT = "rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-100 outline-none focus:border-sky-600";

/** Formats a number compactly across the ~25 orders of magnitude in play. */
function num(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "∞";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(2);
  return Number(value.toPrecision(digits)).toString();
}

function CategoryDot({ preset }: { preset: AstronomicalPreset }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full ring-1 ring-black/40"
      style={{
        backgroundColor: preset.color === "#000000" ? "#18181b" : preset.color,
        boxShadow: preset.emissive || preset.glowColor
          ? `0 0 6px 1px ${preset.glowColor ?? preset.color}`
          : undefined,
      }}
    />
  );
}

export function BodyLauncher() {
  const addBody = useSimulationStore((s) => s.addBody);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);
  const timeUnit = useSimulationStore((s) => s.timeUnit);
  const storePrimaryId = useSimulationStore((s) => s.primaryBodyId);

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PresetCategory>("planets");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(ASTRONOMICAL_PRESETS[0]?.id ?? null);

  // Orbit parameters.
  //
  // Both the host and the periapsis are *preferences* rather than the live
  // values: the host may be deleted from under us and the periapsis is
  // meaningless once a different object is selected. Storing the preference
  // and resolving it during render keeps the two derivations below honest,
  // and avoids the effect-driven state resets that cause cascading renders.
  const [hostPreference, setHostPreference] = useState<string>("");
  // Text rather than a number so scientific notation ("4.5e-5", which is where
  // a low Earth orbit lands in AU) can be typed directly. An entry that does
  // not match the current selection means "use the catalogue suggestion".
  const [radiusEntry, setRadiusEntry] = useState<{ presetId: string; text: string }>({
    presetId: "",
    text: "",
  });
  const [eccentricity, setEccentricity] = useState(0);
  const [inclination, setInclination] = useState(0);
  const [phase, setPhase] = useState(0);
  const [retrograde, setRetrograde] = useState(false);
  const [fixedOverride, setFixedOverride] = useState<boolean | null>(null);
  const [scaleToScene, setScaleToScene] = useState(true);

  // Custom tab — the original manual form.
  const [customName, setCustomName] = useState("New Body");
  const [customMass, setCustomMass] = useState(1);
  const [customRadius, setCustomRadius] = useState(0.5);
  const [customColor, setCustomColor] = useState(DEFAULT_COLOR);
  const [customPosition, setCustomPosition] = useState({ x: 10, y: 0, z: 0 });
  const [customVelocity, setCustomVelocity] = useState({ x: 0, y: 0, z: 5 });
  const [customFixed, setCustomFixed] = useState(false);

  const scale = useMemo(
    () => (scaleToScene ? sceneScale(bodies) : CANONICAL_SCALE),
    [bodies, scaleToScene]
  );

  const hostOptions = useMemo(
    () => [...bodies].sort((a, b) => b.mass - a.mass).slice(0, MAX_HOST_OPTIONS),
    [bodies]
  );

  // Falls back to the scene's designated primary, else its heaviest body —
  // which is what "put this in orbit" almost always means.
  const host: CelestialBody | null = useMemo(
    () =>
      hostOptions.find((b) => b.id === hostPreference) ??
      hostOptions.find((b) => b.id === storePrimaryId) ??
      hostOptions[0] ??
      null,
    [hostOptions, hostPreference, storePrimaryId]
  );

  const listed = useMemo(() => {
    // A search spans the whole catalogue: someone typing "titan" should not
    // have to know first whether Titan is filed under moons.
    if (query.trim()) return searchPresets(query);
    return getPresetsByCategory(category);
  }, [query, category]);

  const selected = useMemo(
    () => listed.find((p) => p.id === selectedId) ?? listed[0] ?? null,
    [listed, selectedId]
  );

  // Changing catalogue entry drops back to that entry's suggested distance;
  // keeping Voyager 1's 167 AU after switching to the ISS would be a silent
  // trap.
  const radiusInput = radiusEntry.presetId === selected?.id ? radiusEntry.text : "";

  const scaledPresetRadius = selected ? selected.simRadius * scale.lengthScale : 0;

  const orbitRadius = useMemo(() => {
    const typed = Number(radiusInput);
    if (radiusInput.trim() && Number.isFinite(typed) && typed > 0) return typed;
    if (!selected) return 0;
    return suggestedOrbitRadius(selected, scale, host?.radius ?? 0);
  }, [radiusInput, selected, scale, host]);

  const spawnMass = selected ? selected.simMass * scale.massScale : 0;

  const orbit = useMemo(() => {
    if (!selected || !host) return null;
    return orbitalStateVectors({
      hostMass: host.mass,
      hostPosition: host.position,
      hostVelocity: host.velocity,
      bodyMass: spawnMass,
      periapsis: orbitRadius,
      eccentricity,
      inclinationDeg: inclination,
      phaseDeg: phase,
      G,
      retrograde,
    });
  }, [selected, host, spawnMass, orbitRadius, eccentricity, inclination, phase, G, retrograde]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!selected) return out;
    if (!host) {
      out.push("No host body in the scene — the body is placed at rest at the given radius along +X.");
      return out;
    }
    if (orbitRadius <= host.radius + scaledPresetRadius) {
      out.push(`Periapsis is inside ${host.name}'s surface — it will start in contact.`);
    }
    if (spawnMass > host.mass * 0.1) {
      out.push("Mass is a large fraction of the host's; the host is not recoiled, so the barycentre will drift.");
    }
    return out;
  }, [selected, host, orbitRadius, scaledPresetRadius, spawnMass]);

  const periodLabel = useMemo(() => {
    if (!orbit || !Number.isFinite(orbit.period)) return null;
    if (!timeUnit) return `${num(orbit.period)} t`;
    const days = orbit.period * timeUnit.earthDaysPerUnit;
    if (days < 1) return `${num(days * 24)} h`;
    if (days < 730) return `${num(days)} d`;
    return `${num(days / 365.25)} yr`;
  }, [orbit, timeUnit]);

  const launchPreset = () => {
    if (!selected) return;
    const position = orbit
      ? orbit.position
      : { x: orbitRadius, y: 0, z: 0 };
    const velocity = orbit ? orbit.velocity : { x: 0, y: 0, z: 0 };
    addBody(
      buildSpawnedBody({
        preset: selected,
        scale,
        position,
        velocity,
        ...(fixedOverride === null ? {} : { isFixed: fixedOverride }),
      })
    );
    setOpen(false);
  };

  const launchCustom = () => {
    const body: CelestialBody = {
      id: nextSpawnId("custom"),
      name: customName.trim() || "Custom Body",
      mass: customMass,
      radius: customRadius,
      color: customColor,
      position: customPosition,
      velocity: customVelocity,
      isFixed: customFixed,
    };
    addBody(body);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-md bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-100 shadow-lg ring-1 ring-zinc-700 hover:bg-zinc-800"
      >
        <Rocket size={14} />
        Add Body
      </button>
    );
  }

  const isCustom = category === "custom" && !query.trim();

  return (
    <div
      role="dialog"
      aria-label="Add body"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      className="pointer-events-auto flex max-h-[80vh] w-[42rem] max-w-[92vw] flex-col rounded-lg border border-zinc-700 bg-zinc-950/95 text-xs text-zinc-100 shadow-2xl backdrop-blur"
    >
      {/* --- Header + search ------------------------------------------- */}
      <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
        <Rocket size={14} className="text-sky-400" />
        <h2 className="font-semibold">Add Body</h2>
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 100+ objects…"
            aria-label="Search catalogue"
            className={`${INPUT} w-56 pl-6`}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* --- Category rail -------------------------------------------- */}
        <div role="tablist" aria-label="Categories" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-zinc-800 p-2">
          {PRESET_CATEGORIES.map((cat) => {
            const active = !query.trim() && cat.id === category;
            const count = getPresetsByCategory(cat.id).length;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setQuery("");
                  setCategory(cat.id);
                }}
                className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-[11px] ${
                  active ? "bg-sky-600/20 text-sky-200 ring-1 ring-sky-700" : "text-zinc-400 hover:bg-zinc-800/70"
                }`}
              >
                <span>{cat.label}</span>
                {count > 0 && <span className="font-mono text-[10px] text-zinc-600">{count}</span>}
              </button>
            );
          })}
        </div>

        {isCustom ? (
          /* --- Custom: raw simulation values -------------------------- */
          <form
            onSubmit={(e) => {
              e.preventDefault();
              launchCustom();
            }}
            className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
          >
            <p className="text-[11px] text-zinc-500">
              Values are in the loaded scene&apos;s own units (G = {num(G)}). Nothing is scaled or derived.
            </p>
            <label className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Name</span>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} className={`${INPUT} w-40`} />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Color</span>
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="h-6 w-10 rounded border border-zinc-700 bg-zinc-900"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Mass</span>
              <input
                type="number"
                value={customMass}
                step={0.1}
                onChange={(e) => setCustomMass(Number(e.target.value))}
                className={`${INPUT} w-28 text-right`}
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Radius</span>
              <input
                type="number"
                value={customRadius}
                step={0.05}
                onChange={(e) => setCustomRadius(Number(e.target.value))}
                className={`${INPUT} w-28 text-right`}
              />
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis} className="flex flex-col text-[10px] text-zinc-500">
                  pos.{axis}
                  <input
                    type="number"
                    value={customPosition[axis]}
                    onChange={(e) => setCustomPosition({ ...customPosition, [axis]: Number(e.target.value) })}
                    className={`${INPUT} text-right`}
                  />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis} className="flex flex-col text-[10px] text-zinc-500">
                  vel.{axis}
                  <input
                    type="number"
                    value={customVelocity[axis]}
                    onChange={(e) => setCustomVelocity({ ...customVelocity, [axis]: Number(e.target.value) })}
                    className={`${INPUT} text-right`}
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center justify-between">
              <span className="text-zinc-500">Fixed</span>
              <input type="checkbox" checked={customFixed} onChange={(e) => setCustomFixed(e.target.checked)} />
            </label>
            <button
              type="submit"
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 py-1.5 font-medium hover:bg-sky-500"
            >
              <Rocket size={14} />
              Launch
            </button>
          </form>
        ) : (
          <>
            {/* --- Object list ----------------------------------------- */}
            <div className="flex w-52 shrink-0 flex-col border-r border-zinc-800">
              <div className="border-b border-zinc-800 px-2 py-1.5 text-[10px] text-zinc-500">
                {query.trim()
                  ? `${listed.length} match${listed.length === 1 ? "" : "es"}`
                  : PRESET_CATEGORIES.find((c) => c.id === category)?.blurb}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto p-1">
                {listed.length === 0 && (
                  <li className="px-2 py-3 text-center text-[11px] text-zinc-600">No matches.</li>
                )}
                {listed.map((preset) => (
                  <li key={preset.id}>
                    <button
                      onClick={() => setSelectedId(preset.id)}
                      aria-current={preset.id === selected?.id}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
                        preset.id === selected?.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/60"
                      }`}
                    >
                      <CategoryDot preset={preset} />
                      <span className="truncate">{preset.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* --- Detail + orbit -------------------------------------- */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-3">
              {!selected ? (
                <p className="m-auto text-zinc-600">Select an object.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <CategoryDot preset={selected} />
                    <h3 className="truncate font-semibold text-zinc-100">{selected.name}</h3>
                    {selected.emissive && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-300">
                        emissive
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{selected.description}</p>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-y border-zinc-800 py-2 font-mono text-[10px]">
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Real mass</dt>
                      <dd>{selected.realMassKg}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Relative</dt>
                      <dd>{formatRelativeMass(selected.simMass)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Real radius</dt>
                      <dd>{formatRadius(selected.simRadius)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Sim mass</dt>
                      <dd>{num(spawnMass)}</dd>
                    </div>
                  </dl>

                  {/* Orbit builder */}
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
                      <Orbit size={12} className="text-sky-400" />
                      Orbit
                    </div>

                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">Host</span>
                      <select
                        value={host?.id ?? ""}
                        onChange={(e) => setHostPreference(e.target.value)}
                        className={`${INPUT} w-48`}
                      >
                        {hostOptions.length === 0 && <option value="">(empty scene)</option>}
                        {hostOptions.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">Periapsis</span>
                      <input
                        value={radiusInput}
                        onChange={(e) =>
                          setRadiusEntry({ presetId: selected.id, text: e.target.value })
                        }
                        placeholder={num(orbitRadius)}
                        inputMode="decimal"
                        className={`${INPUT} w-48 text-right font-mono`}
                      />
                    </label>

                    <label className="flex items-center justify-between gap-2 text-zinc-500">
                      <span>
                        Eccentricity <span className="font-mono text-zinc-300">{eccentricity.toFixed(2)}</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={MAX_ECCENTRICITY}
                        step={0.01}
                        value={eccentricity}
                        onChange={(e) => setEccentricity(Number(e.target.value))}
                        className="w-40"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-zinc-500">
                      <span>
                        Inclination <span className="font-mono text-zinc-300">{inclination}°</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={180}
                        step={1}
                        value={inclination}
                        onChange={(e) => setInclination(Number(e.target.value))}
                        className="w-40"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-zinc-500">
                      <span>
                        Phase <span className="font-mono text-zinc-300">{phase}°</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={359}
                        step={1}
                        value={phase}
                        onChange={(e) => setPhase(Number(e.target.value))}
                        className="w-40"
                      />
                    </label>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-500">
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={retrograde} onChange={(e) => setRetrograde(e.target.checked)} />
                        Retrograde
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={fixedOverride ?? selected.isFixed ?? false}
                          onChange={(e) => setFixedOverride(e.target.checked)}
                        />
                        Fixed
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={scaleToScene}
                          onChange={(e) => setScaleToScene(e.target.checked)}
                        />
                        Scale to scene
                      </label>
                    </div>

                    <p className="text-[10px] leading-relaxed text-zinc-600">
                      {scaleToScene && scale.referenceName
                        ? `Catalogue values (M☉ / AU) rescaled against ${scale.referenceName}: ×${num(scale.massScale)} mass, ×${num(scale.lengthScale)} length.`
                        : "Catalogue values used raw, in M☉ / AU."}
                    </p>
                  </div>

                  {/* Derived orbit readout */}
                  {orbit && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-zinc-800 bg-zinc-900/50 p-2 font-mono text-[10px]">
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Speed</dt>
                        <dd className="text-sky-300">{num(orbit.speed)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">v circular</dt>
                        <dd>{num(orbit.circularSpeed)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">v escape</dt>
                        <dd>{num(orbit.escapeSpeed)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Apoapsis</dt>
                        <dd>{num(orbit.apoapsis)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Semi-major</dt>
                        <dd>{num(orbit.semiMajorAxis)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Period</dt>
                        <dd>{periodLabel}</dd>
                      </div>
                    </dl>
                  )}

                  {warnings.map((warning) => (
                    <p key={warning} className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                      {warning}
                    </p>
                  ))}

                  <button
                    type="button"
                    onClick={launchPreset}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 py-1.5 font-medium hover:bg-sky-500"
                  >
                    <Rocket size={14} />
                    Launch {selected.name}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
