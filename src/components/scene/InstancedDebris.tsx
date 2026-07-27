"use client";

/**
 * Instanced asteroid / debris renderer.
 *
 * Small bodies used to be drawn as spheres in the shared instanced mesh,
 * which reads as a cloud of beads. Real rubble is angular and tumbling, so
 * each one here is a low-poly dodecahedron or icosahedron with its own
 * randomised orientation, tumble rate and non-uniform scale — enough shape
 * variance that a belt reads as rock at a glance, still one draw call per
 * geometry.
 *
 * Per-instance randomness is split by where it is consumed:
 *  - Transform data (orientation, tumble, scale) is CPU-side, because the
 *    instance matrix has to carry the physics position anyway.
 *  - Shading data (surface seed, albedo variance) rides on
 *    `InstancedBufferAttribute`s and is consumed in the shader, so it costs
 *    nothing per frame.
 *
 * The debris' *positions* come from the physics store untouched. This
 * component invents orientation and spin only, which the engine does not
 * model — no integration state is read back or written.
 */

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { colorBlindColor } from "@/lib/a11y/preferences";
import { assignBodyRoles, topologySignature } from "@/lib/render/body-roles";
import type { RenderFeatures } from "@/lib/render/quality-preset";
import { useQualityPreset } from "@/lib/render/quality-preset";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { proceduralRockNormal } from "@/lib/textures/procedural";
import { findBlackHoles } from "./BlackHole";

/** Two silhouettes, alternating by instance, so the field is not one shape. */
const SHAPE_COUNT = 2;

/** Deterministic PRNG so a belt looks the same on every reload. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface InstanceState {
  /** Current orientation, advanced by `spin` each frame. */
  quaternion: THREE.Quaternion;
  /** Tumble axis and rate, packed as an axis-scaled vector (rad/s). */
  spin: THREE.Vector3;
  /** Non-uniform scale multipliers — rocks are not spheres. */
  scale: THREE.Vector3;
}

function makeInstanceStates(count: number, seed: number): InstanceState[] {
  const random = mulberry32(seed);
  const states: InstanceState[] = [];
  const axis = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    axis
      .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      .normalize();
    states.push({
      quaternion: new THREE.Quaternion().setFromAxisAngle(axis, random() * Math.PI * 2),
      spin: axis
        .clone()
        .multiplyScalar(0.15 + random() * 0.9),
      scale: new THREE.Vector3(
        0.75 + random() * 0.55,
        0.7 + random() * 0.6,
        0.72 + random() * 0.58
      ),
    });
  }
  return states;
}

/**
 * Patches a standard material to read the per-instance attributes.
 *
 * `onBeforeCompile` rather than a bespoke ShaderMaterial: this keeps the full
 * PBR lighting model, shadow reception and tone mapping that
 * MeshStandardMaterial already implements, and adds only the two lines that
 * consume the instanced attributes.
 */
