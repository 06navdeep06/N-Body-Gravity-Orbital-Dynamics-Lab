"use client";

/**
 * Resilient PBR texture loading for celestial bodies.
 *
 * ## Asset path convention
 *
 * Real imagery is optional. When present it lives under `public/textures/`
 * and is addressed by body slug:
 *
 *   public/textures/bodies/<slug>/albedo.jpg      base colour  (sRGB)
 *   public/textures/bodies/<slug>/normal.jpg      tangent-space normals
 *   public/textures/bodies/<slug>/roughness.jpg   roughness / ocean mask
 *   public/textures/bodies/<slug>/clouds.png      cloud cover in the alpha channel
 *   public/textures/bodies/<slug>/ring.png        radial ring profile
 *   public/textures/env/starfield.hdr             8K equirectangular skybox
 *
 * `<slug>` is the lowercased body name (`earth`, `jupiter`, `saturn`, ...).
 * All maps must be equirectangular and are expected at 2:1 aspect. Remote
 * CDN URLs work too — set `NEXT_PUBLIC_TEXTURE_BASE` to an absolute origin
 * and make sure it serves `Access-Control-Allow-Origin`, since WebGL uploads
 * from a cross-origin image without CORS headers taint the canvas and break
 * the PNG/WebM export path.
 *
 * A `manifest.json` at the base declares what actually exists:
 *
 *   { "bodies": { "earth": ["albedo", "normal", "clouds"] }, "env": ["starfield"] }
 *
 * Nothing is requested unless the manifest lists it. Without that, a
 * deployment with no imagery — the default one — fires a 404 for every map of
 * every visible body on startup, which buries real errors in the console and
 * reads as a broken app even though the fallbacks are working exactly as
 * intended. One request for the manifest replaces all of them.
 *
 * ## Why not `useTexture`
 *
 * drei's `useTexture` suspends and, on a 404, throws into the nearest error
 * boundary — with no bundled assets that would mean the app renders an error
 * state on first paint for the common case. Loading here is therefore
 * promise-based and non-suspending: the body renders immediately with its
 * procedural fallback and swaps in real imagery only once it has decoded.
 * Nothing ever blocks startup and no load failure is unhandled.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { CelestialBody } from "@/lib/physics/types";
import {
  proceduralAlbedo,
  proceduralClouds,
  proceduralNormal,
  proceduralRingMap,
  proceduralRoughness,
  seedFromId,
  type SurfaceKind,
} from "./procedural";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TEXTURE_BASE = process.env.NEXT_PUBLIC_TEXTURE_BASE ?? `${BASE_PATH}/textures`;

export interface AtmosphereProfile {
  /** Rayleigh (single-scattered) rim colour — blue for Earth, rust for Mars. */
  rayleigh: THREE.ColorRepresentation;
  /** Mie (aerosol, forward-scattered) colour, seen near the sub-solar limb. */
  mie: THREE.ColorRepresentation;
  /** Optical thickness; scales the overall opacity of the shell. */
  thickness: number;
  /** Fresnel exponent — higher values pull the halo tighter to the limb. */
  power: number;
}

export interface RingProfile {
  /** Inner edge as a multiple of the body's display radius. */
  innerScale: number;
  /** Outer edge as a multiple of the body's display radius. */
  outerScale: number;
  /** Tilt of the ring plane from the body's equator, in radians. */
  tilt: number;
  color: THREE.ColorRepresentation;
}

export interface BodyRenderProfile {
  slug: string;
  kind: SurfaceKind;
  /** Cloud shell coverage in [0,1]; 0 disables the shell entirely. */
  cloudCoverage: number;
  /** Cloud rotation rate relative to the surface, radians/second. */
  cloudDrift: number;
  atmosphere: AtmosphereProfile | null;
  ring: RingProfile | null;
  /** Emissive strength; > 0 makes the body self-lit (stars). */
  emissive: number;
  metalness: number;
}

const EARTH_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#3d7bff",
  mie: "#bcd8ff",
  thickness: 1.1,
  power: 2.6,
};

const MARS_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#c2643a",
  mie: "#ffd9b0",
  thickness: 0.55,
  power: 3.2,
};

const VENUS_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#e8c98a",
  mie: "#fff4d6",
  thickness: 1.6,
  power: 2.1,
};

const GAS_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#9fb6d8",
  mie: "#ffe8c8",
  thickness: 0.8,
  power: 3.0,
};

const ICE_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#5fd0e0",
  mie: "#d8f6ff",
  thickness: 0.9,
  power: 2.8,
};

const STAR_ATMOSPHERE: AtmosphereProfile = {
  rayleigh: "#ffb347",
  mie: "#fff6d8",
  thickness: 1.8,
  power: 1.6,
};

function profile(overrides: Partial<BodyRenderProfile> & { slug: string }): BodyRenderProfile {
  return {
    kind: "rocky",
    cloudCoverage: 0,
    cloudDrift: 0.004,
    atmosphere: null,
    ring: null,
    emissive: 0,
    metalness: 0.05,
    ...overrides,
  };
}

