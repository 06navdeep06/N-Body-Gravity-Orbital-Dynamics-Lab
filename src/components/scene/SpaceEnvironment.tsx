"use client";

/**
 * Deep-space background.
 *
 * Three tiers, chosen by what is actually available:
 *
 *  1. An 8K equirectangular HDRI at `public/textures/env/starfield.hdr`, used
 *     as both background and image-based lighting, if the file exists.
 *  2. A procedurally generated equirectangular starfield, if not.
 *  3. drei's `<Stars>` point cloud at the Low preset, which is what the
 *     renderer used before this overhaul and costs almost nothing.
 *
 * The HDRI is probed with a HEAD request before drei's `<Environment>` is
 * mounted. That is the whole point: `<Environment files=...>` loads through
 * suspense and throws to the nearest error boundary on a 404, so mounting it
 * unconditionally would put the app in an error state on first paint for
 * every deployment that ships no HDRI — which is the default one.
 */

import { Environment, Stars } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQualityPreset } from "@/lib/render/quality-preset";
import { proceduralStarfield } from "@/lib/textures/procedural";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TEXTURE_BASE = process.env.NEXT_PUBLIC_TEXTURE_BASE ?? `${BASE_PATH}/textures`;
const HDRI_URL = `${TEXTURE_BASE}/env/starfield.hdr`;

/** Scene exposure, in stops applied to the tone mapper. */
const ENVIRONMENT_INTENSITY = 0.35;

type ProbeResult = "pending" | "present" | "absent";

/**
 * HEAD-probes the HDRI once per session.
 *
 * Unconditional, even at the Low preset: it is a single HEAD request, and
 * doing it up front means switching to Medium later swaps in the real sky
 * immediately instead of after a round trip.
 */
function useHdriProbe(): ProbeResult {
  const [result, setResult] = useState<ProbeResult>("pending");

  useEffect(() => {
    let cancelled = false;
    fetch(HDRI_URL, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) setResult(response.ok ? "present" : "absent");
      })
      .catch(() => {
        // Offline, CORS-blocked, or simply not deployed — all mean "fall back".
        if (!cancelled) setResult("absent");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return result;
}

/**
 * Applies the procedural starfield as background and environment map.
 *
 * Attached declaratively rather than assigned onto the scene object: r3f's
 * `attach` records and restores the previous value on unmount, which is
 * exactly the swap semantics needed when the real HDRI finishes probing.
 */
function ProceduralSky() {
  const texture = useMemo(() => proceduralStarfield(), []);
  if (!texture) return null;

  return (
    <>
      <primitive object={texture} attach="background" />
      {/* A starfield contributes essentially no ambient light, but using it as
          the environment map still gives metallic surfaces something other
          than black to reflect. */}
      <primitive object={texture} attach="environment" />
    </>
  );
}

export function SpaceEnvironment() {
  const features = useQualityPreset();
  const probe = useHdriProbe();

  if (!features.environmentMap) {
    // Low preset: the original cheap point-sprite starfield.
    return <Stars radius={300} depth={80} count={3000} factor={4} fade speed={0.5} />;
  }

  if (probe === "present") {
    return (
      <Suspense fallback={<ProceduralSky />}>
        <Environment
          files={HDRI_URL}
          background
          environmentIntensity={ENVIRONMENT_INTENSITY}
          backgroundIntensity={1}
        />
      </Suspense>
    );
  }

  // "pending" renders the procedural sky too, so there is never a black frame
  // while the probe is in flight.
  return <ProceduralSky />;
}
