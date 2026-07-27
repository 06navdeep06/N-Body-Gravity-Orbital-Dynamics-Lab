"use client";

/**
 * The post-processing stack.
 *
 * One EffectComposer for the whole app. That matters: each composer forces
 * its own render-target round trip, and the pre-existing gravitational
 * lensing pass used to mount a second one — so lensing is folded in here
 * rather than left to run beside this.
 *
 * Pass order is not arbitrary:
 *   1. Lensing      warps the raw frame, so it must see geometry before any
 *                   glow is smeared across it.
 *   2. God rays     radially blur the star's occlusion mask.
 *   3. Bloom        blooms the result, including the rays.
 *   4. Depth of field
 *   5. Tone mapping maps the accumulated HDR range back to display range.
 *
 * The composer disables the renderer's own tone mapping while mounted, which
 * is why the ToneMapping effect is mandatory rather than decorative — without
 * it a bloomed star clips to flat white.
 *
 * ## Why there is no <LensFlare> pass
 *
 * @react-three/postprocessing's `<LensFlare>` cannot be used on React 19.
 * It builds its effect through `wrapEffect`, which returns a *plain* function
 * component and memoises the effect's constructor args on
 * `JSON.stringify(props)`. React 19 delivers `ref` as an ordinary prop to
 * plain function components, and `<LensFlare>` passes itself a ref — so from
 * the second render onward that stringify walks the mounted effect, hits the
 * `__r3f` instance r3f attaches to it, and throws
 * "Converting circular structure to JSON", taking the whole canvas down.
 *
 * The screen-space flare therefore comes from `<StarEffects />`, which uses
 * three's own `Lensflare` object with procedurally generated sprites. Same
 * visual, no post-pass, and it was already in the scene.
 */

import { useFrame } from "@react-three/fiber";
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  GodRays,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, KernelSize, ToneMappingMode, type DepthOfFieldEffect } from "postprocessing";
import {
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type RefObject,
} from "react";
import * as THREE from "three";
import { findBlackHoles } from "@/components/scene/BlackHole";
import { LensingEffect } from "@/components/scene/LensingEffect";
import { dominantStar } from "@/lib/render/lighting";
import { useQualityPreset } from "@/lib/render/quality-preset";
import {
  getStarMesh,
  starRegistryVersion,
  subscribeToStarMeshes,
} from "@/lib/render/star-registry";
import { useSimulationStore } from "@/lib/stores/simulation-store";

/**
 * Bloom threshold.
 *
 * Deliberately above 1.0: stars and accretion disks are rendered
 * `toneMapped={false}` / additively and land well over unity, while lit
 * planetary surfaces top out below it. That gap is what makes this a
 * *selective* bloom without needing a selection buffer — high-energy emitters
 * glow, ordinary terrain does not wash out.
 */
const BLOOM_THRESHOLD = 1.05;

const GODRAY_SAMPLES = 60;

/**
 * Frame-loop scratch. Module-scoped rather than per-component, both to avoid
 * a per-frame allocation and because it is written from `useFrame` — a value
 * produced by a hook must not be mutated after render. Only one pipeline is
 * ever mounted, so there is nothing to collide with.
 */
const focusPoint = new THREE.Vector3();

/** Tracks the registered star meshes without re-rendering every frame. */
function useStarMeshVersion(): number {
  return useSyncExternalStore(subscribeToStarMeshes, starRegistryVersion, () => 0);
}

/**
 * Depth of field that follows the selected body.
 *
 * `target` is mutated on the effect instance rather than passed as a prop:
 * the focus point moves every frame, and re-rendering the composer's children
 * that often would rebuild its pass list.
 */
function FocusTracker({ effectRef }: { effectRef: RefObject<DepthOfFieldEffect | null> }) {
  useFrame(({ camera }) => {
    const effect = effectRef.current;
    if (!effect) return;
    const { system, selectedBodyId } = useSimulationStore.getState();
    const selected = selectedBodyId
      ? system.bodies.find((b) => b.id === selectedBodyId)
      : undefined;

    if (selected) {
      focusPoint.set(selected.position.x, selected.position.y, selected.position.z);
    } else {
      // Nothing selected: focus on the system barycentre, which is where the
      // interesting geometry is in every preset.
      focusPoint.set(0, 0, 0);
      let totalMass = 0;
      for (const body of system.bodies) {
        focusPoint.x += body.position.x * body.mass;
        focusPoint.y += body.position.y * body.mass;
        focusPoint.z += body.position.z * body.mass;
        totalMass += body.mass;
      }
      if (totalMass > 0) focusPoint.multiplyScalar(1 / totalMass);
      // No bodies at all — park the focal plane in front of the camera so the
      // pass has a finite distance to work with.
      else camera.getWorldDirection(focusPoint).multiplyScalar(50).add(camera.position);
    }

    effect.target = focusPoint;
  });

  return null;
}

