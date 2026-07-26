"use client";

/**
 * Draws a velocity-direction arrow per body, using a pool of
 * THREE.ArrowHelper instances (their line/cone geometries are shared
 * statics across all instances, so growing/shrinking the pool is cheap).
 * Opt-in visualization — capped at MAX_ARROWS since it isn't the
 * instanced/single-draw-call path large presets rely on for 60fps.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const VELOCITY_SCALE = 1.5;
const MAX_ARROWS = 200;

export function VelocityArrows() {
  const groupRef = useRef<THREE.Group>(null);
  const arrowsRef = useRef<THREE.ArrowHelper[]>([]);
  const showVelocityArrows = useSimulationStore((s) => s.showVelocityArrows);
  const direction = new THREE.Vector3();

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    if (!showVelocityArrows) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const { bodies } = useSimulationStore.getState().system;
    const arrows = arrowsRef.current;
    const count = Math.min(bodies.length, MAX_ARROWS);

    while (arrows.length < count) {
      const arrow = new THREE.ArrowHelper();
      group.add(arrow);
      arrows.push(arrow);
    }
    while (arrows.length > count) {
      const arrow = arrows.pop()!;
      group.remove(arrow);
    }

    for (let i = 0; i < count; i++) {
      const body = bodies[i]!;
      const arrow = arrows[i]!;
      direction.set(body.velocity.x, body.velocity.y, body.velocity.z);
      const speed = direction.length();

      arrow.position.set(body.position.x, body.position.y, body.position.z);
      if (speed > 1e-6) {
        arrow.visible = true;
        direction.normalize();
        arrow.setDirection(direction);
        const length = Math.max(0.5, Math.min(15, speed * VELOCITY_SCALE));
        arrow.setLength(length, Math.min(1, length * 0.25), Math.min(0.5, length * 0.12));
        arrow.setColor(new THREE.Color(body.color));
      } else {
        arrow.visible = false;
      }
    }
  });

  return <group ref={groupRef} />;
}
