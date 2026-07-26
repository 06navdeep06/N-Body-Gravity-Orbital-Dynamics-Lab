/**
 * High-fidelity Solar System dataset in heliocentric units:
 *
 *   length = AU, mass = solar masses, time = years  =>  G = 4π² ≈ 39.478
 *
 * In these units a body on a circular orbit at 1 AU around 1 M_sun moves at
 * exactly 2π AU/yr — Earth's year falls out for free, which makes the
 * "sim time in Earth days/years" display exact rather than calibrated.
 *
 * Masses are IAU/JPL values converted to solar masses; orbital radii are
 * mean distances; eccentric bodies (Mercury, Pluto, Halley) are placed at
 * perihelion with the corresponding vis-viva speed. Physical radii are TRUE
 * scale in AU — at 1x the planets are invisible dots, which is the honest
 * picture; the store's `visualRadiusScale` exaggerates them for display
 * without touching the physics.
 */

import type { CelestialBody, SystemState } from "@/lib/physics/types";
import type { Preset } from "@/lib/stores/simulation-store";

export const G_SOLAR = 4 * Math.PI * Math.PI; // AU^3 / (M_sun * yr^2)

const AU_KM = 1.496e8;
/** Converts a physical radius in km to AU. */
const kmR = (km: number): number => km / AU_KM;

let idCounter = 0;
function id(prefix: string): string {
  idCounter += 1;
  return `ss-${prefix}-${idCounter}`;
}

/** Speed for a circular orbit of radius r (AU) around mass M (M_sun). */
function vCircular(M: number, r: number): number {
  return Math.sqrt((G_SOLAR * M) / r);
}

/** Vis-viva speed at distance r on an orbit of semi-major axis a around M. */
function vVisViva(M: number, r: number, a: number): number {
  return Math.sqrt(G_SOLAR * M * (2 / r - 1 / a));
}

/**
 * Places a body on a counter-clockwise (viewed from +Y) orbit in the XZ
 * plane at polar angle `angle`, moving tangentially at speed `v`, relative
 * to a parent at `parent` position/velocity.
 */
function onOrbit(
  angle: number,
  r: number,
  v: number,
  parentPos = { x: 0, y: 0, z: 0 },
  parentVel = { x: 0, y: 0, z: 0 }
) {
  return {
    position: {
      x: parentPos.x + r * Math.cos(angle),
      y: parentPos.y,
      z: parentPos.z + r * Math.sin(angle),
    },
    velocity: {
      x: parentVel.x + v * Math.sin(angle),
      y: parentVel.y,
      z: parentVel.z - v * Math.cos(angle),
    },
  };
}

interface PlanetSpec {
  name: string;
  mass: number; // M_sun
  orbitRadius: number; // AU (mean, or perihelion when `semiMajorAxis` given)
  semiMajorAxis?: number; // AU, for eccentric bodies
  radiusKm: number;
  color: string;
  angleDeg: number; // arbitrary but spread out so bodies don't start aligned
}

const SUN_MASS = 1;

const PLANETS: PlanetSpec[] = [
  { name: "Mercury", mass: 1.6601e-7, orbitRadius: 0.3075, semiMajorAxis: 0.3871, radiusKm: 2439.7, color: "#9c9c94", angleDeg: 0 },
  { name: "Venus", mass: 2.4478e-6, orbitRadius: 0.7233, radiusKm: 6051.8, color: "#e6c89c", angleDeg: 45 },
  { name: "Earth", mass: 3.0035e-6, orbitRadius: 1.0, radiusKm: 6371.0, color: "#4f94cd", angleDeg: 100 },
  { name: "Mars", mass: 3.2272e-7, orbitRadius: 1.5237, radiusKm: 3389.5, color: "#c1440e", angleDeg: 160 },
  { name: "Jupiter", mass: 9.5479e-4, orbitRadius: 5.2044, radiusKm: 69911, color: "#d8ca9d", angleDeg: 210 },
  { name: "Saturn", mass: 2.8583e-4, orbitRadius: 9.5826, radiusKm: 58232, color: "#ead6b8", angleDeg: 270 },
  { name: "Uranus", mass: 4.3662e-5, orbitRadius: 19.191, radiusKm: 25362, color: "#afdbf5", angleDeg: 320 },
  { name: "Neptune", mass: 5.1514e-5, orbitRadius: 30.07, radiusKm: 24622, color: "#4166f5", angleDeg: 20 },
  { name: "Pluto", mass: 6.5809e-9, orbitRadius: 29.658, semiMajorAxis: 39.482, radiusKm: 1188.3, color: "#c9b29b", angleDeg: 65 },
  { name: "Ceres", mass: 4.7191e-10, orbitRadius: 2.77, radiusKm: 469.7, color: "#8c8c8c", angleDeg: 130 },
];

interface MoonSpec {
  name: string;
  parent: string;
  mass: number;
  orbitRadius: number; // AU from parent
  radiusKm: number;
  color: string;
  angleDeg: number;
}