export function CinematicPipeline() {
  const features = useQualityPreset();
  const showLensing = useSimulationStore((s) => s.showLensing);

  /*
   * Every selector below returns a primitive.
   *
   * That is load-bearing, not stylistic. The physics worker replaces
   * `system.bodies` on every step, so selecting the array itself would
   * re-render this component sixty times a second — and both `<GodRays>` and
   * `<LensFlare>` memoise their effect instance on their whole props object,
   * so a re-render per frame means constructing (and leaking) a new
   * GodRaysEffect per frame. Primitive selectors compare equal under
   * zustand's default Object.is check and the component stays still.
   */
  const starId = useSimulationStore((s) => dominantStar(s.system.bodies)?.id ?? null);
  const hasBlackHole = useSimulationStore(
    (s) => findBlackHoles(s.system.bodies, s.system.G, s.speedOfLight).length > 0
  );

  const dofRef = useRef<DepthOfFieldEffect>(null);
  const starVersion = useStarMeshVersion();

  // God rays need the star's actual mesh to build its occlusion mask, which
  // only exists once <PhotorealisticBody /> has mounted it. Recomputed when
  // the registry changes, hence the version dependency.
  const sunMesh = useMemo(
    () => (starId ? getStarMesh(starId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starVersion is the registry's change signal
    [starId, starVersion]
  );

  const lensing = showLensing && hasBlackHole;

  if (!features.postProcessing) return null;

  // EffectComposer types its children as elements, not as ReactNode, so the
  // usual `{cond && <Pass/>}` inline form does not type-check here — the
  // enabled passes are collected into an array instead, which also keeps the
  // documented ordering above readable as a single list.
  const passes: ReactElement[] = [];

  if (lensing) passes.push(<LensingEffect key="lensing" />);

  if (features.godRays && sunMesh) {
    passes.push(
      <GodRays
        key="godrays"
        sun={sunMesh}
        samples={GODRAY_SAMPLES}
        density={0.94}
        decay={0.92}
        weight={0.42}
        exposure={0.5}
        clampMax={1}
        kernelSize={KernelSize.SMALL}
        blur
      />
    );
  }

  if (features.bloom) {
    passes.push(
      <Bloom
        key="bloom"
        luminanceThreshold={BLOOM_THRESHOLD}
        // A soft knee rather than a hard cut: a hard threshold makes the glow
        // pop in and out as a star's brightness crosses it.
        luminanceSmoothing={0.35}
        intensity={features.preset === "cinematic" ? 1.15 : 0.8}
        mipmapBlur
        radius={0.72}
      />
    );
  }

  if (features.depthOfField) {
    passes.push(
      <DepthOfField
        key="dof"
        ref={dofRef}
        worldFocusRange={90}
        // Understated on purpose. Strong bokeh reads as a macro lens and makes
        // a planetary system look like a tabletop model.
        bokehScale={2.4}
        focalLength={0.02}
      />
    );
  }

  if (features.preset === "cinematic") {
    passes.push(
      <Vignette key="vignette" offset={0.32} darkness={0.55} blendFunction={BlendFunction.NORMAL} />
    );
  }

  // Mandatory, not decorative: the composer disables the renderer's own tone
  // mapping while mounted, so without this a bloomed star clips to flat white.
  passes.push(<ToneMapping key="tonemapping" mode={ToneMappingMode.ACES_FILMIC} />);

  return (
    <>
      <FocusTracker effectRef={dofRef} />
      <EffectComposer
        // MSAA is a real cost and only buys visibly cleaner ring and debris
        // silhouettes, which is a cinematic-tier concern.
        multisampling={features.preset === "cinematic" ? 4 : 0}
        enableNormalPass={false}
      >
        {passes}
      </EffectComposer>
    </>
  );
}
