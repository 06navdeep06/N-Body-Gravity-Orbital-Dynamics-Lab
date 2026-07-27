"use client";

/**
 * Black hole rendering: event horizon, photon sphere, and a Doppler-beamed
 * accretion disk.
 *
 * A body renders as a black hole when it's explicitly tagged
 * (`isBlackHole`) or when it's fixed and its Schwarzschild radius
 * r_s = 2GM/c² is a meaningful fraction of its drawn radius. All radii scale
 * off r_s, so the geometry stays self-consistent at any mass:
 *   horizon r_s · photon sphere 1.5 r_s · disk 3 r_s → 10 r_s
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CelestialBody } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

/** r_s = 2GM/c², in simulation units. */
export function schwarzschildRadius(mass: number, G: number, c: number): number {
  if (c <= 0) return 0;
  return (2 * G * mass) / (c * c);
}

/**
 * Bodies that should render as black holes, with their computed r_s.
 *
 * Either explicitly tagged, or genuinely compact — meaning the body lies
 * inside its own Schwarzschild radius (r_s ≥ its radius), which is the
 * actual physical definition. The strict form matters: a looser threshold
 * turns ordinary stars into black holes as soon as the simulation's `c` is
 * lowered, which is a setting users change freely.
 */
export function findBlackHoles(
  bodies: CelestialBody[],
  G: number,
  c: number
): { body: CelestialBody; rs: number }[] {
  const out: { body: CelestialBody; rs: number }[] = [];
  for (const body of bodies) {
    const rs = schwarzschildRadius(body.mass, G, c);
    if (rs <= 0) continue;
    if (body.isBlackHole || rs >= body.radius) {
      out.push({ body, rs });
    }
  }
  return out;
}

const diskVertex = /* glsl */ `
  varying vec2 vLocal;
  varying vec2 vUv;
  void main() {
    vLocal = position.xy;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Accretion-disk shader. Two effects stacked:
 *  - Keplerian shear: inner gas orbits faster (v ∝ 1/√r), so the procedural
 *    turbulence is advected at a radius-dependent rate.
 *  - Relativistic Doppler beaming: the limb rotating toward the camera is
 *    blueshifted and brightened, the receding limb redshifted and dimmed.
 */
const diskFragment = /* glsl */ `
  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;
  uniform vec3 uApproach;   // in-plane direction rotating toward the camera
  uniform float uBeaming;   // strength of the Doppler asymmetry

  varying vec2 vLocal;

  // Cheap value-noise + fbm for hot turbulent gas.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float r = length(vLocal);
    if (r < uInner || r > uOuter) discard;

    float angle = atan(vLocal.y, vLocal.x);
    // Keplerian angular velocity ~ r^-1.5; advect the noise by it.
    // NB: "sample" is a reserved word in GLSL ES; never name a variable that.
    float omega = pow(max(r, 0.001), -1.5) * 22.0;
    vec2 noiseUv = vec2(angle * 2.2 + uTime * omega, r * 0.55);
    float gas = fbm(noiseUv * 3.0);

    // Radial brightness: hottest at the inner edge, fading outward.
    float t = clamp((r - uInner) / max(uOuter - uInner, 0.0001), 0.0, 1.0);
    float radial = pow(1.0 - t, 1.7);

    // Doppler factor: +1 on the approaching limb, -1 on the receding one.
    vec2 dir = normalize(vLocal);
    // Orbital velocity is perpendicular to the radius (counter-clockwise).
    vec2 vel = vec2(-dir.y, dir.x);
    float toward = dot(vel, normalize(uApproach.xz + vec2(1e-6)));
    float doppler = 1.0 + uBeaming * toward;

    // Blueshift the approaching side, redshift the receding side.
    vec3 hot  = vec3(1.0, 0.95, 0.82);
    vec3 blue = vec3(0.72, 0.86, 1.0);
    vec3 red  = vec3(1.0, 0.42, 0.14);
    vec3 tint = toward > 0.0 ? mix(hot, blue, toward * 0.85) : mix(hot, red, -toward * 0.9);

    // Beaming exponent kept moderate and brightness clamped: the disk is
    // additively blended, so an unbounded value blows out to flat white as
    // soon as two disks (a binary) overlap on screen.
    float brightness = clamp(radial * (0.30 + gas * 0.55) * pow(doppler, 2.2), 0.0, 1.0);
    float alpha = brightness * (0.3 + 0.7 * radial);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(tint * brightness, alpha);
  }
`;

function makeDiskMaterial(rs: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: diskVertex,
    fragmentShader: diskFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uInner: { value: rs * 3 },
      uOuter: { value: rs * 10 },
      uApproach: { value: new THREE.Vector3(1, 0, 0) },
      uBeaming: { value: 0.55 },
    },
  });
}

function SingleBlackHole({ body, rs }: { body: CelestialBody; rs: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const diskRef = useRef<THREE.Mesh>(null);
  // The material is created and attached inside an effect, and only ever
  // touched from useFrame — both run after React's commit, so mutating its
  // uniforms per frame stays outside render.
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    const material = makeDiskMaterial(rs);
    materialRef.current = material;
    if (diskRef.current) diskRef.current.material = material;
    return () => {
      materialRef.current = null;
      material.dispose();
    };
  }, [rs]);

  useFrame(({ camera, clock }) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material) return;
    const live = useSimulationStore.getState().system.bodies.find((b) => b.id === body.id);
    if (live) group.position.set(live.position.x, live.position.y, live.position.z);

    material.uniforms.uTime!.value = clock.elapsedTime;
    // Which in-plane direction currently rotates toward the camera, so the
    // beamed limb tracks the viewpoint instead of being baked in.
    const toCamera = camera.position.clone().sub(group.position).setY(0);
    if (toCamera.lengthSq() > 1e-8) {
      (material.uniforms.uApproach!.value as THREE.Vector3).copy(toCamera.normalize());
    }
  });

  return (
    <group ref={groupRef}>
      {/* Event horizon: unlit, absolutely black. */}
      <mesh>
        <sphereGeometry args={[rs, 32, 24]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Photon sphere at 1.5 r_s. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[rs * 1.5, rs * 0.045, 10, 96]} />
        <meshBasicMaterial color="#fff3d0" transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Accretion disk, 3 r_s → 10 r_s (material attached in the effect). */}
      <mesh ref={diskRef} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[rs * 22, rs * 22, 1, 1]} />
      </mesh>
    </group>
  );
}

export function BlackHole() {
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);
  const c = useSimulationStore((s) => s.speedOfLight);

  const holes = useMemo(() => findBlackHoles(bodies, G, c), [bodies, G, c]);

  return (
    <>
      {holes.map(({ body, rs }) => (
        <SingleBlackHole key={body.id} body={body} rs={rs} />
      ))}
    </>
  );
}
