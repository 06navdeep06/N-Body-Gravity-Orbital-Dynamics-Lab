"use client";

/**
 * Global rendering-fidelity control.
 *
 * Two things decide what actually gets drawn:
 *  - the user's chosen preset (Low / Medium / Cinematic), and
 *  - the existing frame-budget auto-scaler in `lib/performance/profiler`.
 *
 * They compose by taking the *lower* of the two. That keeps a single source
 * of truth for "we are dropping frames, cut work" — the profiler already
 * owns that decision and this layer must not fight it — while still letting
 * someone on a laptop pin the renderer to Low permanently.
 */

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { profiler, type QualityTier } from "@/lib/performance/profiler";

export type QualityPreset = "low" | "medium" | "cinematic";

/** Ascending fidelity — index comparisons below rely on this order. */
export const QUALITY_PRESETS: readonly QualityPreset[] = ["low", "medium", "cinematic"] as const;

export const QUALITY_PRESET_LABELS: Record<QualityPreset, string> = {
  low: "Low",
  medium: "Medium",
  cinematic: "Cinematic",
};

export interface RenderFeatures {
  /** The preset actually in force after the auto-scaler's ceiling is applied. */
  preset: QualityPreset;
  /** The preset the user asked for, before clamping. */
  requested: QualityPreset;
  /** True when the auto-scaler is holding fidelity below the request. */
  throttled: boolean;

  /** PBR surfaces with albedo/normal/roughness maps. */
  pbrMaterials: boolean;
  /** Separate alpha-mapped cloud shell above the surface. */
  cloudLayers: boolean;
  /** Rayleigh/Mie atmospheric scattering shell. */
  atmosphere: boolean;
  /** Alpha-mapped, shadow-casting planetary rings. */
  rings: boolean;
  /** Raymarched blackbody accretion disk (vs. the flat Doppler-beamed one). */
  volumetricDisk: boolean;
  /** Instanced 3D rock debris (vs. plain instanced spheres). */
  instancedDebris: boolean;
  /** Shadow maps on the primary star light. */
  dynamicShadows: boolean;
  shadowMapSize: number;

  /** Whether an EffectComposer is mounted at all. */
  postProcessing: boolean;
  bloom: boolean;
  depthOfField: boolean;
  /**
   * Star coronas and lens flares in `<StarEffects />`. Not a post-pass —
   * see the note in CinematicPipeline on why `<LensFlare />` is unusable
   * here.
   */
  lensFlare: boolean;
  godRays: boolean;
  /** Equirectangular HDRI / procedural starfield background. */
  environmentMap: boolean;

  /** Ceiling on how many bodies get the full photorealistic treatment. */
  featuredBodyBudget: number;
  /** Ceiling on instanced debris rocks. */
  debrisBudget: number;
  /** Sphere tessellation for featured bodies (higher than the instanced tier). */
  featuredSegments: number;
}

const LOW: RenderFeatures = {
  preset: "low",
  requested: "low",
  throttled: false,
  pbrMaterials: false,
  cloudLayers: false,
  atmosphere: false,
  rings: false,
  volumetricDisk: false,
  instancedDebris: false,
  dynamicShadows: false,
  shadowMapSize: 512,
  postProcessing: false,
  bloom: false,
  depthOfField: false,
  lensFlare: false,
  godRays: false,
  environmentMap: false,
  featuredBodyBudget: 0,
  debrisBudget: 0,
  featuredSegments: 24,
};

const MEDIUM: RenderFeatures = {
  ...LOW,
  preset: "medium",
  requested: "medium",
  pbrMaterials: true,
  cloudLayers: true,
  rings: true,
  instancedDebris: true,
  postProcessing: true,
  bloom: true,
  lensFlare: true,
  environmentMap: true,
  featuredBodyBudget: 8,
  debrisBudget: 600,
  featuredSegments: 48,
};

const CINEMATIC: RenderFeatures = {
  ...MEDIUM,
  preset: "cinematic",
  requested: "cinematic",
  atmosphere: true,
  volumetricDisk: true,
  dynamicShadows: true,
  shadowMapSize: 2048,
  depthOfField: true,
  godRays: true,
  featuredBodyBudget: 14,
  debrisBudget: 1500,
  featuredSegments: 64,
};

const FEATURES: Record<QualityPreset, RenderFeatures> = {
  low: LOW,
  medium: MEDIUM,
  cinematic: CINEMATIC,
};

/** Highest preset each auto-scaler tier permits. */
const TIER_CEILING: Record<QualityTier, QualityPreset> = {
  high: "cinematic",
  medium: "medium",
  low: "low",
};

const STORAGE_KEY = "nbody:quality-preset";

function readStoredPreset(): QualityPreset | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return QUALITY_PRESETS.includes(raw as QualityPreset) ? (raw as QualityPreset) : null;
  } catch {
    return null;
  }
}

interface QualityPresetState {
  /** What the user asked for. Not necessarily what is rendered. */
  requested: QualityPreset;
  setPreset: (preset: QualityPreset) => void;
  /** Reads the persisted choice; called once on mount. */
  hydrate: () => void;
}

export const useQualityStore = create<QualityPresetState>((set) => ({
  // Server render and first client render must agree, so the persisted value
  // is only applied in hydrate() after mount.
  requested: "cinematic",

  setPreset: (preset) => {
    set({ requested: preset });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, preset);
      } catch {
        // Private-mode storage denial is not worth failing a render over.
      }
    }
  },

  hydrate: () => {
    const stored = readStoredPreset();
    if (stored) set({ requested: stored });
  },
}));

/** The lower of two presets. */
function floor(a: QualityPreset, b: QualityPreset): QualityPreset {
  return QUALITY_PRESETS.indexOf(a) <= QUALITY_PRESETS.indexOf(b) ? a : b;
}

function resolve(requested: QualityPreset, tier: QualityTier): RenderFeatures {
  const effective = floor(requested, TIER_CEILING[tier]);
  return { ...FEATURES[effective], requested, throttled: effective !== requested };
}

/**
 * Imperative read for render-loop code, which must not subscribe to React
 * state. Mirrors `currentQualitySettings()` in the profiler.
 */
export function currentRenderFeatures(): RenderFeatures {
  return resolve(useQualityStore.getState().requested, profiler.quality);
}

/** Polling interval for the auto-scaler tier. */
const TIER_POLL_MS = 1000;

/**
 * The auto-scaler is a plain singleton mutated from the render loop, not a
 * store — so there is nothing to subscribe to. Polling it once a second is
 * enough: tier changes need 3-10 seconds of sustained FPS to trigger in the
 * first place, so a one-second lag is invisible, and this costs one property
 * read per second rather than a per-frame React update.
 */
function useAutoTier(): QualityTier {
  const [tier, setTier] = useState<QualityTier>(profiler.quality);
  useEffect(() => {
    const id = setInterval(() => {
      setTier((previous) => (previous === profiler.quality ? previous : profiler.quality));
    }, TIER_POLL_MS);
    return () => clearInterval(id);
  }, []);
  return tier;
}

/**
 * Reactive access to the effective render feature set. Components re-render
 * when the user changes preset or when the auto-scaler moves tier.
 */
export function useQualityPreset(): RenderFeatures {
  const requested = useQualityStore((s) => s.requested);
  const tier = useAutoTier();
  return useMemo(() => resolve(requested, tier), [requested, tier]);
}