const MOONS: MoonSpec[] = [
  { name: "Moon", parent: "Earth", mass: 3.6943e-8, orbitRadius: 0.002570, radiusKm: 1737.4, color: "#bfbdb8", angleDeg: 0 },
  { name: "Io", parent: "Jupiter", mass: 4.4898e-8, orbitRadius: 0.002819, radiusKm: 1821.6, color: "#ffe08a", angleDeg: 0 },
  { name: "Europa", parent: "Jupiter", mass: 2.4132e-8, orbitRadius: 0.004486, radiusKm: 1560.8, color: "#d9c7a0", angleDeg: 90 },
  { name: "Ganymede", parent: "Jupiter", mass: 7.4508e-8, orbitRadius: 0.007155, radiusKm: 2634.1, color: "#a89f91", angleDeg: 180 },
  { name: "Callisto", parent: "Jupiter", mass: 5.4102e-8, orbitRadius: 0.012585, radiusKm: 2410.3, color: "#7a7265", angleDeg: 270 },
];

/** Deterministic PRNG so Saturn's ring particle placement is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSolarSystem(): SystemState {
  idCounter = 0;
  const bodies: CelestialBody[] = [];

  bodies.push({
    id: id("sun"),
    name: "Sun",
    mass: SUN_MASS,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    color: "#fdb813",
    radius: kmR(696000),
    isFixed: true,
  });

  const planetsByName = new Map<string, CelestialBody>();

  for (const p of PLANETS) {
    const angle = (p.angleDeg * Math.PI) / 180;
    const v = p.semiMajorAxis
      ? vVisViva(SUN_MASS, p.orbitRadius, p.semiMajorAxis)
      : vCircular(SUN_MASS, p.orbitRadius);
    const { position, velocity } = onOrbit(angle, p.orbitRadius, v);
    const body: CelestialBody = {
      id: id(p.name.toLowerCase()),
      name: p.name,
      mass: p.mass,
      position,
      velocity,
      color: p.color,
      radius: kmR(p.radiusKm),
    };
    bodies.push(body);
    planetsByName.set(p.name, body);
  }

  for (const m of MOONS) {
    const parent = planetsByName.get(m.parent)!;
    const angle = (m.angleDeg * Math.PI) / 180;
    const v = vCircular(parent.mass, m.orbitRadius);
    const { position, velocity } = onOrbit(angle, m.orbitRadius, v, parent.position, parent.velocity);
    bodies.push({
      id: id(m.name.toLowerCase()),
      name: m.name,
      mass: m.mass,
      position,
      velocity,
      color: m.color,
      radius: kmR(m.radiusKm),
    });
  }

  // Halley's Comet: a = 17.834 AU, e = 0.967 -> perihelion 0.586 AU.
  {
    const a = 17.834;
    const e = 0.967;
    const rp = a * (1 - e);
    const v = vVisViva(SUN_MASS, rp, a);
    const { position, velocity } = onOrbit((250 * Math.PI) / 180, rp, v);
    bodies.push({
      id: id("halley"),
      name: "Halley's Comet",
      mass: 1.1e-16,
      position,
      velocity,
      color: "#b8e0ff",
      radius: kmR(5.5),
    });
  }

  // Saturn's rings: 200 nearly massless particles between ~1.24 and ~2.4
  // Saturn radii (roughly the C ring through the A ring).
  {
    const saturn = planetsByName.get("Saturn")!;
    const rng = mulberry32(60918);
    const inner = kmR(74500);
    const outer = kmR(140200);
    for (let i = 0; i < 200; i++) {
      const angle = rng() * Math.PI * 2;
      const r = inner + rng() * (outer - inner);
      const v = vCircular(saturn.mass, r);
      const { position, velocity } = onOrbit(angle, r, v, saturn.position, saturn.velocity);
      bodies.push({
        id: id("ring"),
        name: `Ring particle ${i + 1}`,
        mass: 1e-18,
        position,
        velocity,
        color: "#d6c9a8",
        radius: kmR(20),
      });
    }
  }

  return {
    bodies,
    // ~10 minutes per step: Saturn's innermost ring particles orbit in
    // ~7 hours, and RK4 needs ≳40 steps/orbit to hold them — at 1e-4 yr
    // (only ~8 steps/orbit) integration error visibly rains them onto
    // Saturn within simulated days. Raise timestep/steps-per-frame in the
    // sidebar to trade fidelity for speed.
    timeStep: 2e-5,
    G: G_SOLAR,
    softening: 1e-5,
  };
}

export const REAL_SOLAR_SYSTEM_PRESET: Preset = {
  id: "real-solar-system",
  name: "Real Solar System",
  description:
    "Sun, 8 planets, major moons, Saturn's rings, Pluto, Ceres and Halley's Comet with real masses and orbits (AU / M☉ / years). Use the radius-scale slider — at 1x planets are true-scale dots.",
  state: buildSolarSystem(),
  visualRadiusScale: 1000,
  maxDisplayRadius: 0.5,
  timeUnit: { label: "yr", earthDaysPerUnit: 365.25 },
};
