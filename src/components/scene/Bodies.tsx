"use client";

/**
 * Renders every celestial body as a single InstancedMesh — one draw call
 * regardless of body count (O(1) instead of O(N) individual <Sphere>
 * components), which is what keeps 100+-body presets like Asteroid Belt
 * and Galaxy Collision at 60fps.
 *
 * The mesh is allocated at a fixed capacity; unused instance slots beyond
 * the current body count are scaled to zero rather than reallocating the
 * mesh, so body counts can change (collisions merging bodies, users adding
 * bodies) without remounting.
 *
 * This is the *baseline* renderer. Above the Low quality preset some bodies
 * are drawn instead by `<PhotorealisticBodies />` (multi-layer PBR shells) or
 * `<InstancedDebris />` (tumbling rock geometry); those slots are scaled to
 * zero here so nothing is drawn twice. The partition comes from
 * `assignBodyRoles`, which all three renderers call with the same inputs.
 * Instance indices still line up with body indices either way, which is what
 * `onClick` relies on to resolve `instanceId` back to a body.
 */

import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { currentQualitySettings } from "@/lib/performance/profiler";
import { colorBlindColor } from "@/lib/a11y/preferences";
import { assignBodyRoles } from "@/lib/render/body-roles";
import { currentRenderFeatures } from "@/lib/render/quality-preset";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { findBlackHoles } from "./BlackHole";

const CAPACITY = 1000;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function Bodies() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const selectedRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const segments = currentQualitySettings().sphereSegments;

  const scratch = useMemo(() => ({ blackHoleIds: new Set<string>() }), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const {
      system,
      selectedBodyId: selectedId,
      visualRadiusScale,
      maxDisplayRadius,
      speedOfLight,
    } = useSimulationStore.getState();
    const colorBlind = useA11yStore.getState().colorBlindMode;
    const { bodies } = system;
    const visibleCount = Math.min(bodies.length, CAPACITY);

    // Recomputed per frame rather than memoised: it must agree exactly with
    // what the other two renderers are drawing *this* frame, and a stale
    // partition would show a body twice or not at all for a frame after a
    // collision. The cost is a couple of passes over the body array.
    scratch.blackHoleIds.clear();
    for (const { body } of findBlackHoles(bodies, system.G, speedOfLight)) {
      scratch.blackHoleIds.add(body.id);
    }
    const { roles } = assignBodyRoles(bodies, currentRenderFeatures(), scratch.blackHoleIds);

    const displayRadius = (radius: number): number => {
      const scaled = radius * visualRadiusScale;
      return maxDisplayRadius > 0 ? Math.min(scaled, maxDisplayRadius) : scaled;
    };

    for (let i = 0; i < CAPACITY; i++) {
      const body = bodies[i];
      if (body) {
        dummy.position.set(body.position.x, body.position.y, body.position.z);
        // A body claimed by another renderer keeps its slot (so instanceId
        // still maps to the body index for picking) but draws nothing.
        dummy.scale.setScalar(roles[i] === "instanced" ? displayRadius(body.radius) : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Color-blind mode remaps to the Okabe-Ito palette keyed by body id,
        // so bodies stay mutually distinguishable under CVD.
        mesh.setColorAt(i, tmpColor.set(colorBlind ? colorBlindColor(body.id) : body.color));
      } else if (i < visibleCount + 1) {
        // Only need to zero-out the slot immediately past the live range;
        // farther slots were already zeroed on a previous frame.
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      } else {
        break;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = visibleCount;

    const selectedMesh = selectedRef.current;
    if (selectedMesh) {
      const selected = bodies.find((b) => b.id === selectedId);
      if (selected) {
        selectedMesh.visible = true;
        selectedMesh.position.set(selected.position.x, selected.position.y, selected.position.z);
        selectedMesh.scale.setScalar(displayRadius(selected.radius) * 1.6);
      } else {
        selectedMesh.visible = false;
      }
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const body = useSimulationStore.getState().system.bodies[event.instanceId];
    if (body) selectBody(body.id);
  };

  return (
    <>
      <instancedMesh
        key={`bodies-${segments}`}
        ref={meshRef}
        args={[undefined, undefined, CAPACITY]}
        onClick={handleClick}
      >
        {/* Tessellation drops with the quality tier. */}
        <sphereGeometry args={[1, segments, Math.max(8, Math.round(segments * 0.75))]} />
        <meshStandardMaterial roughness={0.55} metalness={0.15} />
      </instancedMesh>
      <mesh ref={selectedRef} visible={false}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.85} />
      </mesh>
    </>
  );
}