/** Named profiles for the bodies the Real Solar System preset ships with. */
export const BODY_PROFILES: Record<string, BodyRenderProfile> = {
  sun: profile({ slug: "sun", kind: "star", emissive: 1, atmosphere: STAR_ATMOSPHERE }),
  mercury: profile({ slug: "mercury", kind: "rocky", metalness: 0.12 }),
  venus: profile({
    slug: "venus",
    kind: "rocky",
    cloudCoverage: 0.95,
    cloudDrift: 0.02,
    atmosphere: VENUS_ATMOSPHERE,
  }),
  earth: profile({
    slug: "earth",
    kind: "terrestrial",
    cloudCoverage: 0.5,
    cloudDrift: 0.008,
    atmosphere: EARTH_ATMOSPHERE,
  }),
  moon: profile({ slug: "moon", kind: "rocky" }),
  luna: profile({ slug: "moon", kind: "rocky" }),
  mars: profile({ slug: "mars", kind: "rocky", cloudCoverage: 0.12, atmosphere: MARS_ATMOSPHERE }),
  jupiter: profile({
    slug: "jupiter",
    kind: "gas",
    cloudDrift: 0.012,
    atmosphere: GAS_ATMOSPHERE,
  }),
  saturn: profile({
    slug: "saturn",
    kind: "gas",
    cloudDrift: 0.011,
    atmosphere: GAS_ATMOSPHERE,
    ring: { innerScale: 1.24, outerScale: 2.35, tilt: 0.47, color: "#d8c9a3" },
  }),
  uranus: profile({
    slug: "uranus",
    kind: "icy",
    atmosphere: ICE_ATMOSPHERE,
    ring: { innerScale: 1.6, outerScale: 2.0, tilt: 1.71, color: "#8fb8c8" },
  }),
  neptune: profile({
    slug: "neptune",
    kind: "icy",
    cloudCoverage: 0.25,
    cloudDrift: 0.016,
    atmosphere: ICE_ATMOSPHERE,
  }),
  pluto: profile({ slug: "pluto", kind: "icy" }),
  ceres: profile({ slug: "ceres", kind: "rocky" }),
  halley: profile({ slug: "halley", kind: "icy" }),
};

/**
 * Fallback profiles, held as module constants rather than built per call:
 * they are compared by reference in hook dependency arrays downstream, and a
 * fresh object each render would re-trigger texture loading every frame.
 */
const GENERIC_STAR = profile({
  slug: "generic-star",
  kind: "star",
  emissive: 1,
  atmosphere: STAR_ATMOSPHERE,
});
const GENERIC_GAS = profile({
  slug: "generic-gas",
  kind: "gas",
  cloudDrift: 0.012,
  atmosphere: GAS_ATMOSPHERE,
});
const GENERIC_TERRESTRIAL = profile({
  slug: "generic-terrestrial",
  kind: "terrestrial",
  cloudCoverage: 0.45,
  cloudDrift: 0.008,
  atmosphere: EARTH_ATMOSPHERE,
});
const GENERIC_ROCKY = profile({ slug: "generic-rocky", kind: "rocky" });

/**
 * Picks a render profile for a body. Named Solar System bodies get their real
 * profile; anything else (procedurally generated systems, user-launched
 * bodies, preset toys) is classified from mass and colour so it still gets a
 * plausible surface rather than a generic grey ball.
 */
