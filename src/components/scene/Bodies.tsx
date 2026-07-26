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
 */

import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const CAPACITY = 1000;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function Bodies() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const selectedRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { bodies } = useSimulationStore.getState().system;
    const selectedId = useSimulationStore.getState().selectedBodyId;
    const visibleCount = Math.min(bodies.length, CAPACITY);

    for (let i = 0; i < CAPACITY; i++) {
      const body = bodies[i];
      if (body) {
        dummy.position.set(body.position.x, body.position.y, body.position.z);
        dummy.scale.setScalar(body.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, tmpColor.set(body.color));
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
        selectedMesh.scale.setScalar(selected.radius * 1.6);
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
      <instancedMesh ref={meshRef} args={[undefined, undefined, CAPACITY]} onClick={handleClick}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial roughness={0.55} metalness={0.15} />
      </instancedMesh>
      <mesh ref={selectedRef} visible={false}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.85} />
      </mesh>
    </>
  );
}
