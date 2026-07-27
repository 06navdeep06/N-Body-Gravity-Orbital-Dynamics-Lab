/**
 * Catalogue of real astronomical objects available in the "Add Body" builder.
 *
 * UNITS
 * -----
 * Every entry is stored in the same canonical system the Real Solar System
 * preset uses:
 *
 *   mass = solar masses (M☉),  length = astronomical units (AU)
 *
 * That is a deliberate choice rather than "whatever the scene happens to use".
 * A preset has to mean something before it is dropped into a scene, and the
 * scenes disagree wildly about units — `buildSolarSystem()` runs at G = 4π²
 * with the Sun at mass 1, while the black-hole presets run at G = 1 with a
 * central mass of 6000. Storing one canonical value per object and rescaling
 * at launch time (see `lib/data/preset-spawn`) keeps the *ratios* between
 * catalogue entries exact in every scene: Jupiter is always 318 Earths, no
 * matter which preset is loaded.
 *
 * `realMassKg` is the display string only — it is derived from the same
 * kilogram figure that produced `simMass`, so the two can never drift apart.
 *
 * SOURCES: IAU/JPL Solar System Dynamics values for solar-system bodies;
 * published best estimates for stars, compact objects and exoplanets. Where a
 * mass is genuinely uncertain (Betelgeuse, UY Scuti, 'Oumuamua, the primordial
 * black hole) the description says so — the catalogue is for building
 * plausible simulations, not for publishing ephemerides.
 */

export type PresetCategory =
  | 'planets'
  | 'dwarf_planets'
  | 'moons'
  | 'stars'
  | 'black_holes'
  | 'exoplanets_comets'
  | 'spacecraft'
  | 'custom';

export interface AstronomicalPreset {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  realMassKg: string; // e.g. "5.972 × 10²⁴ kg"
  simMass: number;    // Scaled value for N-body simulation units
  simRadius: number;  // Visual rendering radius
  color: string;      // Hex color code
  emissive?: boolean; // For stars/pulsars
  glowColor?: string;
  isFixed?: boolean;  // Default fixed state (e.g. massive black holes)
  defaultOrbitRadius?: number; // Suggested orbital distance from parent
}

// ---------------------------------------------------------------------------
// Unit constants
// ---------------------------------------------------------------------------

/** IAU nominal solar mass. */
export const SOLAR_MASS_KG = 1.98892e30;
/** IAU 2012 definition of the astronomical unit. */
export const AU_KM = 1.495978707e8;
/** IAU nominal solar radius. */
export const SOLAR_RADIUS_KM = 695700;
export const EARTH_MASS_KG = 5.9722e24;
export const EARTH_RADIUS_KM = 6371.0;
export const JUPITER_MASS_KG = 1.89813e27;
export const JUPITER_RADIUS_KM = 69911;

/** Canonical mass unit: the Sun is exactly 1 `simMass`. */
export const CANONICAL_REFERENCE_MASS = 1;
/** Canonical length reference: the Sun's radius in `simRadius` units. */
export const CANONICAL_REFERENCE_RADIUS = SOLAR_RADIUS_KM / AU_KM;

/**
 * Floor applied to `simRadius`, in AU (≈150 m).
 *
 * A primordial black hole's event horizon is ~10⁻¹⁸ km across and a grain of
 * spacecraft is not much better. Left exact those bodies would have a radius
 * indistinguishable from zero, which breaks collision handling (a zero-radius
 * body can never register a contact) and makes them unselectable in the
 * viewport. The floor is documented in the affected entries' descriptions.
 */
export const MIN_SIM_RADIUS = 1e-9;

const G_SI = 6.6743e-11;
const C_SI = 2.99792458e8;

