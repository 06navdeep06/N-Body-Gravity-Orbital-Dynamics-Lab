"use client";

/**
 * Particle explosion at each collision site: subscribes to the store's
 * collision event log and spawns a short-lived expanding burst of points at
 * the merged body's position. Each burst fades out over ~2s and unmounts.
 *
 * Particle directions are randomized once per burst inside the store
 * subscription callback (never during render), so the component stays pure.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { currentQualitySettings } from "@/lib/performance/profiler";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const PARTICLES_PER_BURST = 80;
const BURST_LIFETIME_S = 2;
const BURST_SPEED = 4;

interface Burst {
  key: string;
  color: string;
  bornAt: number;
  positions: Float32Array;
  velocities: Float32Array;
}

function makeBurst(key: string, color: string, origin: { x: number; y: number; z: number }): Burst {
  const positions = new Float32Array(PARTICLES_PER_BURST * 3);
  const velocities = new Float32Array(PARTICLES_PER_BURST * 3);
  for (let i = 0; i < PARTICLES_PER_BURST; i++) {
    // Uniform random direction, randomized speed.
    const theta = Math.random() * Math.PI * 2;
    const cosPhi = Math.random() * 2 - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const speed = BURST_SPEED * (0.3 + Math.random() * 0.7);
    velocities[i * 3] = sinPhi * Math.cos(theta) * speed;
    velocities[i * 3 + 1] = cosPhi * speed;
    velocities[i * 3 + 2] = sinPhi * Math.sin(theta) * speed;
    positions[i * 3] = origin.x;
    positions[i * 3 + 1] = origin.y;
    positions[i * 3 + 2] = origin.z;
  }
  return { key, color, bornAt: performance.now(), positions, velocities };
}

function BurstPoints({ burst, onExpired }: { burst: Burst; onExpired: (key: string) => void }) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    const material = materialRef.current;
    if (!points || !material) return;

    const age = (performance.now() - burst.bornAt) / 1000;
    if (age > BURST_LIFETIME_S) {
      onExpired(burst.key);
      return;
    }

    const attr = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < PARTICLES_PER_BURST * 3; i++) {
      arr[i] = arr[i]! + burst.velocities[i]! * delta;
    }
    attr.needsUpdate = true;
    material.opacity = Math.max(0, 1 - age / BURST_LIFETIME_S);
    material.size = 0.15 + age * 0.25;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[burst.positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color={burst.color}
        size={0.15}
        transparent
        opacity={1}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function CollisionBursts() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    return useSimulationStore.subscribe((state, prevState) => {
      if (state.collisionEvents === prevState.collisionEvents) return;
      // Purely decorative — suppressed entirely under reduced motion.
      if (useA11yStore.getState().reducedMotion) return;
      // Auto quality scaling drops particle effects before post-processing.
      if (!currentQualitySettings().particleEffects) return;
      const fresh: Burst[] = [];
      for (const event of state.collisionEvents) {
        const key = `${event.timestamp}-${event.bodyA}-${event.bodyB}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        fresh.push(makeBurst(key, event.mergedBody.color, event.mergedBody.position));
      }
      if (fresh.length > 0) setBursts((prev) => [...prev, ...fresh]);
    });
  }, []);

  const handleExpired = (key: string) => {
    setBursts((prev) => prev.filter((b) => b.key !== key));
  };

  return (
    <>
      {bursts.map((b) => (
        <BurstPoints key={b.key} burst={b} onExpired={handleExpired} />
      ))}
    </>
  );
}
