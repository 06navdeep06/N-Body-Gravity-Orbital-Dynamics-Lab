"use client";

/**
 * Selects which bodies get the full multi-layer treatment and mounts a
 * `<PhotorealisticBody />` for each.
 *
 * The selection itself lives in `lib/render/body-roles` because `<Bodies />`
 * and `<InstancedDebris />` have to agree with it exactly — every body is
 * drawn by precisely one of the three.
 *
 * Re-selection is deliberately *not* per frame. Bodies only change role when
 * the body list changes (preset load, collision merge, launch), so this
 * subscribes to the store's body array and recomputes on that, keeping the
 * per-frame path free of React work.
 */

import { useMemo } from "react";
import { assignBodyRoles, topologySignature } from "@/lib/render/body-roles";
import { useQualityPreset } from "@/lib/render/quality-preset";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { profileForBody } from "@/lib/textures/texture-library";
import { findBlackHoles } from "./BlackHole";
import { PhotorealisticBody } from "./PhotorealisticBody";

export function PhotorealisticBodies() {
  const features = useQualityPreset();
  // A number, not the array: see `topologySignature`. Subscribing to
  // `s.system.bodies` would re-render this subtree on every physics step.
  const topology = useSimulationStore((s) => topologySignature(s.system.bodies));
  const visualRadiusScale = useSimulationStore((s) => s.visualRadiusScale);
  const maxDisplayRadius = useSimulationStore((s) => s.maxDisplayRadius);

  const featured = useMemo(() => {
    if (!features.pbrMaterials) return [];

    // Read through getState() rather than a subscription — `topology` above is
    // what decides when this is stale, and the body objects captured here are
    // only used for identity and appearance. Live positions are read per frame
    // inside <PhotorealisticBody />.
    const { system, speedOfLight } = useSimulationStore.getState();
    const { bodies } = system;

    // Black holes are drawn by <BlackHole />; a lit PBR sphere over an event
    // horizon would be exactly wrong.
    const blackHoleIds = new Set(
      findBlackHoles(bodies, system.G, speedOfLight).map(({ body }) => body.id)
    );
    const { featured: indices } = assignBodyRoles(bodies, features, blackHoleIds);

    let maxMass = 0;
    for (const body of bodies) if (body.mass > maxMass) maxMass = body.mass;

    return indices.map((index) => {
      const body = bodies[index]!;
      const scaled = body.radius * visualRadiusScale;
      return {
        body,
        displayRadius: maxDisplayRadius > 0 ? Math.min(scaled, maxDisplayRadius) : scaled,
        profile: profileForBody(body, maxMass),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `topology` is the staleness signal for the getState() read above
  }, [topology, features, visualRadiusScale, maxDisplayRadius]);

  return (
    <>
      {featured.map(({ body, displayRadius, profile }) => (
        <PhotorealisticBody
          key={body.id}
          body={body}
          displayRadius={displayRadius}
          profile={profile}
          features={features}
        />
      ))}
    </>
  );
}
