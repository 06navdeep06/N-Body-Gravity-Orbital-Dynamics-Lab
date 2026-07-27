"use client";

/**
 * Chaos map: a texture over the orbital plane where each pixel is the
 * Lyapunov exponent of a test particle launched from that (radius,
 * speed-factor) initial condition. Green = regular, red = chaotic.
 *
 * Rows stream in from the analysis worker, so the texture is re-uploaded as
 * the sweep progresses and the plate fills in top-to-bottom.
 *
 * The map is a *parameter-space* plot, not a spatial one: X is launch radius
 * (which does map to distance from the primary) but Y is the launch speed as
 * a fraction of circular velocity. It's rendered as a flat plate beside the
 * orbital plane rather than pretending to be a spatial overlay.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useAnalysisStore } from "@/lib/stores/analysis-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const TEXTURE_MAX = 64;

/** Maps an exponent to a green→yellow→red ramp; grey for not-yet-computed. */
function exponentColor(lambda: number, out: THREE.Color): THREE.Color {
  if (!Number.isFinite(lambda)) return out.setRGB(0.13, 0.14, 0.17);
  if (lambda <= 0) return out.setRGB(0.29, 0.87, 0.5);
  const t = Math.min(1, lambda / 0.25);
  return t < 0.5
    ? out.setRGB(0.29 + t * 1.4, 0.87 - t * 0.1, 0.5 - t * 0.8)
    : out.setRGB(0.98, 0.82 - (t - 0.5) * 1.2, 0.2 - (t - 0.5) * 0.3);
}

export function ChaosHeatmap() {
  const show = useSimulationStore((s) => s.showChaosMap);
  const chaosMap = useAnalysisStore((s) => s.chaosMap);
  const meshRef = useRef<THREE.Mesh>(null);
  // Fixed-capacity RGBA buffer + texture, allocated once inside an effect
  // and re-uploaded as rows arrive (a new DataTexture per row would thrash
  // GPU memory). Held in refs so nothing is created or read during render.
  const gpuRef = useRef<{ texture: THREE.DataTexture; data: Uint8Array } | null>(null);

  useEffect(() => {
    const data = new Uint8Array(TEXTURE_MAX * TEXTURE_MAX * 4);
    const texture = new THREE.DataTexture(data, TEXTURE_MAX, TEXTURE_MAX, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    gpuRef.current = { texture, data };
    return () => {
      gpuRef.current = null;
      texture.dispose();
    };
  }, []);

  useEffect(() => {
    const gpu = gpuRef.current;
    if (!chaosMap || !gpu) return;
    const { texture, data } = gpu;

    // Bind the texture here rather than in the mount effect: on first mount
    // this component renders null (no chaosMap yet), so the mesh ref is
    // still empty at that point and the map would never get attached.
    const material = meshRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (material && material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }

    const { grid, gridSize } = chaosMap;
    const color = new THREE.Color();
    // Nearest-neighbour upscale from gridSize² into the fixed texture.
    for (let y = 0; y < TEXTURE_MAX; y++) {
      const srcRow = Math.min(gridSize - 1, Math.floor((y / TEXTURE_MAX) * gridSize));
      for (let x = 0; x < TEXTURE_MAX; x++) {
        const srcCol = Math.min(gridSize - 1, Math.floor((x / TEXTURE_MAX) * gridSize));
        exponentColor(grid[srcRow * gridSize + srcCol] ?? Number.NaN, color);
        const o = (y * TEXTURE_MAX + x) * 4;
        data[o] = Math.round(color.r * 255);
        data[o + 1] = Math.round(color.g * 255);
        data[o + 2] = Math.round(color.b * 255);
        data[o + 3] = 210;
      }
    }
    texture.needsUpdate = true;
  }, [chaosMap]);

  if (!show || !chaosMap) return null;

  const { spec } = chaosMap;
  // Fixed plate size: this is a parameter-space chart, so its dimensions
  // carry no spatial meaning and a fixed size keeps it readable whatever the
  // radius range is.
  const width = 44;
  const height = 26;

  return (
    <group
      // Laid flat and parked on the far side of the system (−Z, away from the
      // default camera) so it reads as a chart beside the orbits instead of
      // looming in the foreground over them.
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.2, -(spec.radiusMax * 1.25)]}
    >
      <mesh ref={meshRef}>
        <planeGeometry args={[width, height]} />
        {/* `map` is attached imperatively once the texture exists. */}
        <meshBasicMaterial transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
