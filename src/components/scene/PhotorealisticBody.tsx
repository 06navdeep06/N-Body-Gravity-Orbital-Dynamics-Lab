"use client";

/**
 * A single celestial body drawn as stacked shells.
 *
 *   r × 1.000   surface   PBR sphere: albedo + normal (topography) + roughness
 *   r × 1.015   clouds    alpha-mapped shell, counter-rotating, casts shadows
 *   r × 1.035   air       Rayleigh/Mie scattering halo, additive
 *   1.2r-2.4r   rings     alpha-mapped annulus, casts banded shadows
 *
 * Only bodies the role assigner marks as `featured` get here — a dozen at
 * most. Everything else stays on the single instanced draw call in
 * `<Bodies />`, which is what keeps 100+ body presets at frame rate.
 *
 * Positions are read from the simulation store inside `useFrame` rather than
 * taken as props. The physics loop mutates that store many times per second;
 * subscribing to it in React would re-render this subtree every frame.
 */

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  AtmosphereMaterial,
  ATMOSPHERE_RADIUS_SCALE,
  CLOUD_RADIUS_SCALE,
} from "@/materials/AtmosphereShader";
import { colorBlindColor } from "@/lib/a11y/preferences";
import type { CelestialBody } from "@/lib/physics/types";
import { dominantStar, lightDirectionAt } from "@/lib/render/lighting";
import type { RenderFeatures } from "@/lib/render/quality-preset";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useBodyTextures, type BodyRenderProfile } from "@/lib/textures/texture-library";
import { registerStarMesh, unregisterStarMesh } from "@/lib/render/star-registry";

/** Radians/second the surface spins. Cosmetic — the physics has no spin state. */
const SURFACE_SPIN = 0.05;

export interface PhotorealisticBodyProps {
  body: CelestialBody;
  /** Radius in world units, already through the store's display scaling. */
  displayRadius: number;
  profile: BodyRenderProfile;
  features: RenderFeatures;
}

/**
 * RingGeometry with radial UVs.
 *
 * three's own RingGeometry box-projects its UVs onto the annulus bounding
 * square, which smears a radial ring profile into a corner-to-corner gradient.
 * Rewriting `u` to the normalised radius makes a 1-D ring texture map the way
 * a ring texture is meant to: inner edge at u=0, outer edge at u=1.
 */
function makeRadialRingGeometry(inner: number, outer: number, segments = 128): THREE.RingGeometry {
  const geometry = new THREE.RingGeometry(inner, outer, segments, 1);
  const position = geometry.attributes.position!;
  const uv = geometry.attributes.uv!;
  const span = Math.max(outer - inner, 1e-6);

  for (let i = 0; i < position.count; i++) {
    const radius = Math.hypot(position.getX(i), position.getY(i));
    const angle = Math.atan2(position.getY(i), position.getX(i));
    uv.setXY(i, (radius - inner) / span, (angle / (Math.PI * 2)) + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Depth material for shadow-casting transparent shells.
 *
 * The shadow pass swaps in a depth-only material, and the auto-generated one
 * only alpha-tests when the *source* material sets `alphaTest` — which a
 * smoothly blended cloud or ring layer must not. Left alone, an alpha-mapped
 * ring therefore casts the shadow of a solid disc and a wispy cloud shell
 * casts the shadow of a solid sphere. Supplying a depth material that samples
 * the same map and alpha-tests it is what turns those into the banded ring
 * shadow and the dappled cloud shadow you actually want.
 */
function makeAlphaDepthMaterial(
  map: THREE.Texture,
  alphaTest: number,
  side: THREE.Side
): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map,
    alphaTest,
    side,
  });
}

