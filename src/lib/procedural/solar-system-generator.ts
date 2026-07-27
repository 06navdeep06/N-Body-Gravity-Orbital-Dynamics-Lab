/**
 * Procedural star-system generator.
 *
 * Produces systems that look like the ones we actually observe: planets on
 * geometrically-spaced orbits (Titius-Bode-like), near-circular and
 * near-coplanar with Rayleigh-distributed excursions, moons confined well
 * inside their planet's Hill sphere, and an optional asteroid belt.
 */

import { hillSphereRadius } from "@/lib/physics/tidal";
import type { CelestialBody, SystemState, Vector3D } from "@/lib/physics/types";
import { createRng, stellarColor, type Rng } from "./random";

export interface SolarSystemParams {
  seed: number;
  starMassMin: number;
  starMassMax: number;
  planetCountMin: number;
  planetCountMax: number;
  /** Probability that any given planet gets a moon system. */
  moonProbability: number;
  maxMoonsPerPlanet: number;
  includeAsteroidBelt: boolean;
  /** Rayleigh σ for orbital eccentricity. */
  eccentricitySigma: number;
  /** Rayleigh σ for orbital inclination, in degrees. */
  inclinationSigmaDeg: number;
}

export const DEFAULT_SOLAR_SYSTEM_PARAMS: SolarSystemParams = {
  seed: 1,
  starMassMin: 0.3,
  starMassMax: 30,
  planetCountMin: 2,
  planetCountMax: 12,
  moonProbability: 0.4,
  maxMoonsPerPlanet: 5,
  includeAsteroidBelt: true,
  eccentricitySigma: 0.05,
  inclinationSigmaDeg: 2,
};

/** Simulation units: G = 1, star masses scaled so a 1 M☉ star has mass 1000. */
const MASS_SCALE = 1000;
const G = 1;

/**
 * Places a body on a Keplerian orbit given its elements, starting at a
 * random true anomaly. Returns position and velocity relative to the parent.
 */
function stateFromElements(
  rng: Rng,
  parentMass: number,
  a: number,
  e: number,
  inclinationRad: number
): { position: Vector3D; velocity: Vector3D } {
  const nu = rng.range(0, Math.PI * 2);
  const mu = G * parentMass;
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(nu));

  // Perifocal frame, then rotate by inclination about the X axis and by a
  // random longitude of ascending node about Y.
  const xPeri = r * Math.cos(nu);
  const zPeri = r * Math.sin(nu);
  const h = Math.sqrt(mu * p);
  const vxPeri = -(mu / h) * Math.sin(nu);
  const vzPeri = (mu / h) * (e + Math.cos(nu));

  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  const raan = rng.range(0, Math.PI * 2);
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);

  const rotate = (px: number, pz: number): Vector3D => {
    // Inclination tilts the orbital plane about the line of nodes.
    const y = pz * sinI;
    const zTilted = pz * cosI;
    return {
      x: px * cosO - zTilted * sinO,
      y,
      z: px * sinO + zTilted * cosO,
    };
  };

  return { position: rotate(xPeri, zPeri), velocity: rotate(vxPeri, vzPeri) };
}

/** Visual radius from mass, assuming a common density. */
function radiusFromMass(mass: number, densityScale = 1): number {
  return Math.max(0.12, Math.cbrt(mass / densityScale) * 0.55);
}

const PLANET_COLORS = [
  "#c1440e", "#4f94cd", "#e6c89c", "#d8ca9d", "#afdbf5",
  "#9c9c94", "#4166f5", "#c9b29b", "#7fb08a", "#b57edc",
];

