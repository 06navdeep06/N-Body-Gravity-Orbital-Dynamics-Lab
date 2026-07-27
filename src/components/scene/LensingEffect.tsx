"use client";

/**
 * Screen-space gravitational lensing around black holes.
 *
 * A full ray-traced Schwarzschild lens is out of scope for a real-time
 * post-pass, so this deflects the screen UV radially away from each black
 * hole's projected position by an amount ∝ r_s / d — the weak-field
 * deflection angle's 1/d falloff. That reproduces what actually reads as
 * lensing on screen: background stars smeared into arcs and an Einstein-ring
 * brightening at the photon sphere.
 *
 * Honest limitation: because it warps the already-rendered frame it cannot
 * bend light around to reveal the far side of the disk the way ray-traced
 * renderings do — that needs per-ray geodesic integration.
 *
 * The single Effect instance is created here and handed to the composer via
 * <primitive>, so the object receiving per-frame uniform updates is exactly
 * the one being rendered (wrapEffect would construct its own).
 */

import { useFrame, useThree } from "@react-three/fiber";
import { BlendFunction, Effect } from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { findBlackHoles } from "./BlackHole";

const MAX_LENSES = 4;

/**
 * Caps on the effect's screen footprint.
 *
 * At the viewing distances these presets use (tens of r_s), the true Einstein
 * radius is a large fraction of the field of view and the weak-field
 * deflection formula is well outside its domain — applied literally it
 * smears the entire frame into swirls rather than reading as a lens. These
 * caps keep the distortion a localized ring artifact, which is the honest
 * visual compromise: correct 1/d falloff and correct ring placement,
 * deliberately understated amplitude.
 */
const MAX_DEFLECT = 0.025;
const MAX_THETA_E = 0.06;

const fragmentShader = /* glsl */ `
  #define MAX_DEFLECT ${MAX_DEFLECT}
  uniform vec3 uLenses[${MAX_LENSES}]; // xy = screen UV center, z = Einstein radius (UV)
  uniform int uCount;
  uniform float uAspect;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 warped = uv;
    float ring = 0.0;

    for (int i = 0; i < ${MAX_LENSES}; i++) {
      if (i >= uCount) break;
      vec3 lens = uLenses[i];
      // Correct for aspect so the deflection is circular on screen, not oval.
      vec2 delta = (uv - lens.xy) * vec2(uAspect, 1.0);
      float d = length(delta);
      if (d < 1e-4) continue;

      // lens.z is the Einstein radius in UV units. A point lens deflects by
      // theta_E^2 / d, which is strong at the ring and falls off fast — the
      // deflection has to stay local, or the whole frame smears instead of
      // reading as a lens.
      float thetaE = lens.z;
      float deflect = min((thetaE * thetaE) / d, MAX_DEFLECT);
      // Fade the deflection out well before it reaches the frame edges, so
      // the lens stays a local feature instead of dragging the whole image.
      deflect *= 1.0 - smoothstep(thetaE * 2.0, thetaE * 9.0, d);
      warped -= normalize(delta) * deflect * vec2(1.0 / uAspect, 1.0);

      // Einstein-ring brightening at theta_E itself. Note the 1.0 - smoothstep
      // form: GLSL leaves smoothstep undefined when edge0 > edge1, and passing
      // the edges reversed makes it return 1.0 everywhere, washing the whole
      // frame white.
      ring += (1.0 - smoothstep(0.0, thetaE * 0.55, abs(d - thetaE))) * 0.3;
    }

    vec4 color = texture2D(inputBuffer, clamp(warped, 0.0, 1.0));
    outputColor = vec4(color.rgb + vec3(0.9, 0.85, 0.7) * ring, color.a);
  }
`;

export class LensingEffectImpl extends Effect {
  constructor() {
    super("LensingEffect", fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        [
          "uLenses",
          new THREE.Uniform(Array.from({ length: MAX_LENSES }, () => new THREE.Vector3())),
        ],
        ["uCount", new THREE.Uniform(0)],
        ["uAspect", new THREE.Uniform(1)],
      ]),
    });
  }

  setLenses(lenses: THREE.Vector3[], count: number, aspect: number): void {
    const target = this.uniforms.get("uLenses")!.value as THREE.Vector3[];
    const n = Math.min(count, MAX_LENSES);
    for (let i = 0; i < n; i++) target[i]!.copy(lenses[i]!);
    this.uniforms.get("uCount")!.value = n;
    this.uniforms.get("uAspect")!.value = aspect;
  }
}

/**
 * Projects each black hole to screen space every frame and feeds the pass.
 * Must be rendered inside an <EffectComposer>.
 */
export function LensingEffect() {
  const size = useThree((s) => s.size);
  const effect = useMemo(() => new LensingEffectImpl(), []);
  useEffect(() => () => effect.dispose(), [effect]);

  const scratch = useMemo(
    () => ({
      projected: new THREE.Vector3(),
      worldPos: new THREE.Vector3(),
      lenses: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3()),
    }),
    []
  );

  useFrame(({ camera }) => {
    const { system, speedOfLight } = useSimulationStore.getState();
    const holes = findBlackHoles(system.bodies, system.G, speedOfLight);
    const { projected, worldPos, lenses } = scratch;

    let count = 0;
    for (const { body, rs } of holes) {
      if (count >= MAX_LENSES) break;
      worldPos.set(body.position.x, body.position.y, body.position.z);
      projected.copy(worldPos).project(camera);
      if (projected.z > 1) continue; // behind the camera

      const distance = camera.position.distanceTo(worldPos);
      if (distance <= 0) continue;

      // Einstein radius for a source far behind the lens: theta_E ~ sqrt(2 r_s / D),
      // converted from radians into a fraction of the vertical field of view
      // (which is what UV distance measures).
      const perspective = camera as THREE.PerspectiveCamera;
      const fovRad = ((perspective.isPerspectiveCamera ? perspective.fov : 50) * Math.PI) / 180;
      const thetaERad = Math.sqrt((2 * rs) / distance);
      const thetaE = Math.min(MAX_THETA_E, thetaERad / fovRad);
      if (thetaE < 0.004) continue;

      lenses[count]!.set((projected.x + 1) / 2, (projected.y + 1) / 2, thetaE);
      count++;
    }

    effect.setLenses(lenses, count, size.width / Math.max(1, size.height));
  });

  return <primitive object={effect} dispose={null} />;
}
