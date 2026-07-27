"use client";

/**
 * Outgoing gravitational-wave fronts: concentric rings expanding from the
 * binary's center of mass across the orbital plane, spaced by the GW
 * wavelength λ = c / f_GW and fading with 1/r (strain amplitude, not
 * intensity, falls as 1/r).
 *
 * Drawn as a single ring-shaped mesh with a radial-wave fragment shader
 * rather than N ring meshes, so it's one draw call and the wave phase
 * advances by animating a uniform.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { detectBinary, gwAnalyser } from "@/lib/physics/gravitational-waves";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MAX_RADIUS = 220;

const vertexShader = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uWavelength;
  uniform float uPhase;
  uniform float uMaxRadius;
  uniform float uAmplitude;
  uniform vec3 uColor;
  varying vec2 vLocal;

  void main() {
    float r = length(vLocal);
    if (r > uMaxRadius || uWavelength <= 0.0) discard;

    // Outgoing crests: phase decreases with radius so rings travel outward.
    float wave = sin(6.28318530718 * (r / uWavelength) - uPhase);
    // Sharpen into thin fronts rather than a smooth sinusoid wash.
    float crest = pow(max(wave, 0.0), 6.0);

    // Strain falls as 1/r; the +1 keeps the center finite.
    float falloff = 1.0 / (1.0 + r * 0.055);
    // Fade the outer edge so the plate doesn't end in a hard circle.
    float edge = 1.0 - smoothstep(uMaxRadius * 0.65, uMaxRadius, r);

    float alpha = crest * falloff * edge * uAmplitude;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function makeRippleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uWavelength: { value: 0 },
      uPhase: { value: 0 },
      uMaxRadius: { value: MAX_RADIUS },
      uAmplitude: { value: 0 },
      uColor: { value: new THREE.Color("#a5b4fc") },
    },
  });
}

export function GWRipple() {
  const show = useSimulationStore((s) => s.showGwStrain);
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  // Created/attached in an effect and mutated only from useFrame, so the
  // per-frame uniform writes never happen during render.
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    const material = makeRippleMaterial();
    materialRef.current = material;
    if (meshRef.current) meshRef.current.material = material;
    return () => {
      materialRef.current = null;
      material.dispose();
    };
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material || !show) return;

    const { system, speedOfLight } = useSimulationStore.getState();
    const binary = detectBinary(system.bodies);
    const latest = gwAnalyser.latest();

    if (!binary || !latest || latest.frequency <= 0) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(binary.centerOfMass.x, binary.centerOfMass.y, binary.centerOfMass.z);

    const wavelength = speedOfLight / latest.frequency;
    const u = material.uniforms;
    u.uWavelength!.value = wavelength;
    // Crests travel outward at c: phase advances by 2*pi*f per unit time.
    u.uPhase!.value = (u.uPhase!.value as number) + 2 * Math.PI * latest.frequency * delta;
    // Normalize against the running peak so the rings stay visible while the
    // absolute strain (which is ~1e-20 in real units) chirps upward.
    u.uAmplitude!.value = 0.85;
  });

  if (!show) return null;

  return (
    <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <mesh ref={meshRef}>
        <planeGeometry args={[MAX_RADIUS * 2, MAX_RADIUS * 2, 1, 1]} />
      </mesh>
    </group>
  );
}
