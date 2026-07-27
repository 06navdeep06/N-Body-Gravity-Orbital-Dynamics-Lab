"use client";

/**
 * Tidal-stream rendering: disruption fragments drawn as point sprites
 * stretched along their velocity vector, which reads as flowing debris
 * rather than a cloud of dots, plus an expanding shockwave ring at each
 * disruption site.
 *
 * The stream shape itself is emergent — the fragments are ordinary bodies
 * evolving under the N-body integrator. This component only changes how
 * they look.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MAX_FRAGMENTS = 4000;
const SHOCKWAVE_LIFETIME_S = 1.6;

/**
 * Stretches each sprite along the fragment's velocity. Done in the vertex
 * shader from a per-instance velocity attribute so the whole stream is one
 * draw call regardless of fragment count.
 */
const vertexShader = /* glsl */ `
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  varying float vStretch;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Faster fragments render longer, up to a cap — the visual cue for the
    // velocity shear that produces the leading/trailing tails.
    float speed = length(aVelocity);
    vStretch = clamp(speed * 0.12, 0.0, 3.0);

    gl_PointSize = aSize * (1.0 + vStretch) * (240.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vStretch;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    // Squeeze the sprite across its short axis so it reads as a streak.
    uv.x *= 1.0 + vStretch;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, alpha * 0.9);
  }
`;

interface Shockwave {
  key: string;
  position: THREE.Vector3;
  color: string;
  bornAt: number;
  scale: number;
}

function ShockwaveRing({ wave, onExpired }: { wave: Shockwave; onExpired: (k: string) => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    const age = (performance.now() - wave.bornAt) / 1000;
    if (age > SHOCKWAVE_LIFETIME_S) {
      onExpired(wave.key);
      return;
    }
    const t = age / SHOCKWAVE_LIFETIME_S;
    mesh.scale.setScalar(wave.scale * (0.25 + t * 4.5));
    material.opacity = (1 - t) * 0.75;
  });

  return (
    <mesh ref={meshRef} position={wave.position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.82, 1, 64]} />
      <meshBasicMaterial
        ref={materialRef}
        color={wave.color}
        transparent
        opacity={0.75}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

interface StreamBuffers {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}

function createStreamBuffers(): StreamBuffers {
  const positions = new Float32Array(MAX_FRAGMENTS * 3);
  const velocities = new Float32Array(MAX_FRAGMENTS * 3);
  const colors = new Float32Array(MAX_FRAGMENTS * 3);
  const sizes = new Float32Array(MAX_FRAGMENTS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aVelocity", new THREE.BufferAttribute(velocities, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return { geometry, material, positions, velocities, colors, sizes };
}

export function TidalStream() {
  const pointsRef = useRef<THREE.Points>(null);
  const [shockwaves, setShockwaves] = useState<Shockwave[]>([]);
  const seenRef = useRef(new Set<string>());
  // Created and attached inside an effect, mutated only from useFrame — both
  // run after React's commit, so nothing is written during render.
  const buffersRef = useRef<StreamBuffers | null>(null);

  useEffect(() => {
    const buffers = createStreamBuffers();
    buffersRef.current = buffers;
    const points = pointsRef.current;
    if (points) {
      points.geometry = buffers.geometry;
      points.material = buffers.material;
    }
    return () => {
      buffersRef.current = null;
      buffers.geometry.dispose();
      buffers.material.dispose();
    };
  }, []);

  // Shockwaves are spawned from a store subscription (not during render) so
  // the component stays pure.
  useEffect(() => {
    return useSimulationStore.subscribe((state, prev) => {
      if (state.disruptionEvents === prev.disruptionEvents) return;
      const fresh: Shockwave[] = [];
      for (const event of state.disruptionEvents) {
        const key = `${event.timestamp}-${event.disruptedBody}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        const first = event.fragments[0];
        if (!first) continue;
        const totalMass = event.fragments.reduce((sum, f) => sum + f.mass, 0);
        fresh.push({
          key,
          position: new THREE.Vector3(first.position.x, first.position.y, first.position.z),
          color: first.color,
          bornAt: performance.now(),
          scale: Math.max(1, Math.cbrt(totalMass) * 3),
        });
      }
      if (fresh.length > 0) setShockwaves((prevWaves) => [...prevWaves, ...fresh]);
    });
  }, []);

  useFrame(() => {
    const points = pointsRef.current;
    const buffers = buffersRef.current;
    if (!points || !buffers) return;

    const { bodies } = useSimulationStore.getState().system;
    const { geometry, positions, velocities, colors, sizes } = buffers;
    const color = new THREE.Color();
    let n = 0;

    for (const body of bodies) {
      if (!body.isFragment) continue;
      if (n >= MAX_FRAGMENTS) break;
      const o = n * 3;
      positions[o] = body.position.x;
      positions[o + 1] = body.position.y;
      positions[o + 2] = body.position.z;
      velocities[o] = body.velocity.x;
      velocities[o + 1] = body.velocity.y;
      velocities[o + 2] = body.velocity.z;
      color.set(body.color);
      colors[o] = color.r;
      colors[o + 1] = color.g;
      colors[o + 2] = color.b;
      sizes[n] = Math.max(1.2, body.radius * 14);
      n++;
    }

    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.aVelocity!.needsUpdate = true;
    geometry.attributes.aColor!.needsUpdate = true;
    geometry.attributes.aSize!.needsUpdate = true;
    geometry.setDrawRange(0, n);
  });

  const handleExpired = (key: string) => {
    setShockwaves((prev) => prev.filter((w) => w.key !== key));
  };

  return (
    <>
      {/* geometry/material attached imperatively once created in the effect */}
      <points ref={pointsRef} frustumCulled={false} />
      {shockwaves.map((wave) => (
        <ShockwaveRing key={wave.key} wave={wave} onExpired={handleExpired} />
      ))}
    </>
  );
}