export function generateSolarSystem(partial: Partial<SolarSystemParams> = {}): SystemState {
  const params: SolarSystemParams = { ...DEFAULT_SOLAR_SYSTEM_PARAMS, ...partial };
  const rng = createRng(params.seed);
  const bodies: CelestialBody[] = [];

  const starSolarMasses = rng.range(params.starMassMin, params.starMassMax);
  const starMass = starSolarMasses * MASS_SCALE;

  bodies.push({
    id: "star",
    name: "Star",
    mass: starMass,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    color: stellarColor(starSolarMasses),
    radius: Math.max(1.6, Math.cbrt(starSolarMasses) * 2.2),
    isFixed: true,
  });

  // Titius-Bode-like geometric spacing: a_n = a0·α^n + β.
  const planetCount = rng.int(params.planetCountMin, params.planetCountMax);
  const a0 = rng.range(8, 16);
  const alpha = rng.range(1.4, 2.2);
  const beta = rng.range(-2, 4);

  const planets: { body: CelestialBody; a: number }[] = [];

  for (let n = 0; n < planetCount; n++) {
    const a = a0 * Math.pow(alpha, n * 0.55) + beta;
    if (a <= 0) continue;

    // Log-uniform planet mass between 1e-6 and 1e-2 of the star.
    const massFraction = Math.pow(10, rng.range(-6, -2));
    const mass = starMass * massFraction;

    const e = Math.min(0.75, rng.rayleigh(params.eccentricitySigma));
    const inclination = (rng.rayleigh(params.inclinationSigmaDeg) * Math.PI) / 180;

    const { position, velocity } = stateFromElements(rng, starMass, a, e, inclination);
    const planet: CelestialBody = {
      id: `planet-${n}`,
      name: `Planet ${String.fromCharCode(98 + n)}`, // b, c, d… as in exoplanet naming
      mass,
      position,
      velocity,
      color: PLANET_COLORS[n % PLANET_COLORS.length]!,
      radius: radiusFromMass(mass, 0.02),
    };
    bodies.push(planet);
    planets.push({ body: planet, a });
  }

  // --- Moons, constrained to a fraction of the Hill sphere ---------------
  for (const { body: planet, a } of planets) {
    if (!rng.chance(params.moonProbability)) continue;
    const moonCount = rng.int(1, params.maxMoonsPerPlanet);
    const star = bodies[0]!;
    const hill = hillSphereRadius(planet, star);
    // Beyond ~1/3 of the Hill radius, moon orbits are not long-term stable.
    const maxMoonOrbit = hill * 0.33;
    const minMoonOrbit = planet.radius * 2.5;
    if (maxMoonOrbit <= minMoonOrbit) continue;

    for (let m = 0; m < moonCount; m++) {
      const moonA = rng.range(minMoonOrbit, maxMoonOrbit);
      const moonMass = planet.mass * Math.pow(10, rng.range(-4, -1.5));
      const e = Math.min(0.4, rng.rayleigh(0.02));
      const inclination = (rng.rayleigh(3) * Math.PI) / 180;

      const local = stateFromElements(rng, planet.mass, moonA, e, inclination);
      bodies.push({
        id: `${planet.id}-moon-${m}`,
        name: `${planet.name} ${["I", "II", "III", "IV", "V"][m] ?? m + 1}`,
        mass: moonMass,
        position: {
          x: planet.position.x + local.position.x,
          y: planet.position.y + local.position.y,
          z: planet.position.z + local.position.z,
        },
        velocity: {
          x: planet.velocity.x + local.velocity.x,
          y: planet.velocity.y + local.velocity.y,
          z: planet.velocity.z + local.velocity.z,
        },
        color: "#b8b8b0",
        radius: Math.max(0.06, radiusFromMass(moonMass, 0.02) * 0.6),
      });
    }
    void a;
  }

  // --- Asteroid belt between two adjacent planets ------------------------
  if (params.includeAsteroidBelt && planets.length >= 3 && rng.chance(0.6)) {
    const gapIndex = rng.int(1, planets.length - 2);
    const inner = planets[gapIndex]!.a;
    const outer = planets[gapIndex + 1]!.a;
    const count = rng.int(50, 200);

    for (let i = 0; i < count; i++) {
      const a = rng.range(inner * 1.08, outer * 0.92);
      if (a <= 0) continue;
      const e = Math.min(0.35, rng.rayleigh(0.06));
      const inclination = (rng.rayleigh(6) * Math.PI) / 180;
      const { position, velocity } = stateFromElements(rng, starMass, a, e, inclination);
      bodies.push({
        id: `asteroid-${i}`,
        name: `Asteroid ${i + 1}`,
        mass: starMass * 1e-9,
        position,
        velocity,
        color: "#9a948c",
        radius: 0.08,
      });
    }
  }

  return { bodies, timeStep: 0.004, G, softening: 0.08 };
}
