/**
 * Black-hole presets.
 *
 * Both pick a simulation speed of light `c` small enough that the
 * Schwarzschild radius r_s = 2GM/c² is a visible fraction of the scene —
 * with real c the horizon of a stellar-mass hole is microscopic next to its
 * orbit, and nothing would be on screen.
 */

import { circularOrbitVelocity } from "@/lib/utils/orbital-velocity";
import type { CelestialBody } from "@/lib/physics/types";
import type { Preset } from "@/lib/stores/simulation-store";

/** Deterministic PRNG so disk particle layouts are reproducible. */
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

let counter = 0;
const id = (prefix: string) => `bh-${prefix}-${++counter}`;

/** Tangential (counter-clockwise seen from +Y) velocity at polar angle. */
function tangential(angle: number, speed: number) {
  return { x: speed * Math.sin(angle), y: 0, z: -speed * Math.cos(angle) };
}

function onCircularOrbit(angle: number, radius: number, centralMass: number, G: number) {
  const speed = circularOrbitVelocity(centralMass, radius, G);
  return {
    position: { x: radius * Math.cos(angle), y: 0, z: radius * Math.sin(angle) },
    velocity: tangential(angle, speed),
  };
}

// ---------------------------------------------------------------------------
// Black Hole Accretion
// ---------------------------------------------------------------------------
function blackHoleAccretion(): Preset {
  const G = 1;
  const M = 6000;
  // c chosen so r_s ≈ 2.4: the disk (out to 10 r_s) and the plunging stars
  // then span ~50 units, which fits the default camera framing instead of
  // putting the viewpoint inside the disk.
  const c = 70;
  const rs = (2 * G * M) / (c * c);
  const rng = mulberry32(9182);

  const bodies: CelestialBody[] = [
    {
      id: id("core"),
      name: "Black Hole",
      mass: M,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      color: "#000000",
      radius: rs,
      isFixed: true,
      isBlackHole: true,
    },
  ];

  // Disk particles seeded between the ISCO-ish 3 r_s and 10 r_s, matching the
  // rendered accretion disk's extent.
  for (let i = 0; i < 50; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = rs * (3 + rng() * 7);
    const { position, velocity } = onCircularOrbit(angle, radius, M, G);
    bodies.push({
      id: id("gas"),
      name: `Disk particle ${i + 1}`,
      mass: 0.02 + rng() * 0.05,
      position: { ...position, y: (rng() - 0.5) * rs * 0.12 },
      velocity,
      color: "#ffb877",
      radius: 0.18 + rng() * 0.14,
    });
  }

  // Two stars on eccentric plunging orbits — they cross inside the Roche
  // limit and get torn apart / swallowed.
  for (const [i, r] of [rs * 14, rs * 19].entries()) {
    const angle = i === 0 ? 0.7 : 3.6;
    const { position } = onCircularOrbit(angle, r, M, G);
    // 62% of circular speed => strongly eccentric, periapsis deep inside.
    const speed = circularOrbitVelocity(M, r, G) * 0.62;
    bodies.push({
      id: id("star"),
      name: `Doomed Star ${i + 1}`,
      mass: 12,
      position,
      velocity: tangential(angle, speed),
      color: i === 0 ? "#9fd0ff" : "#ffd39f",
      radius: 1.1,
    });
  }

  return {
    id: "black-hole-accretion",
    name: "Black Hole Accretion",
    description:
      "A 6000-mass black hole (r_s ≈ 2.4) with a 50-particle accretion disk and two stars on plunging orbits. Enable Roche limits to watch the tidal disruption zone.",
    state: { bodies, timeStep: 0.002, G, softening: 0.4 },
    speedOfLight: c,
  };
}

// ---------------------------------------------------------------------------
// Binary Black Hole Inspiral
// ---------------------------------------------------------------------------
function binaryBlackHoleInspiral(): Preset {
  const G = 1;
  const m = 2500; // each
  // r_s ≈ 3.1 per hole, so the pair plus their disks frame comfortably.
  const c = 40;
  const rs = (2 * G * m) / (c * c);
  const separation = rs * 5.5;
  const r = separation / 2;

  // Equal masses: each orbits the barycenter at half the separation with
  // v = sqrt(G*m_total/(2*separation)) — the two-body circular solution.
  const vRel = Math.sqrt((G * (2 * m)) / separation);
  const speed = vRel / 2;

  const bodies: CelestialBody[] = [
    {
      id: id("bhA"),
      name: "Black Hole A",
      mass: m,
      position: { x: -r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: -speed },
      color: "#000000",
      radius: rs,
      isBlackHole: true,
    },
    {
      id: id("bhB"),
      name: "Black Hole B",
      mass: m,
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: speed },
      color: "#000000",
      radius: rs,
      isBlackHole: true,
    },
  ];

  return {
    id: "binary-bh-inspiral",
    name: "Binary Black Hole Inspiral",
    description:
      "Two equal-mass black holes at 5.5 r_s separation with GR precession on. The GW strain plot chirps as the orbit tightens.",
    // dt 0.004 still gives ~1600 RK4 steps per orbit (far more than needed
    // for accuracy) while advancing fast enough that a full GW cycle is
    // visible in the strain plot within a few seconds of wall time.
    state: { bodies, timeStep: 0.004, G, softening: 0.05 },
    enableGR: true,
    speedOfLight: c,
  };
}

// ---------------------------------------------------------------------------
// Tidal Disruption Event
// ---------------------------------------------------------------------------
function tidalDisruptionEvent(): Preset {
  const G = 1;
  const M = 2e6; // supermassive
  const c = 900; // r_s = 2GM/c^2 ≈ 4.94
  const rs = (2 * G * M) / (c * c);

  // Star on a near-parabolic plunge: apoapsis far out, periapsis inside the
  // Roche limit so it shreds on its first pass.
  const star = { mass: 1, radius: 0.9 };
  const apoapsis = 260;
  // Roche limit for this pair is ~2.44*R_bh*(rho_bh/rho_star)^(1/3); aim the
  // periapsis comfortably inside it.
  const periapsis = 26;
  const a = (apoapsis + periapsis) / 2;
  const e = (apoapsis - periapsis) / (apoapsis + periapsis);
  // Vis-viva at apoapsis, where the star starts.
  const vApo = Math.sqrt(G * M * (2 / apoapsis - 1 / a));

  const bodies: CelestialBody[] = [
    {
      id: id("smbh"),
      name: "Supermassive Black Hole",
      mass: M,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      color: "#000000",
      radius: rs,
      isFixed: true,
      isBlackHole: true,
    },
    {
      id: id("victim"),
      name: "Doomed Star",
      mass: star.mass,
      position: { x: apoapsis, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: -vApo },
      color: "#ffd27f",
      radius: star.radius,
    },
  ];

  return {
    id: "tidal-disruption",
    name: "Tidal Disruption Event",
    description: `A star falls from ${apoapsis} onto a supermassive black hole (e≈${e.toFixed(2)}). At periapsis the tidal field beats its self-gravity and it shreds into a stream. Tidal disruption is enabled automatically.`,
    state: { bodies, timeStep: 0.004, G, softening: 0.05 },
    speedOfLight: c,
    enableTidalDisruption: true,
  };
}

export const BLACK_HOLE_PRESETS: Preset[] = [
  blackHoleAccretion(),
  binaryBlackHoleInspiral(),
  tidalDisruptionEvent(),
];