/** Schwarzschild radius 2GM/c² in km, for the compact-object entries. */
export function schwarzschildRadiusKm(massKg: number): number {
  return (2 * G_SI * massKg) / (C_SI * C_SI) / 1000;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function superscript(value: number): string {
  return String(value)
    .split('')
    .map((ch) => SUPERSCRIPTS[ch] ?? ch)
    .join('');
}

/** Formats a kilogram figure as e.g. `5.972 × 10²⁴ kg`. */
export function formatKilograms(massKg: number): string {
  if (massKg === 0) return '0 kg';
  const exponent = Math.floor(Math.log10(Math.abs(massKg)));
  const mantissa = massKg / 10 ** exponent;
  // 10^0..10^3 read better unscaled ("825.5 kg", not "8.255 × 10² kg").
  if (exponent >= 0 && exponent < 4) {
    return `${Number(massKg.toPrecision(4)).toLocaleString('en-US')} kg`;
  }
  return `${mantissa.toFixed(3)} × 10${superscript(exponent)} kg`;
}

/** Formats a `simMass` as a multiple of a familiar body, for the detail pane. */
export function formatRelativeMass(simMass: number): string {
  const kg = simMass * SOLAR_MASS_KG;
  if (kg >= 0.05 * SOLAR_MASS_KG) return `${(kg / SOLAR_MASS_KG).toPrecision(3)} M☉`;
  if (kg >= 0.05 * JUPITER_MASS_KG) return `${(kg / JUPITER_MASS_KG).toPrecision(3)} M♃`;
  if (kg >= 1e-6 * EARTH_MASS_KG) return `${(kg / EARTH_MASS_KG).toPrecision(3)} M⊕`;
  return formatKilograms(kg);
}

/** Formats a `simRadius` (AU) as kilometres, or AU once it is large. */
export function formatRadius(simRadius: number): string {
  const km = simRadius * AU_KM;
  if (simRadius >= 0.01) return `${simRadius.toPrecision(3)} AU`;
  if (km >= 1) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${(km * 1000).toPrecision(3)} m`;
}

// ---------------------------------------------------------------------------
// Catalogue construction
// ---------------------------------------------------------------------------

interface PresetSpec {
  id: string;
  name: string;
  description: string;
  /** True mass in kilograms — the single source for `simMass` and `realMassKg`. */
  massKg: number;
  /** True mean radius in kilometres. */
  radiusKm: number;
  color: string;
  emissive?: boolean;
  glowColor?: string;
  isFixed?: boolean;
  /** Characteristic orbital distance from its natural parent, in AU. */
  orbitAu?: number;
}

function build(category: PresetCategory, specs: PresetSpec[]): AstronomicalPreset[] {
  return specs.map((spec) => {
    const preset: AstronomicalPreset = {
      id: spec.id,
      name: spec.name,
      category,
      description: spec.description,
      realMassKg: formatKilograms(spec.massKg),
      simMass: spec.massKg / SOLAR_MASS_KG,
      simRadius: Math.max(spec.radiusKm / AU_KM, MIN_SIM_RADIUS),
      color: spec.color,
    };
    if (spec.emissive) preset.emissive = true;
    if (spec.glowColor) preset.glowColor = spec.glowColor;
    if (spec.isFixed) preset.isFixed = true;
    if (spec.orbitAu !== undefined) preset.defaultOrbitRadius = spec.orbitAu;
    return preset;
  });
}

/** Convenience for the compact objects, whose "radius" is their horizon. */
const horizon = (massKg: number) => schwarzschildRadiusKm(massKg);

// --- Terran & Jovian planets ----------------------------------------------

const PLANETS = build('planets', [
  {
    id: 'mercury', name: 'Mercury', massKg: 3.3011e23, radiusKm: 2439.7, color: '#9c9c94',
    orbitAu: 0.3871,
    description: 'Smallest planet, airless and cratered. Its 43″/century perihelion advance is the classic test of general relativity — enable GR corrections to reproduce it.',
  },
  {
    id: 'venus', name: 'Venus', massKg: 4.8675e24, radiusKm: 6051.8, color: '#e6c89c',
    orbitAu: 0.7233,
    description: 'Earth\'s twin in size, wrapped in a 92-bar CO₂ atmosphere. Nearly circular orbit (e = 0.007), the most circular in the Solar System.',
  },
  {
    id: 'earth', name: 'Earth', massKg: 5.9722e24, radiusKm: 6371.0, color: '#4f94cd',
    orbitAu: 1.0,
    description: 'The reference world: 1 AU from the Sun, orbiting at 29.8 km/s. In AU/M☉/year units that is exactly 2π AU per year.',
  },
  {
    id: 'mars', name: 'Mars', massKg: 6.4171e23, radiusKm: 3389.5, color: '#c1440e',
    orbitAu: 1.5237,
    description: 'Cold desert world with two captured-asteroid moons. Standard destination for Hohmann-transfer exercises from Earth.',
  },
  {
    id: 'jupiter', name: 'Jupiter', massKg: 1.89813e27, radiusKm: 69911, color: '#d8ca9d',
    orbitAu: 5.2044,
    description: 'The Solar System\'s second-largest mass at 318 Earths. Dominates every resonance and Lagrange structure in the asteroid belt.',
  },
  {
    id: 'saturn', name: 'Saturn', massKg: 5.6834e26, radiusKm: 58232, color: '#ead6b8',
    orbitAu: 9.5826,
    description: 'Ringed gas giant with a mean density below that of water. Its rings sit inside the Roche limit for a self-gravitating moon.',
  },
  {
    id: 'uranus', name: 'Uranus', massKg: 8.6810e25, radiusKm: 25362, color: '#afdbf5',
    orbitAu: 19.191,
    description: 'Ice giant tipped 98° onto its side, with faint narrow rings shepherded by small moons.',
  },
  {
    id: 'neptune', name: 'Neptune', massKg: 1.02413e26, radiusKm: 24622, color: '#4166f5',
    orbitAu: 30.07,
    description: 'Outermost planet, found by perturbation analysis of Uranus before it was ever observed — the original N-body prediction.',
  },
]);

// --- Dwarf planets & trans-Neptunian objects -------------------------------

const DWARF_PLANETS = build('dwarf_planets', [
  {
    id: 'pluto', name: 'Pluto', massKg: 1.303e22, radiusKm: 1188.3, color: '#c9b29b',
    orbitAu: 39.482,
    description: 'Binary dwarf planet locked with Charon, in a 3:2 mean-motion resonance with Neptune that keeps them from ever meeting.',
  },
  {
    id: 'eris', name: 'Eris', massKg: 1.6466e22, radiusKm: 1163, color: '#ded8d0',
    orbitAu: 67.86,
    description: 'More massive than Pluto and the object that triggered the 2006 redefinition of "planet". Aphelion carries it to 97 AU.',
  },
  {
    id: 'haumea', name: 'Haumea', massKg: 4.006e21, radiusKm: 816, color: '#e8e6e1',
    orbitAu: 43.13,
    description: 'Spins once every 3.9 hours, fast enough that rotation has drawn it into a triaxial ellipsoid. Has a ring and two moons.',
  },
  {
    id: 'makemake', name: 'Makemake', massKg: 3.1e21, radiusKm: 715, color: '#d9b08c',
    orbitAu: 45.43,
    description: 'Bright methane-frosted Kuiper belt dwarf planet with one very dark known satellite.',
  },
  {
    id: 'ceres', name: 'Ceres', massKg: 9.3839e20, radiusKm: 469.7, color: '#8c8c8c',
    orbitAu: 2.77,
    description: 'Largest asteroid-belt object and the only dwarf planet inside Neptune\'s orbit. Holds roughly a third of the belt\'s total mass.',
  },
  {
    id: 'gonggong', name: 'Gonggong', massKg: 1.75e21, radiusKm: 615, color: '#c58b70',
    orbitAu: 67.5,
    description: 'Reddish scattered-disc object on a highly eccentric 550-year orbit, with the moon Xiangliu.',
  },
  {
    id: 'quaoar', name: 'Quaoar', massKg: 1.2e21, radiusKm: 545, color: '#b79c8a',
    orbitAu: 43.69,
    description: 'Classical Kuiper belt object with a ring far outside its Roche limit — a standing puzzle for ring-formation theory.',
  },
  {
    id: 'orcus', name: 'Orcus', massKg: 6.348e20, radiusKm: 458, color: '#a9b5bd',
    orbitAu: 39.42,
    description: 'The "anti-Pluto": same 3:2 Neptune resonance and near-identical period, but always on the opposite side of its orbit.',
  },
  {
    id: 'sedna', name: 'Sedna', massKg: 1.0e21, radiusKm: 498, color: '#a4442d',
    orbitAu: 76.19,
    description: 'Detached object with an 11,400-year orbit reaching 937 AU. Mass is an estimate from its size and an assumed density.',
  },
]);

// --- Major moons -----------------------------------------------------------

const MOONS = build('moons', [
  {
    id: 'moon', name: 'Moon', massKg: 7.342e22, radiusKm: 1737.4, color: '#bfbdb8',
    orbitAu: 0.00257,
    description: 'Unusually massive for its primary at 1/81 of Earth. Tidally receding at 3.8 cm/year as it takes angular momentum from Earth\'s spin.',
  },
  {
    id: 'io', name: 'Io', massKg: 8.9319e22, radiusKm: 1821.6, color: '#ffe08a',
    orbitAu: 0.002819,
    description: 'The most volcanically active body known, heated by tidal flexing from its 4:2:1 Laplace resonance with Europa and Ganymede.',
  },
  {
    id: 'europa', name: 'Europa', massKg: 4.7998e22, radiusKm: 1560.8, color: '#d9c7a0',
    orbitAu: 0.004486,
    description: 'Ice shell over a global saltwater ocean holding twice Earth\'s surface water. Middle link of the Laplace resonance.',
  },
  {
    id: 'ganymede', name: 'Ganymede', massKg: 1.4819e23, radiusKm: 2634.1, color: '#a89f91',
    orbitAu: 0.007155,
    description: 'Largest moon in the Solar System — bigger than Mercury — and the only one with its own magnetic field.',
  },
  {
    id: 'callisto', name: 'Callisto', massKg: 1.0759e23, radiusKm: 2410.3, color: '#7a7265',
    orbitAu: 0.012585,
    description: 'Outermost Galilean moon, outside the resonance and outside Jupiter\'s worst radiation belts. Its surface is the oldest known.',
  },
  {
    id: 'titan', name: 'Titan', massKg: 1.3452e23, radiusKm: 2574.7, color: '#e3a857',
    orbitAu: 0.008168,
    description: 'The only moon with a substantial atmosphere (1.5 bar N₂) and the only other body with standing surface liquid — methane lakes.',
  },
  {
    id: 'enceladus', name: 'Enceladus', massKg: 1.08e20, radiusKm: 252.1, color: '#f2fbff',
    orbitAu: 0.001593,
    description: 'Vents its subsurface ocean into space through south-polar geysers, feeding Saturn\'s E ring. Reflects 99% of incident light.',
  },
  {
    id: 'triton', name: 'Triton', massKg: 2.139e22, radiusKm: 1353.4, color: '#cfd8dc',
    orbitAu: 0.002371,
    description: 'Captured Kuiper belt object on a retrograde orbit — spawn it retrograde. Tidal decay will bring it inside Neptune\'s Roche limit.',
  },
  {
    id: 'phobos', name: 'Phobos', massKg: 1.0659e16, radiusKm: 11.267, color: '#8b7d6b',
    orbitAu: 6.268e-5,
    description: 'Orbits below areostationary altitude, so it rises in the west and is spiralling in. Already grooved by tidal stress.',
  },
  {
    id: 'deimos', name: 'Deimos', massKg: 1.4762e15, radiusKm: 6.2, color: '#9a8b78',
    orbitAu: 1.5684e-4,
    description: 'Outer Martian moon, smooth with regolith and slowly receding. One of the smallest bodies in the catalogue.',
  },
  {
    id: 'charon', name: 'Charon', massKg: 1.586e21, radiusKm: 606, color: '#a89e94',
    orbitAu: 1.3096e-4,
    description: 'Half Pluto\'s diameter and 12% of its mass — the barycentre lies outside Pluto, making the pair a true binary.',
  },
  {
    id: 'mimas', name: 'Mimas', massKg: 3.7493e19, radiusKm: 198.2, color: '#cbc9c4',
    orbitAu: 1.2416e-3,
    description: 'Its 2:1 resonance with Pan opens the Cassini Division in Saturn\'s rings. The Herschel crater spans a third of its diameter.',
  },
  {
    id: 'tethys', name: 'Tethys', massKg: 6.1745e20, radiusKm: 531.1, color: '#ddd8cf',
    orbitAu: 1.9686e-3,
    description: 'Nearly pure water ice — density 0.98 g/cm³. Shares its orbit with the trojan moons Telesto and Calypso at L4 and L5.',
  },
  {
    id: 'dione', name: 'Dione', massKg: 1.0955e21, radiusKm: 561.4, color: '#cfcabf',
    orbitAu: 2.5217e-3,
    description: 'Icy Saturnian moon in a 1:2 resonance with Enceladus, streaked with bright tectonic cliffs.',
  },
  {
    id: 'rhea', name: 'Rhea', massKg: 2.3065e21, radiusKm: 763.8, color: '#c9c4bb',
    orbitAu: 3.5231e-3,
    description: 'Saturn\'s second-largest moon, heavily cratered and possibly the only moon with a tenuous ring system of its own.',
  },
  {
    id: 'iapetus', name: 'Iapetus', massKg: 1.8056e21, radiusKm: 734.5, color: '#8f8578',
    orbitAu: 0.023805,
    description: 'Two-toned moon with a leading hemisphere as dark as coal, and a 13 km equatorial ridge of unknown origin.',
  },
  {
    id: 'miranda', name: 'Miranda', massKg: 6.4e19, radiusKm: 235.8, color: '#b8bec2',
    orbitAu: 8.6626e-4,
    description: 'Chaotic patchwork of coronae with a 20 km cliff, Verona Rupes — the tallest known in the Solar System.',
  },
  {
    id: 'ariel', name: 'Ariel', massKg: 1.2331e21, radiusKm: 578.9, color: '#c3c8c9',
    orbitAu: 1.2769e-3,
    description: 'Brightest Uranian moon, resurfaced by past cryovolcanism and cut by deep graben.',
  },
  {
    id: 'umbriel', name: 'Umbriel', massKg: 1.2885e21, radiusKm: 584.7, color: '#7f8386',
    orbitAu: 1.7789e-3,
    description: 'Darkest of the major Uranian moons, ancient and almost unresurfaced.',
  },
  {
    id: 'titania', name: 'Titania', massKg: 3.455e21, radiusKm: 788.4, color: '#b6aca4',
    orbitAu: 2.9147e-3,
    description: 'Largest moon of Uranus, scarred by enormous rift valleys from a freezing interior.',
  },
  {
    id: 'oberon', name: 'Oberon', massKg: 3.1104e21, radiusKm: 761.4, color: '#a1968e',
    orbitAu: 3.8985e-3,
    description: 'Outermost major Uranian moon, cratered with dark floor deposits.',
  },
]);

// --- Stars & stellar objects ----------------------------------------------

const STARS = build('stars', [
  {
    id: 'sun', name: 'Sun', massKg: SOLAR_MASS_KG, radiusKm: SOLAR_RADIUS_KM,
    color: '#fdb813', emissive: true, glowColor: '#ffd88a', isFixed: true,
    description: 'G2V main-sequence star holding 99.86% of the Solar System\'s mass. The catalogue\'s canonical mass unit: exactly 1 M☉.',
  },
  {
    id: 'proxima-centauri', name: 'Proxima Centauri', massKg: 0.1221 * SOLAR_MASS_KG,
    radiusKm: 0.1542 * SOLAR_RADIUS_KM, color: '#ff6b4a', emissive: true, glowColor: '#ff9a6a',
    orbitAu: 8700,
    description: 'Nearest star to the Sun at 4.24 ly. An M5.5V red dwarf that flares violently, bound to Alpha Centauri A/B on a 550,000-year orbit.',
  },
  {
    id: 'alpha-centauri-a', name: 'Alpha Centauri A', massKg: 1.0788 * SOLAR_MASS_KG,
    radiusKm: 1.2234 * SOLAR_RADIUS_KM, color: '#fff0c8', emissive: true, glowColor: '#ffe8a8',
    orbitAu: 10.9,
    description: 'G2V star nearly identical to the Sun, primary of the nearest stellar system. Orbits its companion every 79.9 years.',
  },
  {
    id: 'alpha-centauri-b', name: 'Alpha Centauri B', massKg: 0.9092 * SOLAR_MASS_KG,
    radiusKm: 0.8632 * SOLAR_RADIUS_KM, color: '#ffcf8f', emissive: true, glowColor: '#ffb96a',
    orbitAu: 12.9,
    description: 'K1V companion to Alpha Centauri A. The pair swings between 11.2 and 35.6 AU — a textbook eccentric binary (e = 0.52).',
  },
  {
    id: 'sirius-a', name: 'Sirius A', massKg: 2.063 * SOLAR_MASS_KG,
    radiusKm: 1.711 * SOLAR_RADIUS_KM, color: '#cfe4ff', emissive: true, glowColor: '#dbeaff',
    orbitAu: 10.0,
    description: 'Brightest star in the night sky, an A1V twice the Sun\'s mass and 25 times its luminosity.',
  },
  {
    id: 'sirius-b', name: 'Sirius B', massKg: 1.018 * SOLAR_MASS_KG, radiusKm: 5850,
    color: '#eaf4ff', emissive: true, glowColor: '#ffffff', orbitAu: 10.0,
    description: 'White dwarf with the Sun\'s mass packed into an Earth-sized sphere — mean density ~1 tonne/cm³. Orbits Sirius A every 50.1 years.',
  },
  {
    id: 'betelgeuse', name: 'Betelgeuse', massKg: 16.5 * SOLAR_MASS_KG,
    radiusKm: 764 * SOLAR_RADIUS_KM, color: '#ff5a36', emissive: true, glowColor: '#ff8850',
    description: 'Red supergiant so large it would swallow Jupiter\'s orbit. Mass is uncertain to ±3 M☉; a future core-collapse supernova.',
  },
  {
    id: 'rigel', name: 'Rigel', massKg: 21 * SOLAR_MASS_KG, radiusKm: 78.9 * SOLAR_RADIUS_KM,
    color: '#a3c6ff', emissive: true, glowColor: '#c8dcff',
    description: 'Blue supergiant radiating 120,000 solar luminosities, the brightest star in Orion despite being 860 ly away.',
  },
  {
    id: 'r136a1', name: 'R136a1', massKg: 196 * SOLAR_MASS_KG, radiusKm: 39.2 * SOLAR_RADIUS_KM,
    color: '#b8d2ff', emissive: true, glowColor: '#e0ecff',
    description: 'Most massive star known, a Wolf-Rayet in the Tarantula Nebula shedding 10⁻⁴ M☉ per year. Mass estimates range 150–230 M☉.',
  },
  {
    id: 'trappist-1', name: 'TRAPPIST-1', massKg: 0.0898 * SOLAR_MASS_KG,
    radiusKm: 0.1192 * SOLAR_RADIUS_KM, color: '#ff8c5a', emissive: true, glowColor: '#ffab77',
    isFixed: true,
    description: 'Ultra-cool dwarf barely above the hydrogen-burning limit, hosting seven Earth-sized planets in a resonant chain — the best N-body test case known.',
  },
  {
    id: 'uy-scuti', name: 'UY Scuti', massKg: 7 * SOLAR_MASS_KG,
    radiusKm: 1708 * SOLAR_RADIUS_KM, color: '#ff7043', emissive: true, glowColor: '#ffa06a',
    description: 'Red hypergiant, one of the largest stars by radius at ~1700 R☉ — its photosphere would reach past Jupiter. Both mass and radius are poorly constrained.',
  },
  {
    id: 'psr-j0740', name: 'PSR J0740+6620', massKg: 2.08 * SOLAR_MASS_KG, radiusKm: 12.4,
    color: '#dbe9ff', emissive: true, glowColor: '#9ec7ff',
    description: 'Among the most massive neutron stars measured: 2.08 M☉ inside a 12 km radius, spinning 346 times a second. NICER pinned its radius by pulse-profile modelling.',
  },
  {
    id: 'crab-pulsar', name: 'Crab Pulsar', massKg: 1.4 * SOLAR_MASS_KG, radiusKm: 12,
    color: '#cfe0ff', emissive: true, glowColor: '#7fb0ff',
    description: 'Neutron star left by the supernova of 1054, spinning 30 times a second and powering the Crab Nebula.',
  },
  {
    id: 'vega', name: 'Vega', massKg: 2.135 * SOLAR_MASS_KG, radiusKm: 2.362 * SOLAR_RADIUS_KM,
    color: '#d5e6ff', emissive: true, glowColor: '#e8f1ff',
    description: 'A0V standard star, rotating near breakup at 236 km/s and visibly flattened. Surrounded by a debris disc.',
  },
  {
    id: 'polaris', name: 'Polaris', massKg: 5.13 * SOLAR_MASS_KG, radiusKm: 37.5 * SOLAR_RADIUS_KM,
    color: '#fff4dd', emissive: true, glowColor: '#ffe9bb',
    description: 'The North Star: a classical Cepheid variable whose period-luminosity relation anchors the cosmic distance ladder.',
  },
  {
    id: 'antares', name: 'Antares', massKg: 12 * SOLAR_MASS_KG, radiusKm: 680 * SOLAR_RADIUS_KM,
    color: '#ff6a3d', emissive: true, glowColor: '#ff9a63',
    description: 'Red supergiant in Scorpius with a hot B-type companion, losing mass fast enough to shroud itself in a nebula.',
  },
  {
    id: 'aldebaran', name: 'Aldebaran', massKg: 1.16 * SOLAR_MASS_KG,
    radiusKm: 45.1 * SOLAR_RADIUS_KM, color: '#ffab6b', emissive: true, glowColor: '#ffc48f',
    description: 'Orange giant that has left the main sequence and swollen to 45 R☉ — a preview of the Sun\'s future.',
  },
  {
    id: 'barnards-star', name: "Barnard's Star", massKg: 0.144 * SOLAR_MASS_KG,
    radiusKm: 0.196 * SOLAR_RADIUS_KM, color: '#ff7a52', emissive: true, glowColor: '#ff9e77',
    description: 'Red dwarf with the largest known proper motion, 10.3″ per year. Six light-years away and closing.',
  },
]);

// --- Black holes & compact objects ----------------------------------------

const SGR_A_KG = 4.297e6 * SOLAR_MASS_KG;
const M87_KG = 6.5e9 * SOLAR_MASS_KG;
const TON618_KG = 6.6e10 * SOLAR_MASS_KG;
const CYGX1_KG = 21.2 * SOLAR_MASS_KG;
const GW_A_KG = 36 * SOLAR_MASS_KG;
const GW_B_KG = 29 * SOLAR_MASS_KG;
const IMBH_KG = 1e4 * SOLAR_MASS_KG;
const STELLAR_BH_KG = 10 * SOLAR_MASS_KG;
const GAIA_BH1_KG = 9.62 * SOLAR_MASS_KG;
const MICRO_BH_KG = 1e12;

const BLACK_HOLES = build('black_holes', [
  {
    id: 'sgr-a-star', name: 'Sagittarius A*', massKg: SGR_A_KG, radiusKm: horizon(SGR_A_KG),
    color: '#000000', isFixed: true, glowColor: '#ffb877',
    description: 'The Milky Way\'s central supermassive black hole, 4.3 million M☉ inside an 0.085 AU horizon. Its mass comes from decades of tracking the S-star orbits.',
  },
  {
    id: 'm87-star', name: 'M87*', massKg: M87_KG, radiusKm: horizon(M87_KG),
    color: '#000000', isFixed: true, glowColor: '#ffa14d',
    description: 'First black hole ever imaged (EHT, 2019). At 6.5 billion M☉ its event horizon is 128 AU across — larger than the Solar System.',
  },
  {
    id: 'ton-618', name: 'TON 618', massKg: TON618_KG, radiusKm: horizon(TON618_KG),
    color: '#000000', isFixed: true, glowColor: '#ff8a3d',
    description: 'Ultramassive quasar engine at 66 billion M☉, one of the heaviest black holes known. Horizon radius ~1300 AU.',
  },
  {
    id: 'cygnus-x1', name: 'Cygnus X-1', massKg: CYGX1_KG, radiusKm: horizon(CYGX1_KG),
    color: '#000000', glowColor: '#9fd0ff', orbitAu: 0.234,
    description: 'First widely accepted black hole, discovered in 1964. Strips its blue supergiant companion HDE 226868 on a 5.6-day orbit.',
  },
  {
    id: 'gw150914-a', name: 'GW150914 A', massKg: GW_A_KG, radiusKm: horizon(GW_A_KG),
    color: '#000000', glowColor: '#c0b3ff', orbitAu: 2.3e-6,
    description: 'Primary of the first detected black-hole merger (LIGO, 2015). Pair this with GW150914 B and enable GR to watch the inspiral chirp.',
  },
  {
    id: 'gw150914-b', name: 'GW150914 B', massKg: GW_B_KG, radiusKm: horizon(GW_B_KG),
    color: '#000000', glowColor: '#b3c6ff', orbitAu: 2.3e-6,
    description: 'Secondary of the GW150914 pair. The merger radiated 3 M☉ as gravitational waves in 0.2 seconds — briefly outshining the observable universe.',
  },
  {
    id: 'imbh', name: 'Intermediate-Mass Black Hole', massKg: IMBH_KG, radiusKm: horizon(IMBH_KG),
    color: '#000000', isFixed: true, glowColor: '#ffcf99',
    description: 'Representative 10,000 M☉ hole of the class suspected in dense globular clusters — the long-missing rung between stellar and supermassive.',
  },
  {
    id: 'stellar-bh', name: 'Stellar-Mass Black Hole', massKg: STELLAR_BH_KG,
    radiusKm: horizon(STELLAR_BH_KG), color: '#000000', glowColor: '#a8c8ff',
    description: 'Generic 10 M☉ remnant of a massive star, with a 30 km event horizon. A convenient neutral compact object for experiments.',
  },
  {
    id: 'gaia-bh1', name: 'Gaia BH1', massKg: GAIA_BH1_KG, radiusKm: horizon(GAIA_BH1_KG),
    color: '#000000', glowColor: '#c9d8ff', orbitAu: 1.4,
    description: 'Nearest known black hole at 1560 ly, found astrometrically by the wobble it induces in a Sun-like companion on a 186-day orbit.',
  },
  {
    id: 'micro-bh', name: 'Micro Black Hole', massKg: MICRO_BH_KG,
    radiusKm: horizon(MICRO_BH_KG), color: '#000000', glowColor: '#ff77c8',
    description: 'Hypothetical primordial black hole of 10⁹ tonnes, evaporating by Hawking radiation on roughly a Hubble time. Its true horizon is 10⁻¹⁵ m, so the rendered radius is clamped to the catalogue minimum.',
  },
]);

// --- Exoplanets, comets & asteroids ---------------------------------------

const EXOPLANETS_COMETS = build('exoplanets_comets', [
  {
    id: 'trappist-1e', name: 'TRAPPIST-1e', massKg: 0.692 * EARTH_MASS_KG,
    radiusKm: 0.920 * EARTH_RADIUS_KM, color: '#6f9fb5', orbitAu: 0.02925,
    description: 'Rocky world in TRAPPIST-1\'s habitable zone with a density suggesting an iron core. Its 6.10-day period sits in a resonant chain with six siblings.',
  },
  {
    id: 'trappist-1d', name: 'TRAPPIST-1d', massKg: 0.388 * EARTH_MASS_KG,
    radiusKm: 0.788 * EARTH_RADIUS_KM, color: '#a8907a', orbitAu: 0.02227,
    description: 'Lightest of the TRAPPIST-1 planets, possibly volatile-rich. Period 4.05 days.',
  },
  {
    id: 'trappist-1g', name: 'TRAPPIST-1g', massKg: 1.148 * EARTH_MASS_KG,
    radiusKm: 1.129 * EARTH_RADIUS_KM, color: '#7f9aa8', orbitAu: 0.04683,
    description: 'Largest TRAPPIST-1 planet, on a 12.35-day orbit at the outer edge of the habitable zone.',
  },
  {
    id: 'proxima-b', name: 'Proxima Centauri b', massKg: 1.07 * EARTH_MASS_KG,
    radiusKm: 1.03 * EARTH_RADIUS_KM, color: '#b06a4f', orbitAu: 0.04857,
    description: 'Nearest exoplanet, in the habitable zone of the nearest star — but tidally locked and battered by flares. Period 11.19 days.',
  },
  {
    id: 'kepler-452b', name: 'Kepler-452b', massKg: 5 * EARTH_MASS_KG,
    radiusKm: 1.63 * EARTH_RADIUS_KM, color: '#7ba05b', orbitAu: 1.046,
    description: '"Earth\'s cousin": a super-Earth on a 385-day orbit around a G2 star. Mass is a model estimate, not a measurement.',
  },
  {
    id: 'kepler-186f', name: 'Kepler-186f', massKg: 1.44 * EARTH_MASS_KG,
    radiusKm: 1.17 * EARTH_RADIUS_KM, color: '#8d7f6a', orbitAu: 0.432,
    description: 'First Earth-sized planet found in the habitable zone of another star, orbiting a red dwarf every 130 days.',
  },
  {
    id: 'hd-189733b', name: 'HD 189733b', massKg: 1.13 * JUPITER_MASS_KG,
    radiusKm: 1.138 * JUPITER_RADIUS_KM, color: '#2b4fbf', orbitAu: 0.03142,
    description: 'Deep-blue hot Jupiter with 8,700 km/h winds and silicate rain, 2.2 days from its star. The best-characterised exoplanet atmosphere.',
  },
  {
    id: '51-pegasi-b', name: '51 Pegasi b', massKg: 0.46 * JUPITER_MASS_KG,
    radiusKm: 1.9 * JUPITER_RADIUS_KM, color: '#d9a06b', orbitAu: 0.0527,
    description: 'The first exoplanet found around a Sun-like star (1995) and the archetypal hot Jupiter — 4.23-day year.',
  },
  {
    id: 'wasp-12b', name: 'WASP-12b', massKg: 1.47 * JUPITER_MASS_KG,
    radiusKm: 1.9 * JUPITER_RADIUS_KM, color: '#3b3b46', orbitAu: 0.0234,
    description: 'Being tidally shredded by its star: distorted into an egg shape, losing 10⁻⁷ M_J per year, and spiralling in on a 3-million-year clock.',
  },
  {
    id: 'gj-1214b', name: 'GJ 1214 b', massKg: 8.17 * EARTH_MASS_KG,
    radiusKm: 2.742 * EARTH_RADIUS_KM, color: '#8fa8b8', orbitAu: 0.01411,
    description: 'Prototype "sub-Neptune" with a thick steamy envelope, orbiting an M dwarf in 1.58 days.',
  },
  {
    id: 'oumuamua', name: "'Oumuamua", massKg: 8e9, radiusKm: 0.115, color: '#9c7b62',
    orbitAu: 0.2559,
    description: 'First confirmed interstellar object (2017), highly elongated and on a hyperbolic trajectory (e = 1.20). Mass is order-of-magnitude only.',
  },
  {
    id: 'borisov', name: '2I/Borisov', massKg: 5e12, radiusKm: 0.5, color: '#a8c8d8',
    orbitAu: 2.007,
    description: 'Second interstellar visitor and the first that was unambiguously a comet, with a CO-rich coma. Eccentricity 3.36.',
  },
  {
    id: 'halleys-comet', name: "Halley's Comet", massKg: 2.2e14, radiusKm: 5.5,
    color: '#b8e0ff', orbitAu: 0.586,
    description: 'The archetypal periodic comet: a = 17.8 AU, e = 0.967, retrograde, returning every 75 years. Spawn at perihelion with high eccentricity.',
  },
  {
    id: 'hale-bopp', name: 'Comet Hale-Bopp', massKg: 1.3e16, radiusKm: 30,
    color: '#cfe9ff', orbitAu: 0.914,
    description: 'The Great Comet of 1997, unusually large at ~60 km across, on a 2,530-year orbit reaching 370 AU.',
  },
  {
    id: 'shoemaker-levy-9', name: 'Comet Shoemaker-Levy 9', massKg: 5e14, radiusKm: 0.8,
    color: '#dce8f0', orbitAu: 0.00047,
    description: 'Captured by Jupiter, torn into 21 fragments inside the Roche limit, then impacted in 1994. Enable tidal disruption and spawn it on a plunging orbit.',
  },
  {
    id: '16-psyche', name: '16 Psyche', massKg: 2.29e19, radiusKm: 111, color: '#a89880',
    orbitAu: 2.923,
    description: 'Metal-rich M-type asteroid, possibly the exposed core of a shattered protoplanet. Target of the NASA Psyche mission.',
  },
  {
    id: 'vesta', name: '4 Vesta', massKg: 2.589e20, radiusKm: 262.7, color: '#c8bda8',
    orbitAu: 2.362,
    description: 'Second-most-massive asteroid and a differentiated protoplanet. The Rheasilvia impact basin excavated 1% of its volume.',
  },
  {
    id: 'pallas', name: '2 Pallas', massKg: 2.04e20, radiusKm: 256, color: '#9aa0a0',
    orbitAu: 2.773,
    description: 'Third-largest asteroid on a steeply inclined 34.8° orbit — spawn it with high inclination to see why it is hard to visit.',
  },
  {
    id: 'hygiea', name: '10 Hygiea', massKg: 8.32e19, radiusKm: 217, color: '#6f7278',
    orbitAu: 3.142,
    description: 'Largest carbonaceous asteroid and round enough to be a dwarf-planet candidate, despite forming from a catastrophic collision.',
  },
  {
    id: 'bennu', name: '101955 Bennu', massKg: 7.329e10, radiusKm: 0.2625, color: '#4a4644',
    orbitAu: 1.126,
    description: 'Rubble-pile near-Earth asteroid sampled by OSIRIS-REx. Its Yarkovsky drift makes it one of the best-tracked impact-risk objects.',
  },
  {
    id: 'ryugu', name: '162173 Ryugu', massKg: 4.5e11, radiusKm: 0.448, color: '#3c3a38',
    orbitAu: 0.963,
    description: 'Spinning-top rubble pile sampled by Hayabusa2, made of some of the least-altered material in the Solar System.',
  },
  {
    id: 'itokawa', name: '25143 Itokawa', massKg: 3.51e10, radiusKm: 0.165, color: '#7a6f5e',
    orbitAu: 0.953,
    description: 'Peanut-shaped contact binary with a 1.9 g/cm³ density — 40% of it is empty space. First asteroid sample return.',
  },
  {
    id: 'apophis', name: '99942 Apophis', massKg: 6.1e10, radiusKm: 0.1875, color: '#8b7f6b',
    orbitAu: 0.746,
    description: 'Will pass inside geostationary orbit in April 2029 — closer than some satellites. A good subject for close-encounter deflection studies.',
  },
  {
    id: 'eros', name: '433 Eros', massKg: 6.687e15, radiusKm: 8.42, color: '#9b8468',
    orbitAu: 1.133,
    description: 'First asteroid orbited and landed on (NEAR Shoemaker, 2001), and the first near-Earth asteroid ever discovered.',
  },
]);

// --- Spacecraft & artificial satellites ------------------------------------

const SPACECRAFT = build('spacecraft', [
  {
    id: 'iss', name: 'International Space Station', massKg: 419725, radiusKm: 0.0545,
    color: '#d4d8dd', orbitAu: 4.5395e-5,
    description: 'Largest artificial object in orbit, 109 m across, circling Earth every 92.9 minutes at 408 km altitude. Reboosted regularly against drag.',
  },
  {
    id: 'hubble', name: 'Hubble Space Telescope', massKg: 11110, radiusKm: 0.0066,
    color: '#c8ccd2', orbitAu: 4.6247e-5,
    description: '2.4 m optical telescope in a 538 km orbit since 1990. Serviced five times by Shuttle crews.',
  },
  {
    id: 'jwst', name: 'James Webb Space Telescope', massKg: 6161.4, radiusKm: 0.0105,
    color: '#e0c060', orbitAu: 0.01,
    description: '6.5 m infrared telescope in a halo orbit about the Sun-Earth L2 point, 1.5 million km out. Turn on Lagrange markers to see where it sits.',
  },
  {
    id: 'voyager-1', name: 'Voyager 1', massKg: 825.5, radiusKm: 0.0037,
    color: '#b0b6bd', orbitAu: 167,
    description: 'Most distant human-made object, past the heliopause on a hyperbolic escape trajectory at 17 km/s. Launched 1977.',
  },
  {
    id: 'voyager-2', name: 'Voyager 2', massKg: 721.9, radiusKm: 0.0037,
    color: '#a9afb6', orbitAu: 139,
    description: 'The only spacecraft to visit all four giant planets, using a once-per-176-year gravity-assist alignment.',
  },
  {
    id: 'new-horizons', name: 'New Horizons', massKg: 478, radiusKm: 0.0021,
    color: '#c2b8a8', orbitAu: 62,
    description: 'Flew past Pluto in 2015 and Arrokoth in 2019, on a solar-escape trajectory after a Jupiter gravity assist.',
  },
  {
    id: 'parker-solar-probe', name: 'Parker Solar Probe', massKg: 685, radiusKm: 0.0015,
    color: '#e8dcc0', orbitAu: 0.04601,
    description: 'Fastest human-made object at 192 km/s perihelion, skimming 6.9 million km from the Sun behind a carbon-composite shield.',
  },
  {
    id: 'gps-satellite', name: 'GPS Satellite', massKg: 1630, radiusKm: 0.0035,
    color: '#9fb4c8', orbitAu: 1.7754e-4,
    description: 'Block IIF navigation satellite in a 26,560 km semi-synchronous orbit. Its clocks need both special- and general-relativistic corrections.',
  },
  {
    id: 'tiangong', name: 'Tiangong Space Station', massKg: 100000, radiusKm: 0.0275,
    color: '#cfd6dd', orbitAu: 4.5194e-5,
    description: 'Three-module Chinese station at 389 km altitude, roughly a fifth the mass of the ISS.',
  },
  {
    id: 'starlink-sat', name: 'Starlink Satellite', massKg: 260, radiusKm: 0.0035,
    color: '#8f9aa6', orbitAu: 4.6318e-5,
    description: 'One v1.5 unit from a constellation of thousands at 550 km. Spawn a few dozen to see how a shell of co-orbiting objects behaves.',
  },
]);

// ---------------------------------------------------------------------------
// Public catalogue
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  id: PresetCategory;
  label: string;
  /** One-line orientation shown above the list. */
  blurb: string;
}

/** Display order of the tabs. `custom` is last — it is the manual escape hatch. */
export const PRESET_CATEGORIES: CategoryMeta[] = [
  { id: 'planets', label: 'Planets', blurb: 'The eight Terran and Jovian planets, at true mass and radius.' },
  { id: 'dwarf_planets', label: 'Dwarf Planets', blurb: 'Dwarf planets and trans-Neptunian objects out to the inner Oort cloud.' },
  { id: 'moons', label: 'Moons', blurb: 'Major natural satellites. Orbit these around their parent planet, not the star.' },
  { id: 'stars', label: 'Stars', blurb: 'Main-sequence stars, giants, white dwarfs and pulsars.' },
  { id: 'black_holes', label: 'Black Holes', blurb: 'Compact objects sized by their Schwarzschild radius, 2GM/c².' },
  { id: 'exoplanets_comets', label: 'Exoplanets & Small Bodies', blurb: 'Exoplanets, comets, asteroids and interstellar visitors.' },
  { id: 'spacecraft', label: 'Spacecraft', blurb: 'Artificial satellites and probes — test masses that barely perturb anything.' },
  { id: 'custom', label: 'Custom', blurb: 'Enter raw simulation values directly.' },
];

/** Every catalogue entry, in tab order. */
export const ASTRONOMICAL_PRESETS: AstronomicalPreset[] = [
  ...PLANETS,
  ...DWARF_PLANETS,
  ...MOONS,
  ...STARS,
  ...BLACK_HOLES,
  ...EXOPLANETS_COMETS,
  ...SPACECRAFT,
];

const BY_ID = new Map(ASTRONOMICAL_PRESETS.map((p) => [p.id, p]));

const BY_CATEGORY = ((): Record<PresetCategory, AstronomicalPreset[]> => {
  const map = Object.fromEntries(
    PRESET_CATEGORIES.map((c) => [c.id, [] as AstronomicalPreset[]])
  ) as Record<PresetCategory, AstronomicalPreset[]>;
  for (const preset of ASTRONOMICAL_PRESETS) map[preset.category].push(preset);
  return map;
})();

export function getPresetsByCategory(category: PresetCategory): AstronomicalPreset[] {
  return BY_CATEGORY[category] ?? [];
}

export function getPresetById(id: string): AstronomicalPreset | undefined {
  return BY_ID.get(id);
}

const CATEGORY_LABELS = new Map(PRESET_CATEGORIES.map((c) => [c.id, c.label.toLowerCase()]));

/**
 * Free-text search across the whole catalogue.
 *
 * Ranked rather than filtered: a name prefix beats a name substring beats a
 * description hit, so typing "ear" puts Earth first instead of burying it
 * under every body whose description mentions Earth. Ties keep catalogue
 * order, which is the order the categories are presented in.
 */
export function searchPresets(
  query: string,
  presets: AstronomicalPreset[] = ASTRONOMICAL_PRESETS
): AstronomicalPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;

  const scored: { preset: AstronomicalPreset; score: number; index: number }[] = [];
  presets.forEach((preset, index) => {
    const name = preset.name.toLowerCase();
    let score = 0;
    if (name === q) score = 5;
    else if (name.startsWith(q)) score = 4;
    else if (name.includes(q)) score = 3;
    else if ((CATEGORY_LABELS.get(preset.category) ?? '').includes(q)) score = 2;
    else if (preset.description.toLowerCase().includes(q)) score = 1;
    if (score > 0) scored.push({ preset, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.preset);
}
