"use client";

/**
 * VR interaction layer.
 *
 * `<XRRig>` shrinks the whole simulation into a room-scale volume (a ~3 m
 * cube around the user) while in a session and restores it on exit, so the
 * same physics coordinates work for both desktop and VR without touching the
 * simulation itself.
 *
 * Interactions, all through R3F's normal pointer events (which
 * @react-three/xr routes from controller/hand rays):
 *   - point at a body  → hover highlight
 *   - trigger (click)  → select it, opening the floating VR inspector
 *   - squeeze + move   → grab and throw a body, velocity from the gesture
 *   - thumbstick Y     → scale the simulation up/down
 *
 * Outside a session every part of this renders nothing, so the desktop path
 * is untouched.
 */

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXRInputSourceState, XROrigin } from "@react-three/xr";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

/** Scene-graph name of the scaling rig, shared by the components below. */
const XR_RIG_NAME = "xr-sim-rig";

/** Simulation units mapped into ~3 m of play space, adjustable in-session. */
const DEFAULT_VR_SCALE = 0.03;
const MIN_VR_SCALE = 0.0015;
const MAX_VR_SCALE = 0.6;
const THUMBSTICK_DEADZONE = 0.15;
const SCALE_RATE = 1.6; // e-folds per second at full stick

/**
 * Wraps the simulation in a group that is scaled down while in VR. Children
 * keep their simulation-space coordinates.
 */
export function XRRig({ children }: { children: ReactNode }) {
  const inSession = useXR((s) => s.session !== undefined);
  const groupRef = useRef<THREE.Group>(null);
  const scaleRef = useRef(DEFAULT_VR_SCALE);
  const controller = useXRInputSourceState("controller", "right");

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (!inSession) {
      // Desktop: identity transform, no scaling.
      group.scale.setScalar(1);
      group.position.set(0, 0, 0);
      return;
    }

    // Thumbstick Y zooms the world in/out around the user.
    const stickY = controller?.gamepad?.["xr-standard-thumbstick"]?.yAxis ?? 0;
    if (Math.abs(stickY) > THUMBSTICK_DEADZONE) {
      const factor = Math.exp(-stickY * SCALE_RATE * delta);
      scaleRef.current = THREE.MathUtils.clamp(
        scaleRef.current * factor,
        MIN_VR_SCALE,
        MAX_VR_SCALE
      );
    }

    group.scale.setScalar(scaleRef.current);
    // Float the system at chest height in front of the user.
    group.position.set(0, 1.3, 0);
  });

  return (
    <>
      <XROrigin />
      {/* Named so XRGrabInteraction can invert this transform to convert
          controller positions back into simulation coordinates. */}
      <group ref={groupRef} name={XR_RIG_NAME}>
        {children}
      </group>
    </>
  );
}

/**
 * Squeeze-to-grab: while the grip is held with a body selected, the body
 * follows the controller; on release its velocity is set from the controller's
 * recent motion, converted back out of VR scale into simulation units.
 */
export function XRGrabInteraction() {
  const inSession = useXR((s) => s.session !== undefined);
  const leftController = useXRInputSourceState("controller", "left");
  const rightController = useXRInputSourceState("controller", "right");
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);

  const scratch = useMemo(
    () => ({
      worldPos: new THREE.Vector3(),
      lastPos: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      inverse: new THREE.Matrix4(),
    }),
    []
  );
  const grabbingRef = useRef(false);

  useFrame((state, delta) => {
    if (!inSession || !selectedBodyId || delta <= 0) return;

    const squeezing = [leftController, rightController].find(
      (c) => (c?.gamepad?.["xr-standard-squeeze"]?.state ?? "default") === "pressed"
    );
    const store = useSimulationStore.getState();

    if (!squeezing?.object) {
      if (grabbingRef.current) {
        // Release: hand the throw velocity to the body.
        grabbingRef.current = false;
        store.updateBody(selectedBodyId, {
          velocity: {
            x: scratch.velocity.x,
            y: scratch.velocity.y,
            z: scratch.velocity.z,
          },
        });
      }
      return;
    }

    // Controller position in *simulation* space: undo the XRRig transform by
    // going through the rig group's inverse world matrix.
    squeezing.object.getWorldPosition(scratch.worldPos);
    const rig = state.scene.getObjectByName(XR_RIG_NAME);
    if (rig) {
      scratch.inverse.copy(rig.matrixWorld).invert();
      scratch.worldPos.applyMatrix4(scratch.inverse);
    }

    if (!grabbingRef.current) {
      grabbingRef.current = true;
      scratch.lastPos.copy(scratch.worldPos);
      scratch.velocity.set(0, 0, 0);
    } else {
      // Smoothed finite-difference velocity so a jittery frame doesn't
      // launch the body at absurd speed.
      const instant = scratch.worldPos.clone().sub(scratch.lastPos).divideScalar(delta);
      scratch.velocity.lerp(instant, 0.35);
      scratch.lastPos.copy(scratch.worldPos);
    }

    store.updateBody(selectedBodyId, {
      position: { x: scratch.worldPos.x, y: scratch.worldPos.y, z: scratch.worldPos.z },
      velocity: { x: 0, y: 0, z: 0 },
    });
  });

  return null;
}

/**
 * Floating in-VR panels anchored to the left controller: run/pause, the
 * selected body's vitals, and a hint line. Rendered only inside a session,
 * since the desktop build already has real DOM panels.
 */
export function XRPanels() {
  const inSession = useXR((s) => s.session !== undefined);
  const leftController = useXRInputSourceState("controller", "left");
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  const isRunning = useSimulationStore((s) => s.isRunning);
  const togglePlay = useSimulationStore((s) => s.togglePlay);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const selected = bodies.find((b) => b.id === selectedBodyId);

  useFrame(() => {
    const group = groupRef.current;
    const anchor = leftController?.object;
    if (!group || !anchor) return;
    // Sit just above the wrist and always face the headset.
    anchor.getWorldPosition(group.position);
    group.position.y += 0.12;
    group.lookAt(camera.position);
  });

  if (!inSession) return null;

  return (
    <group ref={groupRef}>
      <Html center transform distanceFactor={0.35} style={{ pointerEvents: "auto" }}>
        <div
          style={{
            width: 230,
            background: "rgba(9,11,20,0.94)",
            border: "1px solid #3f3f46",
            borderRadius: 10,
            padding: "10px 12px",
            color: "#f4f4f5",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Orbital Dynamics Lab — VR</div>
          <button
            onClick={togglePlay}
            style={{
              width: "100%",
              padding: "6px 0",
              marginBottom: 8,
              borderRadius: 6,
              border: "none",
              background: isRunning ? "#a16207" : "#0284c7",
              color: "white",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {isRunning ? "Pause" : "Play"}
          </button>

          {selected ? (
            <div style={{ fontFamily: "monospace", fontSize: 10, lineHeight: 1.5 }}>
              <div style={{ color: selected.color, fontWeight: 700 }}>{selected.name}</div>
              <div>mass {selected.mass.toPrecision(4)}</div>
              <div>
                |v| {Math.hypot(selected.velocity.x, selected.velocity.y, selected.velocity.z).toPrecision(4)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#a1a1aa" }}>
              Point at a body and pull the trigger to select it.
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 9, color: "#71717a", lineHeight: 1.5 }}>
            Grip + move: grab &amp; throw · Thumbstick: zoom
          </div>
        </div>
      </Html>
    </group>
  );
}
