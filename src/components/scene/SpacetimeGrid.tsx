"use client";

/**
 * "Rubber sheet" spacetime visualization: a plane on XZ whose vertices are
 * displaced downward by the summed gravitational potential of every body,
 * computed entirely in the vertex shader (body positions/masses stream in
 * as uniform arrays each frame — zero geometry re-uploads).
 *
 * Two meshes share the same displacement shader: a semi-transparent fill
 * whose color maps well depth (blue → purple → red), and a wireframe
 * overlay for the classic grid look. The ShaderMaterials are constructed
 * imperatively (attached via <primitive>) so the uniform objects we mutate
 * in useFrame are guaranteed to be the ones the GPU reads — R3F's
 * `uniforms` prop does not preserve object identity reliably.
 *
 * Performance: geometry segment count halves automatically (down to 32)
 * whenever FPS sags below 45 while the grid is visible.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MAX_BODIES = 64;
const GRID_SIZE = 200;
const INITIAL_SEGMENTS = 128;
const MIN_SEGMENTS = 32;
const LOW_FPS_THRESHOLD = 45;
const LOW_FPS_SUSTAIN_FRAMES = 90; // ~1.5s of sustained low FPS before degrading

const vertexShader = /* glsl */ `
  uniform vec3 uBodyPos[${MAX_BODIES}];
  uniform float uBodyMass[${MAX_BODIES}];
  uniform int uCount;
  uniform float uK;
  uniform float uEps2;
  uniform float uMaxDepth;

  varying float vDepth;

  void main() {
    float displacement = 0.0;
    for (int i = 0; i < ${MAX_BODIES}; i++) {
      if (i >= uCount) break;
      // The group is rotated -pi/2 about X, so local (x, y) lands at world
      // (x, -y) on the XZ plane: world z of this vertex is -position.y.
      float dx = position.x - uBodyPos[i].x;
      float dz = -position.y - uBodyPos[i].z;
      displacement += uBodyMass[i] / sqrt(dx * dx + dz * dz + uEps2);
    }
    float y = -uK * displacement;
    // sqrt spreads the color ramp so mid-depth regions read as purple
    // instead of everything outside the deepest core staying blue.
    vDepth = uMaxDepth > 0.0 ? clamp(sqrt(-y / uMaxDepth), 0.0, 1.0) : 0.0;

    vec3 displaced = vec3(position.x, position.y, y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying float vDepth;

  void main() {
    // Shallow: deep blue -> mid: purple -> deep well: red.
    vec3 shallow = vec3(0.15, 0.25, 0.85);
    vec3 mid     = vec3(0.55, 0.20, 0.85);
    vec3 deep    = vec3(0.95, 0.25, 0.25);
    vec3 color = vDepth < 0.5
      ? mix(shallow, mid, vDepth * 2.0)
      : mix(mid, deep, (vDepth - 0.5) * 2.0);
    gl_FragColor = vec4(color, uOpacity);
  }
`;

function makeMaterial(opacity: number, wireframe: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    wireframe,
    side: THREE.DoubleSide,
    uniforms: {
      uBodyPos: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector3()) },
      uBodyMass: { value: new Float32Array(MAX_BODIES) },
      uCount: { value: 0 },
      uK: { value: 1 },
      uEps2: { value: 16 },
      uMaxDepth: { value: 1 },
      uOpacity: { value: opacity },
    },
  });
}

export function SpacetimeGrid() {
  const showSpacetimeGrid = useSimulationStore((s) => s.showSpacetimeGrid);
  const [segments, setSegments] = useState(INITIAL_SEGMENTS);
  const lowFpsFramesRef = useRef(0);

  const fillMaterial = useMemo(() => makeMaterial(0.28, false), []);
  const wireMaterial = useMemo(() => makeMaterial(0.18, true), []);

  useEffect(() => {
    return () => {
      fillMaterial.dispose();
      wireMaterial.dispose();
    };
  }, [fillMaterial, wireMaterial]);

  useFrame(() => {
    if (!showSpacetimeGrid) return;

    const { system, fps } = useSimulationStore.getState();
    const { bodies } = system;
    const count = Math.min(bodies.length, MAX_BODIES);

    // Scale the well strength to the system: the heaviest body should pull
    // the sheet down a fixed visual amount regardless of unit system.
    let maxMass = 0;
    for (let i = 0; i < count; i++) maxMass = Math.max(maxMass, bodies[i]!.mass);
    const eps = 4.5; // wide funnel mouth so wells read clearly at scene scale
    const targetDepth = 14;
    const k = maxMass > 0 ? (targetDepth * eps) / maxMass : 1;

    for (const material of [fillMaterial, wireMaterial]) {
      const u = material.uniforms;
      const positions = u.uBodyPos!.value as THREE.Vector3[];
      const masses = u.uBodyMass!.value as Float32Array;
      for (let i = 0; i < count; i++) {
        const b = bodies[i]!;
        positions[i]!.set(b.position.x, b.position.y, b.position.z);
        masses[i] = b.mass;
      }
      u.uCount!.value = count;
      u.uK!.value = k;
      u.uEps2!.value = eps * eps;
      u.uMaxDepth!.value = targetDepth * 1.15;
    }

    // Degrade resolution under sustained low FPS.
    if (fps > 0 && fps < LOW_FPS_THRESHOLD && segments > MIN_SEGMENTS) {
      lowFpsFramesRef.current += 1;
      if (lowFpsFramesRef.current > LOW_FPS_SUSTAIN_FRAMES) {
        lowFpsFramesRef.current = 0;
        setSegments((s) => Math.max(MIN_SEGMENTS, s / 2));
      }
    } else {
      lowFpsFramesRef.current = 0;
    }
  });

  if (!showSpacetimeGrid) return null;

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <mesh key={`fill-${segments}`} material={fillMaterial}>
        <planeGeometry args={[GRID_SIZE, GRID_SIZE, segments, segments]} />
      </mesh>
      <mesh key={`wire-${segments}`} material={wireMaterial}>
        <planeGeometry args={[GRID_SIZE, GRID_SIZE, segments, segments]} />
      </mesh>
    </group>
  );
}
