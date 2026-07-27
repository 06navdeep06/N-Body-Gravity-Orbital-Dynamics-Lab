/**
 * Procedurally generated fallback textures.
 *
 * The photorealistic renderer wants PBR maps for every body, but the app
 * ships with no bundled imagery and is deployed as a static export — a
 * missing file must never be able to break startup. So every map has a
 * procedural twin generated here on a 2D canvas, and the loader in
 * `texture-library.ts` falls back to these whenever a real asset is absent
 * or fails to decode.
 *
 * Everything is sampled from 3D value noise evaluated on the unit sphere
 * rather than from 2D noise in UV space. That costs a direction vector per
 * texel but removes the seam at u = 0/1 and the pinching at the poles, which
 * a 2D-noise equirectangular map always shows.
 */

import * as THREE from "three";

/** Equirectangular map size. Small on purpose: these are generated on the
 *  main thread, and 512x256 keeps that under a frame's worth of work. */
const EQUIRECT_WIDTH = 512;
const EQUIRECT_HEIGHT = 256;

export type SurfaceKind = "rocky" | "terrestrial" | "gas" | "icy" | "star";

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** Deterministic 3D integer hash in [0, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed + x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Trilinearly interpolated value noise. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);

  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);

  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}

/** Fractal Brownian motion over `octaves` of value noise, normalised to [0,1]. */
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise3(fx, fy, fz, seed + i * 1013);
    total += amplitude;
    fx *= 2.02;
    fy *= 2.02;
    fz *= 2.02;
    amplitude *= 0.5;
  }
  return total > 0 ? value / total : 0;
}

/** Ridged variant — produces mountain chains and cloud filaments. */
function ridged3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise3(fx, fy, fz, seed + i * 7919) * 2 - 1);
    value += amplitude * n * n;
    total += amplitude;
    fx *= 2.07;
    fy *= 2.07;
    fz *= 2.07;
    amplitude *= 0.5;
  }
  return total > 0 ? value / total : 0;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

const canDraw = (): boolean => typeof document !== "undefined";

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Direction on the unit sphere for an equirectangular texel. `v = 0` is the
 * south pole, matching three's SphereGeometry UV convention.
 */
function equirectDirection(u: number, v: number, out: [number, number, number]): void {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const sinTheta = Math.sin(theta);
  out[0] = sinTheta * Math.cos(phi);
  out[1] = Math.cos(theta);
  out[2] = sinTheta * Math.sin(phi);
}

function finishTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Stable numeric seed from a body id, so a body's surface never changes. */
export function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toRgb(color: THREE.Color): Rgb {
  return { r: color.r, g: color.g, b: color.b };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// ---------------------------------------------------------------------------
// Surface height field — shared by albedo, normal and roughness so the three
// maps describe the same world instead of three unrelated ones.
// ---------------------------------------------------------------------------

/**
 * Elevation in [0,1] for a direction on the sphere. `kind` selects the
 * character: continents for rocky/terrestrial worlds, zonal bands for gas
 * giants, granulation cells for stars.
 */
function elevation(kind: SurfaceKind, d: [number, number, number], seed: number): number {
  const [x, y, z] = d;
  switch (kind) {
    case "gas": {
      // Zonal banding: latitude stripes advected by turbulence, which is what
      // makes Jovian belts read as flow rather than as painted lines.
      const turbulence = fbm3(x * 2.4, y * 2.4, z * 2.4, seed, 4) - 0.5;
      const bands = Math.sin((y + turbulence * 0.35) * 11.0) * 0.5 + 0.5;
      const storms = ridged3(x * 5.5, y * 9.0, z * 5.5, seed + 31, 3);
      return clamp01(bands * 0.72 + storms * 0.28);
    }
    case "star": {
      // Granulation: small convective cells over a slow large-scale variation.
      const cells = ridged3(x * 9.0, y * 9.0, z * 9.0, seed, 3);
      const broad = fbm3(x * 2.2, y * 2.2, z * 2.2, seed + 77, 3);
      return clamp01(0.55 + cells * 0.3 + broad * 0.15 - 0.25);
    }
    case "icy": {
      const base = fbm3(x * 3.2, y * 3.2, z * 3.2, seed, 5);
      const cracks = 1 - ridged3(x * 7.0, y * 7.0, z * 7.0, seed + 13, 3);
      return clamp01(base * 0.75 + cracks * 0.25);
    }
    case "rocky":
    case "terrestrial":
    default: {
      const continents = fbm3(x * 1.9, y * 1.9, z * 1.9, seed, 5);
      const mountains = ridged3(x * 6.0, y * 6.0, z * 6.0, seed + 401, 4);
      return clamp01(continents * 0.78 + mountains * 0.22);
    }
  }
}

/** Sea level for kinds that have oceans; anything below is water. */
const OCEAN_LEVEL = 0.48;

// ---------------------------------------------------------------------------
// Albedo
// ---------------------------------------------------------------------------

/**
 * Equirectangular albedo map tinted toward `baseColor`, so a procedurally
 * generated body still reads as "the blue one" / "the red one" the way the
 * flat-shaded renderer did.
 */
export function proceduralAlbedo(
  baseColor: THREE.ColorRepresentation,
  seed: number,
  kind: SurfaceKind
): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const canvas = createCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const base = toRgb(new THREE.Color(baseColor));
  const image = ctx.createImageData(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const data = image.data;
  const dir: [number, number, number] = [0, 0, 0];

  // Palette endpoints derived from the body's own colour so the tint carries.
  const dark = mixRgb(base, { r: 0.02, g: 0.03, b: 0.06 }, 0.62);
  const light = mixRgb(base, { r: 1, g: 1, b: 1 }, 0.55);
  const ocean = mixRgb(base, { r: 0.02, g: 0.09, b: 0.28 }, 0.7);
  const shore = mixRgb(base, { r: 0.85, g: 0.78, b: 0.55 }, 0.45);

  for (let py = 0; py < EQUIRECT_HEIGHT; py++) {
    const v = (py + 0.5) / EQUIRECT_HEIGHT;
    for (let px = 0; px < EQUIRECT_WIDTH; px++) {
      const u = (px + 0.5) / EQUIRECT_WIDTH;
      equirectDirection(u, v, dir);
      const h = elevation(kind, dir, seed);

      let color: Rgb;
      if (kind === "terrestrial") {
        if (h < OCEAN_LEVEL) {
          // Deeper water is darker — depth read straight off the height field.
          color = mixRgb(mixRgb(ocean, { r: 0, g: 0.02, b: 0.08 }, 0.6), ocean, h / OCEAN_LEVEL);
        } else {
          const land = (h - OCEAN_LEVEL) / (1 - OCEAN_LEVEL);
          color = mixRgb(shore, light, land);
          color = mixRgb(color, dark, 1 - land * 0.8);
        }
        // Polar ice caps.
        const lat = Math.abs(dir[1]);
        const ice = clamp01((lat - 0.78) / 0.22);
        if (ice > 0) color = mixRgb(color, { r: 0.93, g: 0.96, b: 1 }, ice * 0.9);
      } else if (kind === "star") {
        color = mixRgb(mixRgb(base, { r: 1, g: 0.85, b: 0.55 }, 0.4), { r: 1, g: 1, b: 0.95 }, h);
      } else {
        color = mixRgb(dark, light, h);
      }

      const offset = (py * EQUIRECT_WIDTH + px) * 4;
      data[offset] = Math.round(clamp01(color.r) * 255);
      data[offset + 1] = Math.round(clamp01(color.g) * 255);
      data[offset + 2] = Math.round(clamp01(color.b) * 255);
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return finishTexture(canvas, true);
}

// ---------------------------------------------------------------------------
// Normal map
// ---------------------------------------------------------------------------

/**
 * Tangent-space normal map built from the same height field as the albedo,
 * by central differences in UV. Water is flattened deliberately: ocean
 * surfaces are not topography, and letting continental noise ripple across
 * them destroys the specular highlight the roughness map sets up.
 */
export function proceduralNormal(
  seed: number,
  kind: SurfaceKind,
  strength = 1
): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const canvas = createCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const data = image.data;
  const dir: [number, number, number] = [0, 0, 0];
  const du = 1 / EQUIRECT_WIDTH;
  const dv = 1 / EQUIRECT_HEIGHT;

  const sample = (u: number, v: number): number => {
    equirectDirection(u - Math.floor(u), clamp01(v), dir);
    const h = elevation(kind, dir, seed);
    if (kind === "terrestrial" && h < OCEAN_LEVEL) return OCEAN_LEVEL;
    return h;
  };

  for (let py = 0; py < EQUIRECT_HEIGHT; py++) {
    const v = (py + 0.5) / EQUIRECT_HEIGHT;
    for (let px = 0; px < EQUIRECT_WIDTH; px++) {
      const u = (px + 0.5) / EQUIRECT_WIDTH;
      const hL = sample(u - du, v);
      const hR = sample(u + du, v);
      const hD = sample(u, v - dv);
      const hU = sample(u, v + dv);

      // Slope scaled by texel size so the perturbation is resolution-independent.
      const nx = (hL - hR) * strength * 6;
      const ny = (hD - hU) * strength * 6;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);

      const offset = (py * EQUIRECT_WIDTH + px) * 4;
      data[offset] = Math.round((nx / len * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  // Normal maps are data, not colour — tagging them sRGB would bend the vectors.
  return finishTexture(canvas, false);
}

// ---------------------------------------------------------------------------
// Roughness map
// ---------------------------------------------------------------------------

/**
 * Roughness/specular mask. On terrestrial worlds this is what separates
 * mirror-like oceans (low roughness, so the star glints off them) from matte
 * land — the single cue that most sells a planet as photoreal.
 */
export function proceduralRoughness(seed: number, kind: SurfaceKind): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const canvas = createCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const data = image.data;
  const dir: [number, number, number] = [0, 0, 0];

  for (let py = 0; py < EQUIRECT_HEIGHT; py++) {
    const v = (py + 0.5) / EQUIRECT_HEIGHT;
    for (let px = 0; px < EQUIRECT_WIDTH; px++) {
      const u = (px + 0.5) / EQUIRECT_WIDTH;
      equirectDirection(u, v, dir);
      const h = elevation(kind, dir, seed);

      let roughness: number;
      if (kind === "terrestrial") {
        roughness = h < OCEAN_LEVEL ? 0.12 : 0.72 + (h - OCEAN_LEVEL) * 0.3;
        const ice = clamp01((Math.abs(dir[1]) - 0.78) / 0.22);
        roughness = roughness + (0.35 - roughness) * ice;
      } else if (kind === "icy") {
        roughness = 0.3 + h * 0.35;
      } else if (kind === "gas") {
        roughness = 0.85 + h * 0.1;
      } else if (kind === "star") {
        roughness = 1;
      } else {
        roughness = 0.7 + h * 0.25;
      }

      const value = Math.round(clamp01(roughness) * 255);
      const offset = (py * EQUIRECT_WIDTH + px) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return finishTexture(canvas, false);
}

// ---------------------------------------------------------------------------
// Cloud alpha map
// ---------------------------------------------------------------------------

/**
 * Cloud shell texture: white RGB with cloud cover in alpha, so one map can
 * serve as both `map` and `alphaMap` on the shell. `coverage` in [0,1] shifts
 * the threshold — Venus wants near-total cover, Mars almost none.
 */
export function proceduralClouds(seed: number, coverage = 0.5): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const canvas = createCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const data = image.data;
  const dir: [number, number, number] = [0, 0, 0];
  const threshold = 1 - coverage;

  for (let py = 0; py < EQUIRECT_HEIGHT; py++) {
    const v = (py + 0.5) / EQUIRECT_HEIGHT;
    for (let px = 0; px < EQUIRECT_WIDTH; px++) {
      const u = (px + 0.5) / EQUIRECT_WIDTH;
      equirectDirection(u, v, dir);
      // Zonal stretch (x4 in longitude vs latitude) mimics banded circulation.
      const n = fbm3(dir[0] * 3.0, dir[1] * 7.0, dir[2] * 3.0, seed + 909, 5);
      const wisps = ridged3(dir[0] * 8.0, dir[1] * 14.0, dir[2] * 8.0, seed + 55, 3);
      const density = clamp01((n * 0.7 + wisps * 0.3 - threshold) / Math.max(0.15, 1 - threshold));

      const offset = (py * EQUIRECT_WIDTH + px) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(clamp01(density * 1.15) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  return finishTexture(canvas, true);
}

// ---------------------------------------------------------------------------
// Ring map
// ---------------------------------------------------------------------------

/**
 * Ring texture as a 1-D radial profile stretched to a thin strip: `u` runs
 * from the inner to the outer edge. Consumers must supply radial UVs (see
 * `makeRadialRingGeometry` in PhotorealisticBody) — three's own RingGeometry
 * UVs are box-projected and would smear this across the annulus.
 */
export function proceduralRingMap(
  baseColor: THREE.ColorRepresentation,
  seed: number
): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const width = 512;
  const canvas = createCanvas(width, 4);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const base = toRgb(new THREE.Color(baseColor));
  const bright = mixRgb(base, { r: 1, g: 0.97, b: 0.9 }, 0.6);
  const dim = mixRgb(base, { r: 0.15, g: 0.13, b: 0.11 }, 0.7);
  const image = ctx.createImageData(width, 4);
  const data = image.data;

  for (let px = 0; px < width; px++) {
    const t = (px + 0.5) / width;

    // Fine ringlets plus a couple of wide divisions (Cassini-like gaps).
    let density = 0.55 + 0.45 * fbm3(t * 42, 0.5, 0.5, seed, 4);
    density *= 0.35 + 0.65 * fbm3(t * 160, 3.5, 1.5, seed + 21, 3);
    for (const [center, halfWidth] of [
      [0.42, 0.035],
      [0.71, 0.018],
    ] as const) {
      const gap = 1 - clamp01(1 - Math.abs(t - center) / halfWidth);
      density *= gap;
    }
    // Soft inner and outer falloff so the annulus has no hard cut.
    density *= clamp01(t / 0.06) * clamp01((1 - t) / 0.08);

    const color = mixRgb(dim, bright, clamp01(density));
    for (let py = 0; py < 4; py++) {
      const offset = (py * width + px) * 4;
      data[offset] = Math.round(clamp01(color.r) * 255);
      data[offset + 1] = Math.round(clamp01(color.g) * 255);
      data[offset + 2] = Math.round(clamp01(color.b) * 255);
      data[offset + 3] = Math.round(clamp01(density) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = finishTexture(canvas, true);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Starfield environment
// ---------------------------------------------------------------------------

/**
 * Equirectangular starfield used as the scene background when no HDRI is
 * present. Stars are drawn as radial sprites with a colour temperature
 * distribution, over a faint galactic band, so the fallback still reads as
 * deep space rather than as flat black.
 */
let starfieldCache: THREE.CanvasTexture | null | undefined;

export function proceduralStarfield(seed = 1337): THREE.CanvasTexture | null {
  if (starfieldCache !== undefined) return starfieldCache;
  starfieldCache = buildStarfield(seed);
  return starfieldCache;
}

function buildStarfield(seed: number): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const width = 2048;
  const height = 1024;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#03040a";
  ctx.fillRect(0, 0, width, height);

  // Galactic band: a diffuse, slightly tilted nebular streak.
  const band = ctx.createLinearGradient(0, height * 0.32, 0, height * 0.68);
  band.addColorStop(0, "rgba(30,40,80,0)");
  band.addColorStop(0.5, "rgba(70,80,130,0.22)");
  band.addColorStop(1, "rgba(30,40,80,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, width, height);

  let rngState = seed >>> 0;
  const rng = (): number => {
    rngState = (Math.imul(rngState ^ (rngState >>> 15), 1 | rngState) + 0x6d2b79f5) >>> 0;
    return rngState / 4294967296;
  };

  const STAR_COUNT = 4200;
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = rng() * width;
    // acos-distributed latitude keeps star density uniform on the sphere
    // instead of piling up at the poles the way uniform-in-v would.
    const y = (Math.acos(1 - 2 * rng()) / Math.PI) * height;
    const magnitude = Math.pow(rng(), 3.2);
    const radius = 0.4 + magnitude * 2.6;
    const temperature = rng();
    const r = 190 + temperature * 65;
    const g = 195 + Math.sin(temperature * Math.PI) * 45;
    const b = 205 + (1 - temperature) * 50;
    const alpha = 0.25 + magnitude * 0.75;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${alpha})`);
    gradient.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = finishTexture(canvas, true);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Debris normal map
// ---------------------------------------------------------------------------

/**
 * Tileable pitted-rock normal map for instanced asteroid debris.
 *
 * Cached and never disposed: every rock in every belt shares one map, and
 * regenerating it costs a million noise evaluations on the main thread —
 * which is a visible hitch if it happens on a preset switch.
 */
const rockNormalCache = new Map<number, THREE.CanvasTexture | null>();

export function proceduralRockNormal(seed = 4242): THREE.CanvasTexture | null {
  const cached = rockNormalCache.get(seed);
  if (cached !== undefined) return cached;
  const texture = buildRockNormal(seed);
  rockNormalCache.set(seed, texture);
  return texture;
}

function buildRockNormal(seed: number): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const size = 128;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(size, size);
  const data = image.data;

  // 2D slice of the 3D noise field, wrapped by sampling on a torus so the
  // map tiles seamlessly across every instance's UVs.
  const heightAt = (u: number, v: number): number => {
    const a = u * Math.PI * 2;
    const b = v * Math.PI * 2;
    const x = Math.cos(a) * 1.6;
    const y = Math.sin(a) * 1.6;
    const z = Math.cos(b) * 1.6 + Math.sin(b) * 1.6;
    return ridged3(x * 3, y * 3, z * 3, seed, 4);
  };

  const step = 1 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px * step;
      const v = py * step;
      const nx = (heightAt(u - step, v) - heightAt(u + step, v)) * 5;
      const ny = (heightAt(u, v - step) - heightAt(u, v + step)) * 5;
      const len = Math.hypot(nx, ny, 1);
      const offset = (py * size + px) * 4;
      data[offset] = Math.round((nx / len * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = finishTexture(canvas, false);
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
