/**
 * Turns a catalogue entry into a `CelestialBody` placed on a real orbit.
 *
 * Two problems have to be solved between "user picked Europa" and "a body
 * appears in the scene", and they are separable:
 *
 *  1. UNITS. The catalogue is in M☉/AU (see `astronomical-presets`), but the
 *     loaded scene may be running at G = 1 with a central mass of 6000 and
 *     radii around 2. Dropping a 3×10⁻⁶ mass into that scene produces a body
 *     that is correct in the catalogue's units and meaningless in the scene's.
 *     `sceneScale()` measures the loaded scene against the canonical system
 *     and returns the mass/length factors that map one onto the other,
 *     preserving every ratio inside the catalogue.
 *
 *  2. STATE VECTORS. Users think in "put it in a circular orbit at r around
 *     that star", not in velocity components. `orbitalStateVectors()` does the
 *     two-body conversion, at periapsis of an orbit with the requested
 *     eccentricity and inclination.
 *
 * Both are pure functions of their arguments — no store access, no React — so
 * the UI can preview the result (speed, period, apoapsis) before committing.
 */

import {
  CANONICAL_REFERENCE_MASS,
  CANONICAL_REFERENCE_RADIUS,
  MIN_SIM_RADIUS,
  getPresetByName,
  type AstronomicalPreset,
} from '@/lib/data/astronomical-presets';
import type { CelestialBody, Vector3D } from '@/lib/physics/types';

// ---------------------------------------------------------------------------
// Scene scaling
// ---------------------------------------------------------------------------

export interface SceneScale {
  /** Multiply a catalogue `simMass` by this to get scene mass units. */
  massScale: number;
  /** Multiply a catalogue `simRadius` (or orbit radius) by this for scene length units. */
  lengthScale: number;
  /** Name of the body the scale was measured against; null for an empty scene. */
  referenceName: string | null;
}

export const CANONICAL_SCALE: SceneScale = {
  massScale: 1,
  lengthScale: 1,
  referenceName: null,
};

/**
 * Measures the loaded scene's unit system against the catalogue's.
 *
 * The heaviest body in the scene is the yardstick, and it is interpreted
 * against *its own* catalogue entry where one exists. That second half is not
 * a nicety — it is what makes this function idempotent, and without it the
 * whole scheme is broken:
 *
 *   Normalising against "the Sun is 1" instead means spawning Sagittarius A*
 *   (4.3×10⁶ M☉) makes it the heaviest body, so the *next* spawn measures a
 *   scale of 4.3×10⁶ and a second Sagittarius A* arrives at 1.8×10¹³ — four
 *   million times heavier than the first. The pair does not orbit; the lighter
 *   one is flung out of the scene.
 *
 * Dividing by the reference's catalogue mass instead gives a scale that is a
 * fixed point: spawn a catalogue body at scale S and the scene still measures
 * S afterwards, so repeated spawns compose. A body the catalogue does not know
 * (the toy presets' "Black Hole", a procedurally generated star) falls back to
 * being treated as one canonical Sun — and once a catalogue body is spawned
 * into that scene, it too becomes a fixed point.
 *
 * Deliberately keyed to a single body rather than, say, the scene's bounding
 * box: a scene's spatial extent depends on how far out its outermost body
 * happens to be, so a lone comet on a wide orbit would silently rescale
 * everything spawned afterwards.
 */
export function sceneScale(bodies: readonly CelestialBody[]): SceneScale {
  let reference: CelestialBody | null = null;
  for (const body of bodies) {
    if (!reference || body.mass > reference.mass) reference = body;
  }
  if (!reference || reference.mass <= 0 || reference.radius <= 0) return CANONICAL_SCALE;

  const known = getPresetByName(reference.name);
  const referenceMass = known ? known.simMass : CANONICAL_REFERENCE_MASS;
  const referenceRadius = known ? known.simRadius : CANONICAL_REFERENCE_RADIUS;

  return {
    massScale: reference.mass / referenceMass,
    lengthScale: reference.radius / referenceRadius,
    referenceName: reference.name,
  };
}

// ---------------------------------------------------------------------------
// Orbit placement
// ---------------------------------------------------------------------------