export function PhotorealisticBody({
  body,
  displayRadius,
  profile,
  features,
}: PhotorealisticBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const surfaceRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const atmosphereRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const colorBlindMode = useA11yStore((s) => s.colorBlindMode);
  const textures = useBodyTextures(body, profile, features.pbrMaterials);

  const segments = features.featuredSegments;
  const isStar = profile.kind === "star";

  // Colour-blind mode remaps body colours to Okabe-Ito; the PBR path has to
  // honour it too or the two renderers disagree about what colour a body is.
  const tint = colorBlindMode ? colorBlindColor(body.id) : body.color;

  /**
   * Star surfaces are pushed above 1.0 deliberately.
   *
   * The bloom pass isolates emitters with a luminance threshold just over
   * unity (see CinematicPipeline). An unlit material clamped at the body's
   * own colour never crosses it, so without this boost the one object in the
   * scene that most needs to glow is the one that does not.
   */
  const starColor = useMemo(() => new THREE.Color(tint).multiplyScalar(2.2), [tint]);

  const geometries = useMemo(() => {
    const surface = new THREE.SphereGeometry(1, segments, Math.max(12, Math.round(segments / 2)));
    const ring = profile.ring
      ? makeRadialRingGeometry(profile.ring.innerScale, profile.ring.outerScale)
      : null;
    return { surface, ring };
  }, [segments, profile.ring]);

  useEffect(() => {
    const { surface, ring } = geometries;
    return () => {
      surface.dispose();
      ring?.dispose();
    };
  }, [geometries]);

  const atmosphereMaterial = useMemo(() => {
    if (!features.atmosphere || !profile.atmosphere) return null;
    return new AtmosphereMaterial({
      rayleighColor: profile.atmosphere.rayleigh,
      mieColor: profile.atmosphere.mie,
      thickness: profile.atmosphere.thickness,
      fresnelPower: profile.atmosphere.power,
    });
  }, [features.atmosphere, profile.atmosphere]);

  useEffect(() => () => atmosphereMaterial?.dispose(), [atmosphereMaterial]);

  const ringDepthMaterial = useMemo(
    () =>
      features.dynamicShadows && textures.ringMap
        ? makeAlphaDepthMaterial(textures.ringMap, 0.35, THREE.DoubleSide)
        : null,
    [features.dynamicShadows, textures.ringMap]
  );

  const cloudDepthMaterial = useMemo(
    () =>
      features.dynamicShadows && textures.cloudMap
        ? makeAlphaDepthMaterial(textures.cloudMap, 0.5, THREE.FrontSide)
        : null,
    [features.dynamicShadows, textures.cloudMap]
  );

  useEffect(() => () => ringDepthMaterial?.dispose(), [ringDepthMaterial]);
  useEffect(() => () => cloudDepthMaterial?.dispose(), [cloudDepthMaterial]);

  // The god-ray pass needs the actual mesh of the light source to build its
  // occlusion mask, so a star publishes its surface mesh for the pipeline.
  useEffect(() => {
    if (!isStar) return;
    const mesh = surfaceRef.current;
    if (!mesh) return;
    registerStarMesh(body.id, mesh);
    return () => unregisterStarMesh(body.id);
  }, [isStar, body.id]);

  const scratch = useMemo(
    () => ({ position: new THREE.Vector3(), lightDirection: new THREE.Vector3() }),
    []
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const { system } = useSimulationStore.getState();
    const live = system.bodies.find((b) => b.id === body.id);
    if (!live) {
      // Merged away by a collision this frame; hide until React unmounts us.
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(live.position.x, live.position.y, live.position.z);
    scratch.position.copy(group.position);

    // Axial spin. Purely visual: the engine tracks no rotational state, and
    // inventing one here would be a physics change, not a rendering one.
    if (surfaceRef.current) surfaceRef.current.rotation.y += SURFACE_SPIN * delta;
    // Clouds run at a different rate, so the shell visibly shears over the
    // surface instead of looking painted onto it.
    if (cloudRef.current) {
      cloudRef.current.rotation.y += (SURFACE_SPIN + profile.cloudDrift) * delta;
    }

    if (atmosphereMaterial) {
      const star = dominantStar(system.bodies);
      lightDirectionAt(scratch.position, star, scratch.lightDirection);
      atmosphereMaterial.setLightDirection(scratch.lightDirection);
    }
  });

  const castShadow = features.dynamicShadows;
  const receiveShadow = features.dynamicShadows;

  // The instanced renderer zeroes this body's slot, so its click target is
  // gone — selection has to be handled here or featured bodies become
  // unselectable, which is a functional regression, not a cosmetic one.
  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      useSimulationStore.getState().selectBody(body.id);
    },
    [body.id]
  );

  return (
    <group ref={groupRef}>
      {/* --- Surface ---------------------------------------------------- */}
      <mesh
        ref={surfaceRef}
        geometry={geometries.surface}
        scale={displayRadius}
        castShadow={castShadow && !isStar}
        receiveShadow={receiveShadow && !isStar}
        onClick={handleClick}
      >
        {isStar ? (
          // A star is its own light source; shading it would darken the limb
          // of the very object lighting the scene.
          <meshBasicMaterial
            map={textures.map ?? undefined}
            color={starColor}
            toneMapped={false}
          />
        ) : (
          <meshPhysicalMaterial
            map={textures.map ?? undefined}
            normalMap={textures.normalMap ?? undefined}
            roughnessMap={textures.roughnessMap ?? undefined}
            // The albedo is already tinted with the body's own colour, so it
            // normally needs no further tint. Colour-blind mode multiplies the
            // Okabe-Ito hue over it anyway: keeping bodies mutually
            // distinguishable is the whole point of that mode, and it is worth
            // more than the texture fidelity the multiply costs.
            color={colorBlindMode || !textures.map ? tint : "#ffffff"}
            roughness={textures.roughnessMap ? 1 : 0.62}
            metalness={profile.metalness}
            // Sharpens the ocean glint the roughness map sets up. Costs a
            // second specular lobe, which is why it is cinematic-only.
            clearcoat={features.atmosphere && profile.kind === "terrestrial" ? 0.35 : 0}
            clearcoatRoughness={0.25}
            normalScale={new THREE.Vector2(0.85, 0.85)}
          />
        )}
      </mesh>

      {/* --- Cloud shell ------------------------------------------------ */}
      {features.cloudLayers && textures.cloudMap && (
        <mesh
          ref={cloudRef}
          geometry={geometries.surface}
          scale={displayRadius * CLOUD_RADIUS_SCALE}
          castShadow={castShadow}
          customDepthMaterial={cloudDepthMaterial ?? undefined}
          renderOrder={1}
        >
          {/*
            Cover comes from the map's own alpha channel, not from `alphaMap`:
            three's alphaMap samples the *green* channel, which on a white
            cloud plate is 1.0 everywhere and would render the shell opaque.
          */}
          <meshStandardMaterial
            map={textures.cloudMap}
            transparent
            // Without this the shell writes depth over the surface and the
            // atmosphere behind it gets depth-rejected in the gaps.
            depthWrite={false}
            opacity={0.92}
            roughness={0.95}
            metalness={0}
            side={THREE.FrontSide}
          />
        </mesh>
      )}

      {/* --- Atmosphere -------------------------------------------------- */}
      {atmosphereMaterial && (
        <mesh
          ref={atmosphereRef}
          geometry={geometries.surface}
          scale={displayRadius * ATMOSPHERE_RADIUS_SCALE}
          material={atmosphereMaterial}
          // Additive shells must draw after everything they sit on top of.
          renderOrder={2}
        />
      )}

      {/* --- Rings ------------------------------------------------------- */}
      {features.rings && geometries.ring && textures.ringMap && profile.ring && (
        <mesh
          ref={ringRef}
          geometry={geometries.ring}
          scale={displayRadius}
          rotation={[-Math.PI / 2 + profile.ring.tilt, 0, 0]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          customDepthMaterial={ringDepthMaterial ?? undefined}
        >
          <meshStandardMaterial
            map={textures.ringMap}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            roughness={0.85}
            metalness={0}
          />
        </mesh>
      )}
    </group>
  );
}
