"use client";

/**
 * Raymarched accretion disk for black holes and other high-mass energetic
 * bodies.
 *
 * The disk is drawn on a single quad, but shaded by marching the view ray
 * through a slab of finite thickness in the disk plane, accumulating
 * emission from a 3D simplex-noise density field. That is what gives it
 * parallax: the far edge shows through the near edge, and the plasma has
 * visible vertical structure rather than looking like a printed decal.
 *
 * Physics represented, all as approximations on top of the Newtonian engine
 * that actually moves the bodies — nothing here feeds back into it:
 *
 *  - **Keplerian shear.** Angular velocity omega ∝ r^-3/2, so the noise field
 *    is advected faster near the horizon. This is what makes the disk look
 *    like it is orbiting rather than spinning as a rigid plate.
 *  - **Blackbody temperature profile.** A thin accretion disk runs
 *    T ∝ r^-3/4; the shader maps that onto a Planckian colour ramp, so the
 *    inner annulus glows blue-violet at 10,000K+ and the outer edge falls to
 *    deep orange around 3,000K.
 *  - **Relativistic Doppler beaming.** The limb rotating toward the camera is
 *    blueshifted and brightened, the receding limb redshifted and dimmed.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Marching steps through the slab. Enough for depth, cheap enough to stack. */
const RAYMARCH_STEPS = 12;

/** Frame-loop scratch, module-scoped so no allocation happens per frame. */
const cameraLocal = new THREE.Vector3();

const vertexShader = /* glsl */ `
  varying vec3 vLocalPosition;

  void main() {
    vLocalPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Ashima/Stefan Gustavson's simplex noise (public domain, the standard
 * WebGL port). Reproduced rather than imported so the shader stays a single
 * self-contained unit with no build-step dependency on a GLSL bundler.
 */
const simplex3d = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const fragmentShader = /* glsl */ `
  #define STEPS ${RAYMARCH_STEPS}

  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;
  uniform float uThickness;
  uniform float uInnerTemp;    // Kelvin at the inner edge
  uniform float uOuterTemp;    // Kelvin at the outer edge
  uniform float uBeaming;      // Doppler asymmetry strength
  uniform float uIntensity;
  uniform vec3 uApproach;      // in-plane direction currently rotating toward the camera
  // Camera position in the disk's own frame. Computed on the CPU because
  // GLSL ES 1.00 — which is what three compiles ShaderMaterial to unless the
  // material opts into GLSL3 — has no inverse().
  uniform vec3 uCameraLocal;

  varying vec3 vLocalPosition;

  ${simplex3d}

  /**
   * Planckian locus approximation (Tanner Helland's piecewise fit), valid
   * roughly 1000K-40000K. Cheap enough for a per-step call and it puts the
   * blue-violet/orange endpoints where a real blackbody ramp puts them,
   * which an ad-hoc gradient does not.
   */
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    float r, g, b;

    if (t <= 66.0) {
      r = 1.0;
      g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0);
      b = t <= 19.0 ? 0.0 : clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
    } else {
      r = clamp((329.698727446 * pow(t - 60.0, -0.1332047592)) / 255.0, 0.0, 1.0);
      g = clamp((288.1221695283 * pow(t - 60.0, -0.0755148492)) / 255.0, 0.0, 1.0);
      b = 1.0;
    }
    return vec3(r, g, b);
  }

  /** Plasma density at a point in disk-local space. */
  float density(vec3 p) {
    float r = length(p.xy);
    if (r < uInner || r > uOuter) return 0.0;

    float angle = atan(p.y, p.x);

    // Keplerian shear: omega ~ r^-3/2. Advecting the noise by this is what
    // separates an orbiting disk from a rigidly spinning plate.
    float omega = pow(max(r / uInner, 1.0), -1.5) * 2.2;
    float phase = angle + uTime * omega;

    // Sample in a sheared frame so gas streams wind into spiral filaments.
    vec3 q = vec3(cos(phase) * r, sin(phase) * r, p.z * 3.0) * (2.6 / uOuter);
    float gas = snoise(q * 3.0) * 0.5
              + snoise(q * 7.0) * 0.28
              + snoise(q * 15.0) * 0.14;
    gas = gas * 0.5 + 0.5;

    // Radial envelope: matter piles up toward the inner edge.
    float t = clamp((r - uInner) / max(uOuter - uInner, 1e-4), 0.0, 1.0);
    float radial = pow(1.0 - t, 1.6);

    // Vertical envelope: a thin disk, flaring slightly with radius.
    float scaleHeight = uThickness * (0.35 + 0.65 * t);
    float vertical = exp(-(p.z * p.z) / max(scaleHeight * scaleHeight, 1e-6));

    return clamp(gas * radial * vertical, 0.0, 1.0);
  }

  void main() {
    // View ray in disk-local space.
    vec3 origin = uCameraLocal;
    vec3 direction = normalize(vLocalPosition - origin);

    // Clip the ray to the slab |z| <= thickness*2. A ray nearly parallel to
    // the plane would otherwise march for an unbounded distance through it.
    float halfSlab = uThickness * 2.0;
    float denom = direction.z;
    float tEnter, tExit;
    if (abs(denom) < 1e-4) {
      // Edge-on: the ray stays inside the slab, so march a fixed span
      // centred on the quad instead of solving for entry/exit.
      if (abs(origin.z) > halfSlab) discard;
      tEnter = 0.0;
      tExit = length(vLocalPosition - origin) * 2.0;
    } else {
      float t0 = (-halfSlab - origin.z) / denom;
      float t1 = (halfSlab - origin.z) / denom;
      tEnter = max(min(t0, t1), 0.0);
      tExit = max(t0, t1);
    }
    if (tExit <= tEnter) discard;

    // Cap the marched span. At grazing angles the slab intersection is
    // effectively unbounded, and a step longer than the disk itself makes the
    // first sample saturate — the whole annulus flashes to a flat bright band
    // as the camera approaches the disk plane. Three outer radii is more than
    // enough to cross any part of the disk that is actually visible.
    tExit = min(tExit, tEnter + uOuter * 3.0);

    // Step length measured in slab thicknesses rather than world units, so
    // the disk's brightness does not depend on the simulation's unit system
    // — r_s spans many orders of magnitude across the black-hole presets.
    float stepSize = (tExit - tEnter) / float(STEPS);
    float ds = stepSize / max(uThickness, 1e-6);

    // Doppler geometry, evaluated once at the quad hit rather than per step:
    // it varies slowly across the disk and this halves the shader's cost.
    vec2 radial2 = vLocalPosition.xy;
    float radius = max(length(radial2), 1e-4);
    vec2 unit = radial2 / radius;
    // Orbital velocity is perpendicular to the radius (counter-clockwise).
    vec2 velocity = vec2(-unit.y, unit.x);
    float toward = dot(velocity, normalize(uApproach.xy + vec2(1e-6)));
    float doppler = 1.0 + uBeaming * toward;

    vec3 accumulated = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < STEPS; i++) {
      vec3 p = origin + direction * (tEnter + (float(i) + 0.5) * stepSize);
      float d = density(p);
      if (d <= 0.001) continue;

      // Shakura-Sunyaev thin disk: T ~ r^-3/4, anchored at the inner edge and
      // floored at the outer temperature so the ramp spans exactly the
      // configured blue-violet to deep-orange range.
      float rr = max(length(p.xy), uInner);
      float kelvin = clamp(uInnerTemp * pow(rr / uInner, -0.75), uOuterTemp, uInnerTemp);

      // Beaming is a blueshift as well as a brightening.
      vec3 emission = blackbody(kelvin * max(doppler, 0.05));

      accumulated += emission * d * ds * transmittance * pow(max(doppler, 0.0), 2.2);
      transmittance *= exp(-d * ds * 1.5);
      if (transmittance < 0.01) break;
    }

    float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
    if (alpha < 0.01) discard;

    // Clamped: the disk blends additively, so an unbounded value flattens to
    // white the moment two disks (a binary) overlap on screen.
    vec3 color = clamp(accumulated * uIntensity * 0.9, 0.0, 1.6);
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface AccretionDiskProps {
  /** Inner edge in world units — the ISCO, conventionally 3 r_s. */
  innerRadius: number;
  /** Outer edge in world units. */
  outerRadius: number;
  /** Half-height of the plasma slab. Defaults to 6% of the inner radius. */
  thickness?: number;
  /** Temperature at the inner edge, Kelvin. */
  innerTemperature?: number;
  /** Temperature at the outer edge, Kelvin. */
  outerTemperature?: number;
  /** Doppler beaming strength in [0,1]. */
  beaming?: number;
  intensity?: number;
}

