"use client";

/**
 * Renders the ML-predicted trajectory for the selected body as a dotted line,
 * with a tube whose radius is the ±1σ Monte-Carlo-dropout spread.
 *
 * Shown alongside the analytic Keplerian ellipse (OrbitEllipse) so the two
 * predictions — and the body's actual path — can be compared directly.
 */

import { Line } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { orbitPredictor, type PredictionPoint } from "@/lib/ml/orbit-predictor";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const PREDICT_INTERVAL_MS = 600;
const STEPS = 40;

export function MLTrajectory() {
  const show = useSimulationStore((s) => s.showMlPredictions);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const [points, setPoints] = useState<PredictionPoint[]>([]);
  const tubeRef = useRef<THREE.Mesh>(null);

  // Re-predict on a timer, not per frame: a 40-step roll-out with 5 MC
  // passes each is 200 forward passes, which is far too much for 60 Hz.
  useEffect(() => {
    if (!show || !selectedBodyId) return;
    const predict = () => {
      const { system } = useSimulationStore.getState();
      // Horizon of roughly one percent of an orbit per step.
      const horizon = system.timeStep * 40;
      const result = orbitPredictor.predictTrajectory(system, selectedBodyId, horizon, STEPS);
      setPoints(result ?? []);
    };
    const initial = setTimeout(predict, 0);
    const timer = setInterval(predict, PREDICT_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      // Cleared on teardown rather than in the effect body — a synchronous
      // setState there triggers a cascading re-render.
      setPoints([]);
    };
  }, [show, selectedBodyId]);

  const color = useSimulationStore(
    (s) => s.system.bodies.find((b) => b.id === s.selectedBodyId)?.color ?? "#a78bfa"
  );

  const linePoints = useMemo<[number, number, number][]>(
    () => points.map((p) => [p.position.x, p.position.y, p.position.z]),
    [points]
  );

  // Confidence tube: a TubeGeometry along the predicted path, radius set by
  // the mean sigma (a per-point varying radius would need a custom geometry).
  const tubeGeometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p.position.x, p.position.y, p.position.z))
    );
    const meanSigma = points.reduce((s, p) => s + p.sigma, 0) / points.length;
    const radius = Math.max(meanSigma, 1e-4);
    return new THREE.TubeGeometry(curve, Math.min(64, points.length * 2), radius, 8, false);
  }, [points]);

  useEffect(() => {
    return () => {
      tubeGeometry?.dispose();
    };
  }, [tubeGeometry]);

  useEffect(() => {
    if (tubeRef.current && tubeGeometry) tubeRef.current.geometry = tubeGeometry;
  }, [tubeGeometry]);

  if (!show || linePoints.length < 2) return null;

  return (
    <>
      <Line points={linePoints} color={color} dashed dashSize={0.6} gapSize={0.5} transparent opacity={0.5} />
      {tubeGeometry && (
        <mesh ref={tubeRef}>
          <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
