"use client";

/**
 * Interactive satellite launcher: hold Shift and move the mouse over the
 * canvas to preview a placement point on the y=0 plane; Shift+click to
 * place a ghost body; drag from there to aim (slingshot mechanic — the
 * launch velocity points opposite the drag, scaled by drag distance);
 * release to spawn the body via `addBody`.
 *
 * Implemented as a large invisible plane that only mounts (and only
 * intercepts pointer events) while Shift is held or a drag is already in
 * progress, so it never steals OrbitControls' mouse input otherwise.
 */

import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { CelestialBody, Vector3D } from "@/lib/physics/types";
import {
  circularOrbitVelocity,
  escapeVelocity,
} from "@/lib/utils/orbital-velocity";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const VELOCITY_SCALE = 0.4;
const GHOST_RADIUS = 0.4;

interface DragState {
  start: Vector3D;
  current: Vector3D;
}

function vecFromPoint(p: { x: number; y: number; z: number }): Vector3D {
  return { x: p.x, y: 0, z: p.z };
}

function sub(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vector3D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

let launchCounter = 0;

export function LaunchPreview() {
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ghostPosition, setGhostPosition] = useState<Vector3D | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const addBody = useSimulationStore((s) => s.addBody);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const interactive = shiftHeld || drag !== null;
  if (!interactive) return null;

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const point = vecFromPoint(event.point);
    if (drag) {
      setDrag({ ...drag, current: point });
    } else {
      setGhostPosition(point);
    }
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!shiftHeld || drag) return;
    event.stopPropagation();
    const point = vecFromPoint(event.point);
    setDrag({ start: point, current: point });
    setGhostPosition(null);
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    event.stopPropagation();

    const dragVector = sub(drag.current, drag.start);
    const velocity: Vector3D = {
      x: -dragVector.x * VELOCITY_SCALE,
      y: 0,
      z: -dragVector.z * VELOCITY_SCALE,
    };

    launchCounter += 1;
    const body: CelestialBody = {
      id: `launch-${launchCounter}`,
      name: `Launched ${launchCounter}`,
      mass: 1,
      position: drag.start,
      velocity,
      color: "#f472b6",
      radius: GHOST_RADIUS,
    };
    addBody(body);
    setDrag(null);
  };

  const primary = inferPrimaryBody(bodies);
  const dragDistance = drag ? length(sub(drag.current, drag.start)) : 0;
  const launchSpeed = dragDistance * VELOCITY_SCALE;
  const distanceFromPrimary = primary && drag ? length(sub(drag.start, primary.position)) : 0;
  const refCircular = primary && distanceFromPrimary > 0 ? circularOrbitVelocity(primary.mass, distanceFromPrimary, G) : 0;
  const refEscape = primary && distanceFromPrimary > 0 ? escapeVelocity(primary.mass, distanceFromPrimary, G) : 0;

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {!drag && ghostPosition && (
        <mesh position={[ghostPosition.x, ghostPosition.y, ghostPosition.z]}>
          <sphereGeometry args={[GHOST_RADIUS, 16, 16]} />
          <meshBasicMaterial color="#f472b6" transparent opacity={0.5} wireframe />
        </mesh>
      )}

      {drag && (
        <>
          <mesh position={[drag.start.x, drag.start.y, drag.start.z]}>
            <sphereGeometry args={[GHOST_RADIUS, 16, 16]} />
            <meshBasicMaterial color="#f472b6" transparent opacity={0.7} />
          </mesh>
          <Line
            points={[
              [drag.start.x, drag.start.y, drag.start.z],
              [drag.current.x, drag.current.y, drag.current.z],
            ]}
            color="#f472b6"
          />
          <Html position={[drag.start.x, drag.start.y + 2, drag.start.z]} style={{ pointerEvents: "none" }}>
            <div
              style={{
                background: "rgba(10,10,20,0.85)",
                border: "1px solid #f472b6",
                borderRadius: 6,
                padding: "6px 10px",
                color: "#fdf2f8",
                fontFamily: "monospace",
                fontSize: 11,
                whiteSpace: "nowrap",
                transform: "translate(-50%, -100%)",
              }}
            >
              <div>launch speed: {launchSpeed.toFixed(2)}</div>
              {primary && (
                <>
                  <div>circular v @ r: {refCircular.toFixed(2)}</div>
                  <div>escape v @ r: {refEscape.toFixed(2)}</div>
                </>
              )}
            </div>
          </Html>
        </>
      )}
    </>
  );
}
