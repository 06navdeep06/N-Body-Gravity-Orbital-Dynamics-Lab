"use client";

/**
 * Renders every body's trail as line segments packed into one shared
 * BufferGeometry — a single draw call for all trails combined, instead of
 * one <Line> component per body. Capped at MAX_SEGMENTS total; if the
 * combined trail history would exceed that, each body's contribution is
 * downsampled evenly so no single body can starve the others.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const MAX_SEGMENTS = 20000;

export function Trails() {
  const lineRef = useRef<THREE.LineSegments>(null);
  const showTrails = useSimulationStore((s) => s.showTrails);

  const { positions, colors, geometry } = useMemo(() => {
    const positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
    const colors = new Float32Array(MAX_SEGMENTS * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { positions, colors, geometry };
  }, []);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    if (!showTrails) {
      geometry.setDrawRange(0, 0);
      return;
    }

    const { trails } = useSimulationStore.getState();
    const { bodies } = useSimulationStore.getState().system;
    const colorById = new Map(bodies.map((b) => [b.id, b.color] as const));

    const entries = Object.entries(trails).filter(([, pts]) => pts.length >= 2);
    const totalSegments = entries.reduce((sum, [, pts]) => sum + pts.length - 1, 0);
    const budgetPerBody =
      entries.length > 0 ? Math.max(2, Math.floor(MAX_SEGMENTS / entries.length) + 1) : 0;

    let vertex = 0;
    const c = new THREE.Color();

    for (const [bodyId, pts] of entries) {
      if (vertex >= MAX_SEGMENTS * 2) break;

      c.set(colorById.get(bodyId) ?? "#888888");
      // Downsample this body's trail to fit its share of the budget if the
      // combined history across all bodies would overflow MAX_SEGMENTS.
      const stride = totalSegments > MAX_SEGMENTS ? Math.ceil(pts.length / budgetPerBody) : 1;

      for (let i = 0; i + stride < pts.length; i += stride) {
        if (vertex >= MAX_SEGMENTS * 2 - 1) break;
        const a = pts[i]!;
        const b = pts[Math.min(i + stride, pts.length - 1)]!;

        positions[vertex * 3] = a.x;
        positions[vertex * 3 + 1] = a.y;
        positions[vertex * 3 + 2] = a.z;
        colors[vertex * 3] = c.r;
        colors[vertex * 3 + 1] = c.g;
        colors[vertex * 3 + 2] = c.b;
        vertex++;

        positions[vertex * 3] = b.x;
        positions[vertex * 3 + 1] = b.y;
        positions[vertex * 3 + 2] = b.z;
        colors[vertex * 3] = c.r;
        colors[vertex * 3 + 1] = c.g;
        colors[vertex * 3 + 2] = c.b;
        vertex++;
      }
    }

    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
    geometry.setDrawRange(0, vertex);
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.55} />
    </lineSegments>
  );
}
