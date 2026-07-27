/**
 * Catalogue integrity and the spawn maths behind the "Add Body" builder.
 *
 * The catalogue tests are structural (no duplicate ids, every field populated,
 * masses in the right ballpark) — they exist so a typo in a mantissa or a
 * copy-pasted id is caught rather than shipped as a body that silently sits at
 * the wrong scale. The spawn tests check that a launched body is actually on
 * the orbit the UI claimed it would be on.
 */

import {
  ASTRONOMICAL_PRESETS,
  AU_KM,
  EARTH_MASS_KG,
  JUPITER_MASS_KG,
  MIN_SIM_RADIUS,
  PRESET_CATEGORIES,
  SOLAR_MASS_KG,
  formatKilograms,
  getPresetById,
  getPresetsByCategory,
  schwarzschildRadiusKm,
  searchPresets,
  type PresetCategory,
} from "@/lib/data/astronomical-presets";
import {
  CANONICAL_SCALE,
  buildSpawnedBody,
  orbitalStateVectors,
  sceneScale,
  suggestedOrbitRadius,
} from "@/lib/data/preset-spawn";
import { computeOrbitalElements } from "@/lib/physics/orbital-elements";
import type { CelestialBody } from "@/lib/physics/types";

const byId = (id: string) => {
  const preset = getPresetById(id);
  if (!preset) throw new Error(`missing preset: ${id}`);
  return preset;
};

