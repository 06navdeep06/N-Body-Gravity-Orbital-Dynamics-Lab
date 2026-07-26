/**
 * Built-in starting configurations. All presets share the convention that
 * orbital motion lies in the XZ plane (Y up), so bodies visibly orbit when
 * viewed from above and the default camera angle reads clearly.
 */

import { circularOrbitVelocity } from "@/lib/utils/orbital-velocity";
import type { Preset } from "@/lib/stores/simulation-store";
import type { CelestialBody } from "@/lib/physics/types";

/** Deterministic PRNG (mulberry32) so generated presets (belt, galaxy) are reproducible. */
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

let bodyCounter = 0;
function id(prefix: string): string {
  bodyCounter += 1;
  return `${prefix}-${bodyCounter}`;
}

function tangentialVelocity(radius: number, speed: number, clockwise = false): { x: number; y: number; z: number } {
  const sign = clockwise ? 1 : -1;
  return { x: 0, y: 0, z: sign * speed };
}

// ---------------------------------------------------------------------------
// 1. Sun & Planet — simplest possible circular orbit.
// ---------------------------------------------------------------------------
function sunAndPlanet(): Preset {
  const G = 1;
  const sunMass = 1000;
  const r = 20;
  const v = circularOrbitVelocity(sunMass, r, G);

  const bodies: CelestialBody[] = [
    { id: id("sun"), name: "Sun", mass: sunMass, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fbbf24", radius: 3, isFixed: true },
    { id: id("planet"), name: "Planet", mass: 1, position: { x: r, y: 0, z: 0 }, velocity: tangentialVelocity(r, v), color: "#60a5fa", radius: 0.6 },
  ];

  return {
    id: "sun-planet",
    name: "Sun & Planet",
    description: "The simplest two-body circular orbit.",
    state: { bodies, timeStep: 0.01, G, softening: 0.05 },
  };
}

// ---------------------------------------------------------------------------
// 2. Binary Star — two comparable masses orbiting their common barycenter.
// ---------------------------------------------------------------------------
function binaryStar(): Preset {
  const G = 1;
  const m1 = 500;
  const m2 = 300;
  const d = 15;
  const r1 = (m2 / (m1 + m2)) * d;
  const r2 = (m1 / (m1 + m2)) * d;
  const vRel = Math.sqrt((G * (m1 + m2)) / d);
  const v1 = (m2 / (m1 + m2)) * vRel;
  const v2 = (m1 / (m1 + m2)) * vRel;

  const bodies: CelestialBody[] = [
    { id: id("starA"), name: "Star A", mass: m1, position: { x: -r1, y: 0, z: 0 }, velocity: tangentialVelocity(r1, v1), color: "#f97316", radius: 2.2 },
    { id: id("starB"), name: "Star B", mass: m2, position: { x: r2, y: 0, z: 0 }, velocity: tangentialVelocity(r2, v2, true), color: "#f43f5e", radius: 1.8 },
  ];

  return {
    id: "binary-star",
    name: "Binary Star",
    description: "Two stars orbiting their common center of mass.",
    state: { bodies, timeStep: 0.008, G, softening: 0.05 },
  };
}

// ---------------------------------------------------------------------------
// 3. Figure-8 — the Chenciner-Montgomery equal-mass three-body choreography.
// ---------------------------------------------------------------------------
function figureEight(): Preset {
  const p1 = { x: 0.97000436, z: -0.24308753 };
  const v3 = { x: -0.93240737, z: -0.86473146 };

  const bodies: CelestialBody[] = [
    { id: id("f8-a"), name: "Body A", mass: 1, position: { x: p1.x, y: 0, z: p1.z }, velocity: { x: -v3.x / 2, y: 0, z: -v3.z / 2 }, color: "#34d399", radius: 0.35 },
    { id: id("f8-b"), name: "Body B", mass: 1, position: { x: -p1.x, y: 0, z: -p1.z }, velocity: { x: -v3.x / 2, y: 0, z: -v3.z / 2 }, color: "#a78bfa", radius: 0.35 },
    { id: id("f8-c"), name: "Body C", mass: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: v3.x, y: 0, z: v3.z }, color: "#fb7185", radius: 0.35 },
  ];

  return {
    id: "figure-eight",
    name: "Figure-8 Choreography",
    description: "Three equal masses tracing a closed figure-8 orbit.",
    state: { bodies, timeStep: 0.002, G: 1, softening: 0.01 },
  };
}