export function AccretionDisk({
  innerRadius,
  outerRadius,
  thickness,
  innerTemperature = 12000,
  outerTemperature = 3000,
  beaming = 0.55,
  intensity = 1,
}: AccretionDiskProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Built and attached inside an effect, and only ever touched from useFrame:
  // both run after React's commit, so mutating its uniforms per frame stays
  // outside render. Same arrangement the flat disk in BlackHole.tsx uses.
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: innerRadius },
        uOuter: { value: outerRadius },
        uThickness: { value: thickness ?? innerRadius * 0.06 },
        uInnerTemp: { value: innerTemperature },
        uOuterTemp: { value: outerTemperature },
        uBeaming: { value: beaming },
        uIntensity: { value: intensity },
        uApproach: { value: new THREE.Vector3(1, 0, 0) },
        uCameraLocal: { value: new THREE.Vector3(0, 0, 1) },
      },
    });
    materialRef.current = material;
    if (meshRef.current) meshRef.current.material = material;
    return () => {
      materialRef.current = null;
      material.dispose();
    };
  }, [innerRadius, outerRadius, thickness, innerTemperature, outerTemperature, beaming, intensity]);

  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;

    material.uniforms.uTime!.value = clock.elapsedTime;

    // The camera in the disk's own frame drives both the raymarch origin and
    // the beaming direction, so the bright limb tracks the viewpoint instead
    // of being baked into the geometry.
    mesh.updateWorldMatrix(true, false);
    cameraLocal.copy(camera.position);
    mesh.worldToLocal(cameraLocal);
    (material.uniforms.uCameraLocal!.value as THREE.Vector3).copy(cameraLocal);

    if (cameraLocal.x * cameraLocal.x + cameraLocal.y * cameraLocal.y > 1e-12) {
      (material.uniforms.uApproach!.value as THREE.Vector3)
        .set(cameraLocal.x, cameraLocal.y, 0)
        .normalize();
    }
  });

  // The quad is oversized relative to the outer radius so the slab's silhouette
  // is never clipped by its own carrier geometry at grazing angles.
  const quadSize = outerRadius * 2.3;

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[quadSize, quadSize, 1, 1]} />
    </mesh>
  );
}