describe("astronomical preset catalogue", () => {
  it("has unique ids and populated fields", () => {
    const ids = new Set<string>();
    for (const preset of ASTRONOMICAL_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);

      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(20);
      expect(preset.realMassKg).toMatch(/kg$/);
      expect(preset.simMass).toBeGreaterThan(0);
      expect(Number.isFinite(preset.simMass)).toBe(true);
      expect(preset.simRadius).toBeGreaterThanOrEqual(MIN_SIM_RADIUS);
      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("covers every category the tabs advertise, apart from custom", () => {
    for (const category of PRESET_CATEGORIES) {
      const count = getPresetsByCategory(category.id).length;
      if (category.id === "custom") expect(count).toBe(0);
      else expect(count).toBeGreaterThanOrEqual(8);
    }
  });

  it("includes every object named in the spec", () => {
    const required: Record<PresetCategory, string[]> = {
      planets: ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"],
      dwarf_planets: ["Pluto", "Eris", "Haumea", "Makemake", "Ceres"],
      moons: [
        "Moon", "Io", "Europa", "Ganymede", "Callisto",
        "Titan", "Enceladus", "Triton", "Phobos", "Deimos",
      ],
      stars: [
        "Sun", "Proxima Centauri", "Sirius A", "Sirius B", "Betelgeuse",
        "Rigel", "R136a1", "TRAPPIST-1", "UY Scuti", "PSR J0740+6620",
      ],
      black_holes: ["Sagittarius A*", "M87*", "Cygnus X-1", "GW150914 A", "GW150914 B"],
      exoplanets_comets: [
        "TRAPPIST-1e", "Kepler-452b", "HD 189733b", "'Oumuamua",
        "Halley's Comet", "16 Psyche", "4 Vesta", "101955 Bennu",
      ],
      spacecraft: [
        "International Space Station", "Hubble Space Telescope",
        "James Webb Space Telescope", "Voyager 1", "GPS Satellite",
      ],
      custom: [],
    };

    for (const [category, names] of Object.entries(required)) {
      const present = new Set(
        getPresetsByCategory(category as PresetCategory).map((p) => p.name)
      );
      for (const name of names) expect(present).toContain(name);
    }
  });

  it("stores masses in solar masses, matching the published kilogram figures", () => {
    expect(byId("sun").simMass).toBeCloseTo(1, 6);
    expect(byId("earth").simMass * SOLAR_MASS_KG).toBeCloseTo(EARTH_MASS_KG, -20);
    // Jupiter is 317.8 Earths; getting this wrong is the classic mantissa typo.
    expect((byId("jupiter").simMass * SOLAR_MASS_KG) / EARTH_MASS_KG).toBeCloseTo(317.8, 0);
    expect((byId("jupiter").simMass * SOLAR_MASS_KG) / JUPITER_MASS_KG).toBeCloseTo(1, 3);
    // Sgr A* is 4.297 million suns.
    expect(byId("sgr-a-star").simMass / 1e6).toBeCloseTo(4.297, 2);
  });

  it("stores radii in AU", () => {
    expect(byId("earth").simRadius * AU_KM).toBeCloseTo(6371, 0);
    expect(byId("sun").simRadius * AU_KM).toBeCloseTo(695700, 0);
    expect(byId("jupiter").simRadius).toBeGreaterThan(byId("earth").simRadius * 10);
  });

  it("sizes compact objects by their Schwarzschild radius", () => {
    // Sgr A*: 2GM/c² ≈ 1.27e7 km ≈ 0.085 AU.
    expect(byId("sgr-a-star").simRadius).toBeCloseTo(0.0849, 3);
    // A 10 M☉ hole has a ~30 km horizon.
    expect(schwarzschildRadiusKm(10 * SOLAR_MASS_KG)).toBeCloseTo(29.5, 0);
    // The primordial hole's true horizon is below the floor, so it is clamped.
    expect(byId("micro-bh").simRadius).toBe(MIN_SIM_RADIUS);
  });

  it("orders masses sensibly across categories", () => {
    expect(byId("sun").simMass).toBeGreaterThan(byId("jupiter").simMass);
    expect(byId("jupiter").simMass).toBeGreaterThan(byId("earth").simMass);
    expect(byId("earth").simMass).toBeGreaterThan(byId("moon").simMass);
    expect(byId("moon").simMass).toBeGreaterThan(byId("ceres").simMass);
    expect(byId("ceres").simMass).toBeGreaterThan(byId("bennu").simMass);
    expect(byId("bennu").simMass).toBeGreaterThan(byId("iss").simMass);
    expect(byId("m87-star").simMass).toBeGreaterThan(byId("sgr-a-star").simMass);
  });

  it("flags stars as emissive and supermassive holes as fixed black holes", () => {
    expect(byId("sun").emissive).toBe(true);
    expect(byId("psr-j0740").emissive).toBe(true);
    expect(byId("sgr-a-star").isFixed).toBe(true);
    expect(byId("m87-star").isFixed).toBe(true);
    expect(byId("earth").emissive).toBeUndefined();
  });
});

describe("formatKilograms", () => {
  it("uses scientific notation with superscript exponents", () => {
    expect(formatKilograms(5.9722e24)).toBe("5.972 × 10²⁴ kg");
    expect(formatKilograms(1.989e30)).toBe("1.989 × 10³⁰ kg");
  });

  it("leaves small everyday masses unscaled", () => {
    expect(formatKilograms(825.5)).toBe("825.5 kg");
  });
});

describe("searchPresets", () => {
  it("returns everything for an empty query", () => {
    expect(searchPresets("")).toHaveLength(ASTRONOMICAL_PRESETS.length);
    expect(searchPresets("   ")).toHaveLength(ASTRONOMICAL_PRESETS.length);
  });

  it("ranks name matches above description matches", () => {
    const results = searchPresets("earth");
    expect(results[0]?.id).toBe("earth");
  });

  it("prefers exact and prefix matches", () => {
    expect(searchPresets("io")[0]?.id).toBe("io");
    expect(searchPresets("titan")[0]?.id).toBe("titan");
  });

  it("is case-insensitive and matches across categories", () => {
    const results = searchPresets("VOYAGER");
    expect(results.map((p) => p.id)).toEqual(expect.arrayContaining(["voyager-1", "voyager-2"]));
  });

  it("finds nothing for nonsense", () => {
    expect(searchPresets("zzzznotathing")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

function makeBody(overrides: Partial<CelestialBody> = {}): CelestialBody {
  return {
    id: "host",
    name: "Host",
    mass: 1,
    radius: 0.0047,
    color: "#ffffff",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

/** Elements of a test particle about a unit primary, asserted non-degenerate. */
function elementsOf(
  result: { position: CelestialBody["position"]; velocity: CelestialBody["velocity"] },
  primaryMass: number,
  G: number
) {
  const elements = computeOrbitalElements(
    makeBody({ mass: 1e-12, position: result.position, velocity: result.velocity }),
    makeBody({ mass: primaryMass }),
    G
  );
  if (!elements) throw new Error("degenerate orbit");
  return elements;
}

describe("sceneScale", () => {
  it("is the identity for an empty scene", () => {
    expect(sceneScale([])).toEqual(CANONICAL_SCALE);
  });

  it("is very nearly the identity for a scene already in M☉ / AU", () => {
    // A Sun-massed, Sun-sized body is the canonical reference by construction.
    const scale = sceneScale([makeBody({ name: "Sun", mass: 1, radius: 695700 / AU_KM })]);
    expect(scale.massScale).toBeCloseTo(1, 9);
    expect(scale.lengthScale).toBeCloseTo(1, 9);
    expect(scale.referenceName).toBe("Sun");
  });

  it("measures against the heaviest body, not the largest or the first", () => {
    const scale = sceneScale([
      makeBody({ id: "a", name: "Puffball", mass: 1, radius: 10 }),
      makeBody({ id: "b", name: "Core", mass: 6000, radius: 2.4 }),
    ]);
    expect(scale.referenceName).toBe("Core");
    expect(scale.massScale).toBe(6000);
  });

  it("preserves catalogue mass ratios after rescaling", () => {
    const scale = sceneScale([makeBody({ mass: 6000, radius: 2.4 })]);
    const earth = byId("earth").simMass * scale.massScale;
    const jupiter = byId("jupiter").simMass * scale.massScale;
    expect(jupiter / earth).toBeCloseTo(317.8, 0);
  });

  it("falls back to canonical when the heaviest body is degenerate", () => {
    expect(sceneScale([makeBody({ mass: 0, radius: 0 })])).toEqual(CANONICAL_SCALE);
  });
});

describe("orbitalStateVectors", () => {
  const G = 4 * Math.PI * Math.PI;

  it("produces the textbook circular speed at e = 0", () => {
    const result = orbitalStateVectors({
      hostMass: 1,
      hostPosition: { x: 0, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      bodyMass: 0,
      periapsis: 1,
      eccentricity: 0,
      inclinationDeg: 0,
      phaseDeg: 0,
      G,
    });
    // 1 AU around 1 M☉ at G = 4π² is exactly 2π AU/yr.
    expect(result.speed).toBeCloseTo(2 * Math.PI, 9);
    expect(result.speed).toBeCloseTo(result.circularSpeed, 12);
    expect(result.period).toBeCloseTo(1, 9);
    expect(result.apoapsis).toBeCloseTo(1, 9);
  });

  it("reproduces the requested eccentricity through the orbital-element solver", () => {
    for (const e of [0, 0.3, 0.6, 0.9]) {
      const result = orbitalStateVectors({
        hostMass: 1,
        hostPosition: { x: 0, y: 0, z: 0 },
        hostVelocity: { x: 0, y: 0, z: 0 },
        bodyMass: 0,
        periapsis: 2,
        eccentricity: e,
        inclinationDeg: 0,
        phaseDeg: 37,
        G,
      });
      const elements = elementsOf(result, 1, G);
      expect(elements.eccentricity).toBeCloseTo(e, 6);
      expect(elements.semiMajorAxis).toBeCloseTo(2 / (1 - e), 5);
    }
  });

  it("places the body at the requested distance and phase", () => {
    const result = orbitalStateVectors({
      hostMass: 1,
      hostPosition: { x: 5, y: -2, z: 3 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      bodyMass: 0,
      periapsis: 4,
      eccentricity: 0,
      inclinationDeg: 0,
      phaseDeg: 123,
      G,
    });
    const dx = result.position.x - 5;
    const dy = result.position.y + 2;
    const dz = result.position.z - 3;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(4, 9);
  });

  it("keeps the orbit intact under inclination, only tilting it", () => {
    const base = {
      hostMass: 1,
      hostPosition: { x: 0, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      bodyMass: 0,
      periapsis: 3,
      eccentricity: 0.25,
      phaseDeg: 80,
      G,
    };
    const flat = orbitalStateVectors({ ...base, inclinationDeg: 0 });
    const tilted = orbitalStateVectors({ ...base, inclinationDeg: 63 });

    const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
    expect(speed(tilted.position)).toBeCloseTo(speed(flat.position), 9);
    expect(speed(tilted.velocity)).toBeCloseTo(speed(flat.velocity), 9);
    expect(tilted.position.y).not.toBeCloseTo(0, 3);

    // The UI's inclination is measured from the scene's XZ orbital plane (the
    // convention every preset lays its orbits out in), while the classical
    // element is measured from +Z — so the two are complementary.
    const flatElements = elementsOf(flat, 1, G);
    const tiltedElements = elementsOf(tilted, 1, G);
    expect((flatElements.inclination * 180) / Math.PI).toBeCloseTo(90, 4);
    expect((tiltedElements.inclination * 180) / Math.PI).toBeCloseTo(90 - 63, 4);
    expect(tiltedElements.eccentricity).toBeCloseTo(0.25, 6);
  });

  it("inherits the host's motion so a moon follows its planet", () => {
    const result = orbitalStateVectors({
      hostMass: 3e-6,
      hostPosition: { x: 1, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: -2 * Math.PI },
      bodyMass: 0,
      periapsis: 0.00257,
      eccentricity: 0,
      inclinationDeg: 0,
      phaseDeg: 0,
      G,
    });
    // The moon's own orbital speed is tiny next to Earth's 2π; the sum must
    // still be dominated by the host's velocity or the moon is left behind.
    expect(result.velocity.z).toBeLessThan(-2 * Math.PI * 0.9);
  });

  it("reverses the orbit direction when retrograde", () => {
    const spec = {
      hostMass: 1,
      hostPosition: { x: 0, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      bodyMass: 0,
      periapsis: 1,
      eccentricity: 0,
      inclinationDeg: 0,
      phaseDeg: 45,
      G,
    };
    const prograde = orbitalStateVectors(spec);
    const retro = orbitalStateVectors({ ...spec, retrograde: true });
    expect(retro.velocity.x).toBeCloseTo(-prograde.velocity.x, 12);
    expect(retro.velocity.z).toBeCloseTo(-prograde.velocity.z, 12);
    expect(retro.speed).toBeCloseTo(prograde.speed, 12);
  });

  it("folds the spawned body's own mass into mu", () => {
    const spec = {
      hostMass: 2,
      hostPosition: { x: 0, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      periapsis: 1,
      eccentricity: 0,
      inclinationDeg: 0,
      phaseDeg: 0,
      G,
    };
    const massless = orbitalStateVectors({ ...spec, bodyMass: 0 });
    const equal = orbitalStateVectors({ ...spec, bodyMass: 2 });
    expect(equal.speed / massless.speed).toBeCloseTo(Math.SQRT2, 9);
  });

  it("reports an unbound orbit as unbound rather than as a huge ellipse", () => {
    const result = orbitalStateVectors({
      hostMass: 1,
      hostPosition: { x: 0, y: 0, z: 0 },
      hostVelocity: { x: 0, y: 0, z: 0 },
      bodyMass: 0,
      periapsis: 1,
      eccentricity: 1,
      inclinationDeg: 0,
      phaseDeg: 0,
      G,
    });
    expect(result.speed).toBeCloseTo(result.escapeSpeed, 9);
    expect(result.apoapsis).toBe(Infinity);
    expect(result.period).toBe(Infinity);
  });
});

describe("buildSpawnedBody", () => {
  const position = { x: 1, y: 2, z: 3 };
  const velocity = { x: 4, y: 5, z: 6 };

  it("applies the scene scale to mass and radius", () => {
    const scale = { massScale: 6000, lengthScale: 500, referenceName: "Core" };
    const body = buildSpawnedBody({ preset: byId("earth"), scale, position, velocity });
    expect(body.mass).toBeCloseTo(byId("earth").simMass * 6000, 12);
    expect(body.radius).toBeCloseTo(byId("earth").simRadius * 500, 12);
  });

  it("keeps the catalogue name, which is what drives the render profile lookup", () => {
    const body = buildSpawnedBody({
      preset: byId("saturn"),
      scale: CANONICAL_SCALE,
      position,
      velocity,
    });
    expect(body.name).toBe("Saturn");
  });

  it("mints a unique id per spawn", () => {
    const a = buildSpawnedBody({ preset: byId("earth"), scale: CANONICAL_SCALE, position, velocity });
    const b = buildSpawnedBody({ preset: byId("earth"), scale: CANONICAL_SCALE, position, velocity });
    expect(a.id).not.toBe(b.id);
  });

  it("marks black holes so the dedicated renderer picks them up", () => {
    const body = buildSpawnedBody({
      preset: byId("sgr-a-star"),
      scale: CANONICAL_SCALE,
      position,
      velocity,
    });
    expect(body.isBlackHole).toBe(true);
    expect(body.isFixed).toBe(true);
  });

  it("lets the caller override the preset's fixed default", () => {
    const body = buildSpawnedBody({
      preset: byId("sun"),
      scale: CANONICAL_SCALE,
      position,
      velocity,
      isFixed: false,
    });
    expect(body.isFixed).toBeUndefined();
  });

  it("never emits a zero radius, even for a clamped micro black hole", () => {
    const body = buildSpawnedBody({
      preset: byId("micro-bh"),
      scale: { massScale: 1, lengthScale: 0, referenceName: null },
      position,
      velocity,
    });
    expect(body.radius).toBeGreaterThan(0);
  });
});

describe("suggestedOrbitRadius", () => {
  it("uses the catalogue distance when it clears the host", () => {
    expect(suggestedOrbitRadius(byId("earth"), CANONICAL_SCALE, 0.0047)).toBeCloseTo(1, 9);
  });

  it("pushes a moon clear of a host it was never meant to orbit", () => {
    // Phobos' 9,376 km orbit is far inside the Sun.
    const radius = suggestedOrbitRadius(byId("phobos"), CANONICAL_SCALE, byId("sun").simRadius);
    expect(radius).toBeGreaterThan(byId("sun").simRadius);
  });
});