// ---------------------------------------------------------------------------
// 4. Mini Solar System — a sun with four planets at increasing radii.
// ---------------------------------------------------------------------------
function miniSolarSystem(): Preset {
  const G = 1;
  const sunMass = 2000;
  const planets = [
    { name: "Mercury", radius: 8, mass: 0.4, size: 0.35, color: "#a8a29e" },
    { name: "Venus", radius: 14, mass: 0.8, size: 0.5, color: "#f59e0b" },
    { name: "Earth", radius: 22, mass: 1, size: 0.55, color: "#3b82f6" },
    { name: "Mars", radius: 32, mass: 0.3, size: 0.4, color: "#ef4444" },
  ];

  const bodies: CelestialBody[] = [
    { id: id("sun"), name: "Sun", mass: sunMass, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fbbf24", radius: 3.5, isFixed: true },
    ...planets.map((p) => {
      const v = circularOrbitVelocity(sunMass, p.radius, G);
      const body: CelestialBody = {
        id: id(p.name.toLowerCase()),
        name: p.name,
        mass: p.mass,
        position: { x: p.radius, y: 0, z: 0 },
        velocity: tangentialVelocity(p.radius, v),
        color: p.color,
        radius: p.size,
      };
      return body;
    }),
  ];

  return {
    id: "mini-solar-system",
    name: "Mini Solar System",
    description: "A sun with four planets on circular orbits.",
    state: { bodies, timeStep: 0.006, G, softening: 0.05 },
  };
}

// ---------------------------------------------------------------------------
// 5. Asteroid Belt — a sun plus ~80 small bodies in a ring. Stresses the
//    instanced-rendering / octree performance path.
// ---------------------------------------------------------------------------
function asteroidBelt(): Preset {
  const G = 1;
  const sunMass = 3000;
  const rng = mulberry32(1337);
  const bodies: CelestialBody[] = [
    { id: id("sun"), name: "Sun", mass: sunMass, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fde047", radius: 4, isFixed: true },
  ];

  const count = 80;
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 15 + rng() * 10;
    const speed = circularOrbitVelocity(sunMass, radius, G) * (0.97 + rng() * 0.06);
    const mass = 0.01 + rng() * 0.05;
    const size = 0.08 + rng() * 0.1;

    bodies.push({
      id: id("asteroid"),
      name: `Asteroid ${i + 1}`,
      mass,
      position: { x: radius * Math.cos(angle), y: (rng() - 0.5) * 0.6, z: radius * Math.sin(angle) },
      velocity: { x: speed * Math.sin(angle), y: 0, z: -speed * Math.cos(angle) },
      color: "#a8a29e",
      radius: size,
    });
  }

  return {
    id: "asteroid-belt",
    name: "Asteroid Belt",
    description: "A sun with 80 small bodies — a performance stress test.",
    state: { bodies, timeStep: 0.006, G, softening: 0.1 },
  };
}

// ---------------------------------------------------------------------------
// 6. Galaxy Collision — two star clusters on a collision course.
// ---------------------------------------------------------------------------
function galaxyCollision(): Preset {
  const G = 1;
  const rng = mulberry32(2024);
  const bodies: CelestialBody[] = [];

  function makeCluster(centerX: number, centerVz: number, coreMass: number, coreColor: string, starColor: string, count: number) {
    const coreId = id("core");
    bodies.push({
      id: coreId,
      name: `Core ${coreId}`,
      mass: coreMass,
      position: { x: centerX, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: centerVz },
      color: coreColor,
      radius: 2.5,
    });

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 4 + rng() * 12;
      const orbitalSpeed = circularOrbitVelocity(coreMass, radius, G);
      bodies.push({
        id: id("star"),
        name: `Star ${i + 1}`,
        mass: 0.05 + rng() * 0.15,
        position: {
          x: centerX + radius * Math.cos(angle),
          y: (rng() - 0.5) * 1.5,
          z: radius * Math.sin(angle),
        },
        velocity: {
          x: orbitalSpeed * Math.sin(angle),
          y: 0,
          z: centerVz - orbitalSpeed * Math.cos(angle),
        },
        color: starColor,
        radius: 0.12 + rng() * 0.08,
      });
    }
  }

  makeCluster(-40, 3, 4000, "#60a5fa", "#bfdbfe", 45);
  makeCluster(40, -3, 3500, "#f97316", "#fed7aa", 45);

  return {
    id: "galaxy-collision",
    name: "Galaxy Collision",
    description: "Two star clusters of ~45 bodies each on a collision course.",
    state: { bodies, timeStep: 0.004, G, softening: 0.3 },
  };
}

// ---------------------------------------------------------------------------
// 7. Mercury Precession — eccentric orbit with GR precession enabled.
// ---------------------------------------------------------------------------
function mercuryPrecession(): Preset {
  const G = 1;
  const starMass = 5000;
  const a = 15;
  const e = 0.2;
  const periapsis = a * (1 - e);
  const vPeriapsis = Math.sqrt(((G * starMass) / a) * ((1 + e) / (1 - e)));

  const bodies: CelestialBody[] = [
    { id: id("star"), name: "Star", mass: starMass, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, color: "#fde68a", radius: 3, isFixed: true },
    { id: id("mercury"), name: "Mercury", mass: 0.5, position: { x: periapsis, y: 0, z: 0 }, velocity: tangentialVelocity(periapsis, vPeriapsis), color: "#94a3b8", radius: 0.4 },
  ];

  return {
    id: "mercury-precession",
    name: "Mercury Precession",
    description: "An eccentric orbit (e≈0.2) with GR precession enabled — watch the ellipse slowly rotate.",
    state: { bodies, timeStep: 0.004, G, softening: 0.02 },
    enableGR: true,
    speedOfLight: 300,
  };
}

export const PRESETS: Preset[] = [
  sunAndPlanet(),
  binaryStar(),
  figureEight(),
  miniSolarSystem(),
  asteroidBelt(),
  galaxyCollision(),
  mercuryPrecession(),
];

export function getPresetById(presetId: string): Preset | undefined {
  return PRESETS.find((p) => p.id === presetId);
}