export function profileForBody(body: CelestialBody, systemMaxMass: number): BodyRenderProfile {
  const named = BODY_PROFILES[body.name.trim().toLowerCase()];
  if (named) return named;

  const massFraction = systemMaxMass > 0 ? body.mass / systemMaxMass : 0;
  if (body.isFixed || massFraction > 0.5) return GENERIC_STAR;
  if (massFraction > 0.004) return GENERIC_GAS;

  // Blue-dominant small bodies read as ocean/ice worlds, everything else rock.
  const color = new THREE.Color(body.color);
  if (color.b > color.r * 1.15) return GENERIC_TERRESTRIAL;
  return GENERIC_ROCKY;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type TextureSlot = "albedo" | "normal" | "roughness" | "clouds" | "ring";

export interface BodyTextureSet {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  cloudMap: THREE.Texture | null;
  ringMap: THREE.Texture | null;
  /** True once at least one real (non-procedural) asset resolved. */
  usingAssets: boolean;
}

const EMPTY_SET: BodyTextureSet = {
  map: null,
  normalMap: null,
  roughnessMap: null,
  cloudMap: null,
  ringMap: null,
  usingAssets: false,
};

const EXTENSIONS: Record<TextureSlot, string> = {
  albedo: "jpg",
  normal: "jpg",
  roughness: "jpg",
  clouds: "png",
  ring: "png",
};

function assetUrl(slug: string, slot: TextureSlot): string {
  return `${TEXTURE_BASE}/bodies/${slug}/${slot}.${EXTENSIONS[slot]}`;
}

/**
 * Textures are cached by cache key across every component that asks for them —
 * a hundred asteroids sharing the "generic-rocky" profile generate one set,
 * not a hundred. Entries are never evicted: the key space is bounded by the
 * number of distinct profiles, and a GPU texture upload is exactly the thing
 * worth keeping around when a preset is reloaded.
 */
const textureCache = new Map<string, Promise<THREE.Texture | null>>();

const loader = /* lazily constructed, and only in the browser */ (() => {
  let instance: THREE.TextureLoader | null = null;
  return (): THREE.TextureLoader => {
    if (!instance) {
      instance = new THREE.TextureLoader();
      // Required for the PNG/WebM export path when TEXTURE_BASE is a CDN.
      instance.setCrossOrigin("anonymous");
    }
    return instance;
  };
})();

/** Shape of `manifest.json`; anything malformed is treated as absent. */
interface TextureManifest {
  bodies?: Record<string, string[]>;
  env?: string[];
}

let manifestPromise: Promise<TextureManifest | null> | null = null;

/**
 * Fetches the asset manifest once per session.
 *
 * A missing manifest is a normal state, not an error: it means "no imagery is
 * deployed, use the procedural surfaces", which is how the app ships.
 */
export function loadTextureManifest(): Promise<TextureManifest | null> {
  manifestPromise ??= fetch(`${TEXTURE_BASE}/manifest.json`)
    .then((response) => (response.ok ? (response.json() as Promise<TextureManifest>) : null))
    .then((manifest) => (manifest && typeof manifest === "object" ? manifest : null))
    .catch(() => null);
  return manifestPromise;
}

/** Whether the manifest advertises a given map. */
async function isDeclared(slug: string, slot: TextureSlot): Promise<boolean> {
  const manifest = await loadTextureManifest();
  return manifest?.bodies?.[slug]?.includes(slot) ?? false;
}

/**
 * Loads one map, falling back to its procedural twin. Every rejection path is
 * handled here — callers get a texture or null, never a throw.
 */
function loadSlot(
  slug: string,
  slot: TextureSlot,
  srgb: boolean,
  fallback: () => THREE.Texture | null
): Promise<THREE.Texture | null> {
  const key = `${slug}:${slot}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const pending = isDeclared(slug, slot)
    .then((declared) => {
      if (!declared) throw new Error("not declared");
      return loader().loadAsync(assetUrl(slug, slot));
    })
    .then((texture) => {
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    })
    .catch(() => fallback());

  textureCache.set(key, pending);
  return pending;
}

/** True when the resolved texture came from a real asset rather than a canvas. */
function isAsset(texture: THREE.Texture | null): boolean {
  return texture !== null && !(texture instanceof THREE.CanvasTexture);
}

/**
 * Loads the full map set for a profile. `enabled` gates the whole thing so
 * the Low quality preset never generates or fetches anything.
 */
export function useBodyTextures(
  body: CelestialBody,
  renderProfile: BodyRenderProfile,
  enabled: boolean
): BodyTextureSet {
  const [textures, setTextures] = useState<BodyTextureSet>(EMPTY_SET);

  // Generic profiles are shared across bodies, so their procedural surfaces
  // must not be seeded per body id or the cache would hand a hundred asteroids
  // whichever surface happened to be generated first. Named profiles key off
  // the slug for the same reason; only truly one-off bodies get their own seed.
  const seed = useMemo(
    () => (renderProfile.slug.startsWith("generic-") ? seedFromId(renderProfile.slug) : seedFromId(body.id)),
    [renderProfile.slug, body.id]
  );
  const cacheKey = renderProfile.slug.startsWith("generic-")
    ? renderProfile.slug
    : `${renderProfile.slug}-${seed}`;

  const { kind, cloudCoverage } = renderProfile;
  // Only primitives go in the dependency array below — `ring` is an object,
  // and comparing it by reference would restart loading whenever a caller
  // rebuilt the profile.
  const hasRing = renderProfile.ring !== null;
  const ringColor = String(renderProfile.ring?.color ?? "#ffffff");
  const bodyColor = body.color;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const jobs = [
      loadSlot(cacheKey, "albedo", true, () => proceduralAlbedo(bodyColor, seed, kind)),
      loadSlot(cacheKey, "normal", false, () => proceduralNormal(seed, kind)),
      loadSlot(cacheKey, "roughness", false, () => proceduralRoughness(seed, kind)),
      cloudCoverage > 0
        ? loadSlot(cacheKey, "clouds", true, () => proceduralClouds(seed, cloudCoverage))
        : Promise.resolve(null),
      hasRing
        ? loadSlot(cacheKey, "ring", true, () => proceduralRingMap(ringColor, seed))
        : Promise.resolve(null),
    ] as const;

    Promise.all(jobs).then(([map, normalMap, roughnessMap, cloudMap, ringMap]) => {
      if (cancelled) return;
      setTextures({
        map,
        normalMap,
        roughnessMap,
        cloudMap,
        ringMap,
        usingAssets: isAsset(map) || isAsset(normalMap) || isAsset(roughnessMap),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, cacheKey, seed, kind, cloudCoverage, hasRing, ringColor, bodyColor]);

  // Derived rather than cleared through setState: dropping to the Low preset
  // should stop the maps being used, not throw away the decoded textures that
  // switching back would immediately need again.
  return enabled ? textures : EMPTY_SET;
}