export interface OrbitSpec {
  /** Mass of the body being orbited, in scene units. */
  hostMass: number;
  hostPosition: Vector3D;
  hostVelocity: Vector3D;
  /** Mass of the spawned body, in scene units — folded into the two-body μ. */
  bodyMass: number;
  /** Periapsis distance from the host, in scene length units. Must be > 0. */
  periapsis: number;
  /** 0 = circular. Values ≥ 1 are unbound and are clamped by the caller's UI. */
  eccentricity: number;
  /**
   * Tilt of the orbit plane away from XZ, about the X axis, in degrees.
   *
   * Measured from the XZ plane — the plane every preset in the app lays its
   * orbits out in — so 0 means "coplanar with everything else", which is the
   * question the UI is actually asking. The classical element reported by
   * `computeOrbitalElements` is measured from +Z instead, so it reads as
   * (90° − this) for a prograde orbit. Same orbit, different reference plane.
   */
  inclinationDeg: number;
  /** Where on the orbit to place the body, in degrees around the host. */
  phaseDeg: number;
  /** Gravitational constant in scene units. */
  G: number;
  /** Orbit clockwise (as seen from +Y) instead of counter-clockwise. */
  retrograde?: boolean;
}

export interface OrbitResult {
  position: Vector3D;
  velocity: Vector3D;
  /** Speed at the spawn point (periapsis), in scene units. */
  speed: number;
  /** Speed a circular orbit at the same radius would need. */
  circularSpeed: number;
  /** Escape speed at the same radius. */
  escapeSpeed: number;
  /** Semi-major axis; Infinity for a parabolic/hyperbolic orbit. */
  semiMajorAxis: number;
  /** Apoapsis distance; Infinity when unbound. */
  apoapsis: number;
  /** Orbital period in scene time units; Infinity when unbound. */
  period: number;
}

/**
 * State vectors for a body released at periapsis of a two-body orbit.
 *
 * Uses μ = G(M + m), not G·M. For a spacecraft the difference is nil, but the
 * catalogue happily lets you put Sirius B in orbit around Sirius A, where the
 * reduced-mass correction is a 50% error in the period. The host is left
 * un-recoiled — adding the matching momentum to the host would silently edit a
 * body the user did not select — so the barycentre drifts slightly for
 * comparable masses. That is visible in the trails and is the honest depiction
 * of adding mass to a system that was already in balance.
 */
export function orbitalStateVectors(spec: OrbitSpec): OrbitResult {
  const {
    hostMass, hostPosition, hostVelocity, bodyMass,
    periapsis, eccentricity, inclinationDeg, phaseDeg, G, retrograde,
  } = spec;

  const r = Math.max(periapsis, 1e-12);
  const mu = G * (hostMass + bodyMass);
  const e = Math.max(0, eccentricity);

  // Vis-viva at periapsis of an orbit with semi-major axis a = r/(1-e):
  //   v² = μ(2/r − 1/a) = μ(1 + e)/r
  // which degenerates correctly to the circular case at e = 0 and to escape
  // speed at e = 1, so no special-casing is needed.
  const speed = Math.sqrt((mu * (1 + e)) / r);
  const circularSpeed = Math.sqrt(mu / r);
  const escapeSpeed = Math.SQRT2 * circularSpeed;

  const bound = e < 1;
  const semiMajorAxis = bound ? r / (1 - e) : Infinity;
  const apoapsis = bound ? (r * (1 + e)) / (1 - e) : Infinity;
  const period =
    bound && mu > 0 ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : Infinity;

  // Lay the orbit out in the XZ plane first — the same convention the presets
  // and the launch preview use — then tilt the whole plane about the X axis.
  const phase = (phaseDeg * Math.PI) / 180;
  const cosPhase = Math.cos(phase);
  const sinPhase = Math.sin(phase);
  const direction = retrograde ? -1 : 1;

  const px = r * cosPhase;
  const pz = r * sinPhase;
  const vx = direction * speed * sinPhase;
  const vz = direction * speed * -cosPhase;

  // Rotation about X by the inclination. Applied to position and velocity
  // alike, so |r|, |v| and the angle between them are all preserved and the
  // orbit stays the same orbit — just tilted.
  const inc = (inclinationDeg * Math.PI) / 180;
  const cosInc = Math.cos(inc);
  const sinInc = Math.sin(inc);

  return {
    position: {
      x: hostPosition.x + px,
      y: hostPosition.y - pz * sinInc,
      z: hostPosition.z + pz * cosInc,
    },
    velocity: {
      x: hostVelocity.x + vx,
      y: hostVelocity.y - vz * sinInc,
      z: hostVelocity.z + vz * cosInc,
    },
    speed,
    circularSpeed,
    escapeSpeed,
    semiMajorAxis,
    apoapsis,
    period,
  };
}