function patchDebrisMaterial(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aSeed;
         attribute float aShade;
         varying float vShade;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vShade = aShade;
         // Per-instance vertex jitter keyed off the seed: breaks the tell that
         // every rock is the same platonic solid at a different orientation.
         transformed *= 1.0 + 0.16 * sin(aSeed * 43.0 + position.x * 9.0 + position.y * 7.0);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vShade;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         diffuseColor.rgb *= vShade;`
      );
  };
  // Forces a program recompile if the material is reused after patching.
  material.needsUpdate = true;
}

interface DebrisMeshProps {
  /** Which of the two silhouettes this mesh draws. */
  shape: number;
  capacity: number;
  features: RenderFeatures;
  normalMap: THREE.Texture | null;
  /** Selects the instances belonging to this shape from the debris list. */
  slotOf: (debrisIndex: number) => boolean;
  debrisIndicesRef: RefObject<number[]>;
}

function DebrisMesh({
  shape,
  capacity,
  features,
  normalMap,
  slotOf,
  debrisIndicesRef,
}: DebrisMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  /**
   * Slot -> body id, rebuilt each frame. Debris slots are packed, so unlike
   * `<Bodies />` the instance index is not the body index and picking needs
   * this table to resolve a click back to a body.
   */
  const slotBodyIds = useRef<string[]>([]);

  const states = useMemo(() => makeInstanceStates(capacity, 9001 + shape * 7919), [capacity, shape]);

  const attributes = useMemo(() => {
    const random = mulberry32(31337 + shape * 104729);
    const seeds = new Float32Array(capacity);
    const shades = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      seeds[i] = random();
      // Albedo variance: real rubble piles are not uniformly grey.
      shades[i] = 0.55 + random() * 0.75;
    }
    return {
      aSeed: new THREE.InstancedBufferAttribute(seeds, 1),
      aShade: new THREE.InstancedBufferAttribute(shades, 1),
    };
  }, [capacity, shape]);

  const geometry = useMemo(() => {
    const base =
      shape === 0
        ? new THREE.DodecahedronGeometry(1, 0)
        : new THREE.IcosahedronGeometry(1, 0);
    // Flat-shaded facets need per-face normals, and the instanced attributes
    // have to live on the geometry that is actually drawn.
    const geo = base.toNonIndexed();
    base.dispose();
    geo.computeVertexNormals();
    geo.setAttribute("aSeed", attributes.aSeed);
    geo.setAttribute("aShade", attributes.aShade);
    return geo;
  }, [shape, attributes]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // The normal map is supplied at construction rather than assigned later:
  // it arrives at most once (it is module-cached), and rebuilding the
  // material is cheaper than the shader recompile a late assignment forces.
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: "#9a8f82",
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
      normalMap,
    });
    patchDebrisMaterial(mat);
    return mat;
  }, [normalMap]);

  useEffect(() => () => material.dispose(), [material]);

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      spinDelta: new THREE.Quaternion(),
      color: new THREE.Color(),
    }),
    []
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const debrisIndices = debrisIndicesRef.current;
    if (!mesh || !debrisIndices) return;

    const { system, visualRadiusScale, maxDisplayRadius } = useSimulationStore.getState();
    const colorBlind = useA11yStore.getState().colorBlindMode;
    const { bodies } = system;

    // Clamp the timestep: a backgrounded tab hands back a multi-second delta,
    // which would spin every rock through a random number of revolutions.
    const step = Math.min(delta, 0.1);

    let slot = 0;
    for (let d = 0; d < debrisIndices.length && slot < capacity; d++) {
      if (!slotOf(d)) continue;
      const body = bodies[debrisIndices[d]!];
      if (!body) continue;

      const state = states[slot]!;
      // Integrate the tumble. Small-angle composition is fine here — this is
      // decoration, and it stays a unit quaternion because both operands are.
      scratch.spinDelta.setFromAxisAngle(
        scratch.axis.copy(state.spin).normalize(),
        state.spin.length() * step
      );
      state.quaternion.multiply(scratch.spinDelta).normalize();

      const scaled = body.radius * visualRadiusScale;
      const radius = maxDisplayRadius > 0 ? Math.min(scaled, maxDisplayRadius) : scaled;
      scratch.scale.copy(state.scale).multiplyScalar(radius);
      scratch.position.set(body.position.x, body.position.y, body.position.z);
      scratch.matrix.compose(scratch.position, state.quaternion, scratch.scale);
      mesh.setMatrixAt(slot, scratch.matrix);
      mesh.setColorAt(slot, scratch.color.set(colorBlind ? colorBlindColor(body.id) : body.color));
      slotBodyIds.current[slot] = body.id;
      slot++;
    }

    slotBodyIds.current.length = slot;
    mesh.count = slot;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const id = slotBodyIds.current[event.instanceId];
    if (id) useSimulationStore.getState().selectBody(id);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      castShadow={features.dynamicShadows}
      receiveShadow={features.dynamicShadows}
      // Instances are repositioned every frame from the physics store, so the
      // mesh's own bounding sphere is meaningless for culling.
      frustumCulled={false}
      onClick={handleClick}
    />
  );
}

export function InstancedDebris() {
  const features = useQualityPreset();
  // A number, not the array — see `topologySignature`. The debris *set* only
  // changes on collisions, disruptions and preset loads; the debris
  // *positions* are read from the store every frame down in DebrisMesh.
  const topology = useSimulationStore((s) => topologySignature(s.system.bodies));

  const debrisIndicesRef = useRef<number[]>([]);

  const debrisIndices = useMemo(() => {
    const { system, speedOfLight } = useSimulationStore.getState();
    const { bodies } = system;
    const blackHoleIds = new Set(
      findBlackHoles(bodies, system.G, speedOfLight).map(({ body }) => body.id)
    );
    return assignBodyRoles(bodies, features, blackHoleIds).debris;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `topology` is the staleness signal for the getState() read above
  }, [topology, features]);

  // Handed to the frame loop through a ref rather than a prop: the loop must
  // not re-subscribe when the selection changes, and writing a ref during
  // render is not allowed.
  useEffect(() => {
    debrisIndicesRef.current = debrisIndices;
  }, [debrisIndices]);

  // Capacity is allocated in coarse steps so ordinary churn (a fragment
  // merging, one body added) does not reallocate two instanced meshes.
  const capacity = useMemo(() => {
    if (debrisIndices.length === 0) return 0;
    const perShape = Math.ceil(debrisIndices.length / SHAPE_COUNT);
    return Math.min(
      Math.ceil(features.debrisBudget / SHAPE_COUNT),
      Math.max(64, 1 << Math.ceil(Math.log2(perShape)))
    );
  }, [debrisIndices.length, features.debrisBudget]);

  // Shared and cached across every belt in the app, so it is not disposed here.
  const normalMap = useMemo(
    () => (features.pbrMaterials ? proceduralRockNormal() : null),
    [features.pbrMaterials]
  );

  if (!features.instancedDebris || capacity === 0) return null;

  return (
    <>
      {Array.from({ length: SHAPE_COUNT }, (_, shape) => (
        <DebrisMesh
          key={shape}
          shape={shape}
          capacity={capacity}
          features={features}
          normalMap={normalMap}
          slotOf={(debrisIndex) => debrisIndex % SHAPE_COUNT === shape}
          debrisIndicesRef={debrisIndicesRef}
        />
      ))}
    </>
  );
}
