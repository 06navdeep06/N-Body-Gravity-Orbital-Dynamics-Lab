"use client";

/**
 * Single owner of all camera behavior. Reads `cameraMode` from the store
 * and, each frame, computes a desired camera position + look-at target,
 * then eases toward them (exponential lerp ≈ 1s transition), so switching
 * modes glides instead of snapping.
 *
 * - free:       OrbitControls active; this component stands down.
 * - follow:     chase the selected body at a fixed offset.
 * - topdown:    orthographic camera looking straight down Y.
 * - flyby:      hold a fixed vantage point, keep aiming at the body.
 * - corotating: rotate with the selected body's angular position around the
 *               primary so the body appears frozen; everything else moves.
 * - dolly:      slow automated orbit of the origin with a zoom pulse.
 */

import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const LERP_RATE = 3.2; // higher = snappier transitions
const desired = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const currentTarget = new THREE.Vector3();

export function CameraController() {
  const cameraMode = useSimulationStore((s) => s.cameraMode);
  const size = useThree((s) => s.size);
  const flybyAnchor = useRef<THREE.Vector3 | null>(null);
  const lastMode = useRef(cameraMode);

  useFrame(({ camera }, delta) => {
    const { system, selectedBodyId } = useSimulationStore.getState();
    const selected = system.bodies.find((b) => b.id === selectedBodyId) ?? null;

    if (lastMode.current !== cameraMode) {
      lastMode.current = cameraMode;
      flybyAnchor.current = null;
    }

    if (cameraMode === "free") return; // OrbitControls owns the camera

    const t = 1 - Math.exp(-LERP_RATE * delta);

    switch (cameraMode) {
      case "follow": {
        if (!selected) return;
        const dist = Math.max(selected.radius * 12, 6);
        desired.set(
          selected.position.x + dist * 0.7,
          selected.position.y + dist * 0.55,
          selected.position.z + dist * 0.7
        );
        desiredTarget.set(selected.position.x, selected.position.y, selected.position.z);
        break;
      }
      case "topdown": {
        desired.set(0, 120, 0.001);
        desiredTarget.set(0, 0, 0);
        break;
      }
      case "flyby": {
        if (!selected) return;
        if (!flybyAnchor.current) {
          // Park near (but not on) the body's current position and stay put.
          flybyAnchor.current = new THREE.Vector3(
            selected.position.x + 10,
            selected.position.y + 4,
            selected.position.z + 10
          );
        }
        desired.copy(flybyAnchor.current);
        desiredTarget.set(selected.position.x, selected.position.y, selected.position.z);
        break;
      }
      case "corotating": {
        if (!selected) return;
        const primary = inferPrimaryBody(system.bodies);
        if (!primary || primary.id === selected.id) return;
        const dx = selected.position.x - primary.position.x;
        const dz = selected.position.z - primary.position.z;
        const r = Math.sqrt(dx * dx + dz * dz);
        const phi = Math.atan2(dz, dx);
        // Hover above the primary-selected line, slightly behind the
        // selected body, rotating with it: in this frame the body is still.
        const camR = r * 1.9 + 4;
        desired.set(
          primary.position.x + camR * Math.cos(phi),
          primary.position.y + r * 0.9 + 3,
          primary.position.z + camR * Math.sin(phi)
        );
        desiredTarget.set(primary.position.x, primary.position.y, primary.position.z);
        break;
      }
      case "dolly": {
        const time = performance.now() / 1000;
        const angle = time * 0.12;
        const radius = 70 + 14 * Math.sin(time * 0.35);
        desired.set(radius * Math.cos(angle), 34 + 8 * Math.sin(time * 0.2), radius * Math.sin(angle));
        desiredTarget.set(0, 0, 0);
        break;
      }
    }

    camera.position.lerp(desired, t);
    currentTarget.lerp(desiredTarget, t);
    camera.lookAt(currentTarget);
  });

  const isOrtho = cameraMode === "topdown";
  const orthoZoom = Math.min(size.width, size.height) / 130;

  return (
    <>
      <PerspectiveCamera makeDefault={!isOrtho} position={[0, 40, 70]} fov={50} near={0.1} far={5000} />
      <OrthographicCamera
        makeDefault={isOrtho}
        position={[0, 120, 0.001]}
        zoom={orthoZoom}
        near={0.1}
        far={5000}
      />
      <OrbitControls
        enabled={cameraMode === "free"}
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={2000}
        makeDefault
      />
    </>
  );
}