// ---------------------------------------------------------------------------
// Body construction
// ---------------------------------------------------------------------------

let spawnCounter = 0;

/** Unique id for a spawned body; the preset id is kept as a readable prefix. */
export function nextSpawnId(presetId: string): string {
  spawnCounter += 1;
  return `spawn-${presetId}-${spawnCounter}`;
}

/** Resets the id counter. Test-only — ids must stay unique within a session. */
export function resetSpawnCounter(): void {
  spawnCounter = 0;
}

export interface SpawnOptions {
  preset: AstronomicalPreset;
  scale: SceneScale;
  position: Vector3D;
  velocity: Vector3D;
  /** Overrides the preset's default; the UI exposes it as a checkbox. */
  isFixed?: boolean;
  /** Overrides the preset colour. */
  color?: string;
  /** Overrides the preset name (e.g. when spawning several of the same body). */
  name?: string;
}

/**
 * Builds the `CelestialBody` for a catalogue entry.
 *
 * Naming matters beyond the label: `profileForBody` in the texture library
 * looks up render profiles by lower-cased body name, so a body spawned as
 * "Jupiter" gets Jupiter's banded gas-giant surface and "Saturn" gets its
 * rings. Renaming the body is allowed but costs that lookup.
 */
export function buildSpawnedBody(options: SpawnOptions): CelestialBody {
  const { preset, scale, position, velocity, isFixed, color, name } = options;

  const body: CelestialBody = {
    id: nextSpawnId(preset.id),
    name: name?.trim() || preset.name,
    mass: preset.simMass * scale.massScale,
    radius: Math.max(preset.simRadius * scale.lengthScale, MIN_SIM_RADIUS),
    color: color ?? preset.color,
    position,
    velocity,
  };

  if (isFixed ?? preset.isFixed) body.isFixed = true;
  if (preset.category === 'black_holes') body.isBlackHole = true;

  return body;
}

/** Farthest any body sits from `origin`; 0 for an empty or single-body scene. */
export function sceneExtent(bodies: readonly CelestialBody[], origin: Vector3D): number {
  let extent = 0;
  for (const body of bodies) {
    const distance = Math.hypot(
      body.position.x - origin.x,
      body.position.y - origin.y,
      body.position.z - origin.z
    );
    if (distance > extent) extent = distance;
  }
  return extent;
}

/**
 * Catalogue orbit suggestion converted into the scene's length units, then
 * bounded at both ends.
 *
 * The floor exists because a moon's catalogue orbit is measured around its own
 * planet — put Phobos around the Sun and its 9,376 km orbit is inside the
 * photosphere.
 *
 * The ceiling exists because a catalogue distance can be right and useless at
 * the same time. The toy "Sun & Planet" preset puts its planet 3.3 stellar
 * radii out; Jupiter's real orbit is 1,119, so the faithful conversion spawns
 * it at ~3360 units in a scene that spans 10, where the user simply never sees
 * it again. Where the scene disagrees with astronomy about its own proportions,
 * the scene wins for the *default* — the periapsis field is right there, and
 * typing the true distance still does exactly what it says.
 */
export function suggestedOrbitRadius(
  preset: AstronomicalPreset,
  scale: SceneScale,
  hostRadius: number,
  extent = 0
): number {
  const suggested = (preset.defaultOrbitRadius ?? 1) * scale.lengthScale;
  const floor = (hostRadius + preset.simRadius * scale.lengthScale) * 3;
  const ceiling = extent > 0 ? Math.max(extent * 1.5, floor) : Infinity;
  return Math.min(Math.max(suggested, floor), ceiling);
}
