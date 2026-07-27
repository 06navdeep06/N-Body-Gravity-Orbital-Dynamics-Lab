/**
 * WebGPU N-body engine.
 *
 * Direct O(N²) summation on the GPU: with 256-wide workgroups and shared-memory
 * tiling, brute force beats a CPU Barnes-Hut tree well past 10k bodies, because
 * the tree's build + pointer-chasing cost never vectorizes while the all-pairs
 * inner loop is pure ALU work the GPU is built for. So the GPU path skips the
 * octree entirely.
 *
 * Everything degrades silently: `createGpuEngine()` resolves to null when
 * WebGPU is missing or adapter/device acquisition fails, and callers stay on
 * the Web Worker + RK4 path.
 */

import type { CelestialBody, SystemState } from "../types";
import shaderSource from "./nbody-compute.wgsl";

const WORKGROUP_SIZE = 256;
/** floats per body in each storage buffer (vec4). */
const STRIDE = 4;

export interface GpuEngine {
  /** Runs `steps` Leapfrog steps and returns the updated state. */
  step(state: SystemState, steps: number): Promise<SystemState>;
  /** Largest body count this device's buffer limits allow. */
  getMaxBodies(): number;
  /** Human-readable adapter description for the status bar. */
  readonly adapterLabel: string;
  destroy(): void;
}

/** True when the browser exposes a WebGPU entry point at all. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function createGpuEngine(): Promise<GpuEngine | null> {
  if (!isWebGpuAvailable()) return null;

  let device: GPUDevice;
  let maxBodies: number;
  let adapterLabel: string;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    device = await adapter.requestDevice();
    const maxStorageBytes = device.limits.maxStorageBufferBindingSize;
    // Three storage buffers of 16 bytes/body; cap generously below the limit.
    maxBodies = Math.floor(maxStorageBytes / (STRIDE * 4));
    adapterLabel = adapter.info?.vendor
      ? `${adapter.info.vendor} ${adapter.info.architecture ?? ""}`.trim()
      : "WebGPU device";
  } catch {
    return null;
  }

  const shaderModule = device.createShaderModule({ code: shaderSource, label: "nbody-compute" });

  // Surfaces WGSL compile diagnostics instead of failing silently at dispatch.
  const info = await shaderModule.getCompilationInfo();
  const fatal = info.messages.filter((m) => m.type === "error");
  if (fatal.length > 0) {
    console.error(
      "[gpu-engine] WGSL compilation failed:\n" +
        fatal.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join("\n")
    );
    device.destroy();
    return null;
  }

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

  const makePipeline = (entryPoint: string) =>
    device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint },
      label: entryPoint,
    });

  const bootstrapPipeline = makePipeline("bootstrap_accel");
  const kickDriftPipeline = makePipeline("kick_drift");
  const accelKickPipeline = makePipeline("accel_kick");

  // --- Buffer pool, resized only when the body count grows ---------------
  interface Buffers {
    capacity: number;
    positions: GPUBuffer;
    velocities: GPUBuffer;
    accelerations: GPUBuffer;
    readback: GPUBuffer;
    bindGroup: GPUBindGroup;
  }

  const paramsBuffer = device.createBuffer({
    size: 16, // dt, g, softening (f32) + count (u32)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  let buffers: Buffers | null = null;

  function ensureBuffers(count: number): Buffers {
    if (buffers && buffers.capacity >= count) return buffers;
    buffers?.positions.destroy();
    buffers?.velocities.destroy();
    buffers?.accelerations.destroy();
    buffers?.readback.destroy();

    // Round up to a whole workgroup so out-of-range lanes read valid memory.
    const capacity = Math.max(WORKGROUP_SIZE, Math.ceil(count / WORKGROUP_SIZE) * WORKGROUP_SIZE);
    const bytes = capacity * STRIDE * 4;
    const storageUsage =
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    const positions = device.createBuffer({ size: bytes, usage: storageUsage });
    const velocities = device.createBuffer({ size: bytes, usage: storageUsage });
    const accelerations = device.createBuffer({ size: bytes, usage: storageUsage });
    // 2x: positions and velocities are read back in one mapped buffer.
    const readback = device.createBuffer({
      size: bytes * 2,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: positions } },
        { binding: 1, resource: { buffer: velocities } },
        { binding: 2, resource: { buffer: accelerations } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });

    buffers = { capacity, positions, velocities, accelerations, readback, bindGroup };
    return buffers;
  }

  // Scratch host arrays, reused across frames to avoid per-frame allocation.
  let hostPositions = new Float32Array(0);
  let hostVelocities = new Float32Array(0);

  async function step(state: SystemState, steps: number): Promise<SystemState> {
    const bodies = state.bodies;
    const count = bodies.length;
    if (count === 0 || steps <= 0) return state;

    const buf = ensureBuffers(count);
    const floats = buf.capacity * STRIDE;
    if (hostPositions.length !== floats) {
      hostPositions = new Float32Array(floats);
      hostVelocities = new Float32Array(floats);
    } else {
      // Zero the tail so stale bodies from a previous larger frame can't
      // keep exerting phantom gravity.
      hostPositions.fill(0, count * STRIDE);
      hostVelocities.fill(0, count * STRIDE);
    }

    for (let i = 0; i < count; i++) {
      const b = bodies[i]!;
      const o = i * STRIDE;
      hostPositions[o] = b.position.x;
      hostPositions[o + 1] = b.position.y;
      hostPositions[o + 2] = b.position.z;
      hostPositions[o + 3] = b.mass;
      hostVelocities[o] = b.velocity.x;
      hostVelocities[o + 1] = b.velocity.y;
      hostVelocities[o + 2] = b.velocity.z;
      hostVelocities[o + 3] = b.isFixed ? 1 : 0;
    }

    device.queue.writeBuffer(buf.positions, 0, hostPositions);
    device.queue.writeBuffer(buf.velocities, 0, hostVelocities);

    const params = new ArrayBuffer(16);
    new Float32Array(params, 0, 3).set([state.timeStep, state.G, state.softening]);
    new Uint32Array(params, 12, 1)[0] = count;
    device.queue.writeBuffer(paramsBuffer, 0, params);

    const workgroups = Math.ceil(count / WORKGROUP_SIZE);
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, buf.bindGroup);

    // a_old for the first half-kick.
    pass.setPipeline(bootstrapPipeline);
    pass.dispatchWorkgroups(workgroups);

    for (let s = 0; s < steps; s++) {
      pass.setPipeline(kickDriftPipeline);
      pass.dispatchWorkgroups(workgroups);
      pass.setPipeline(accelKickPipeline);
      pass.dispatchWorkgroups(workgroups);
    }
    pass.end();

    const byteLength = buf.capacity * STRIDE * 4;
    encoder.copyBufferToBuffer(buf.positions, 0, buf.readback, 0, byteLength);
    encoder.copyBufferToBuffer(buf.velocities, 0, buf.readback, byteLength, byteLength);
    device.queue.submit([encoder.finish()]);

    await buf.readback.mapAsync(GPUMapMode.READ);
    const mapped = buf.readback.getMappedRange();
    const outPositions = new Float32Array(mapped, 0, floats);
    const outVelocities = new Float32Array(mapped, byteLength, floats);

    const nextBodies: CelestialBody[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const b = bodies[i]!;
      const o = i * STRIDE;
      nextBodies[i] = b.isFixed
        ? b
        : {
            ...b,
            position: { x: outPositions[o]!, y: outPositions[o + 1]!, z: outPositions[o + 2]! },
            velocity: { x: outVelocities[o]!, y: outVelocities[o + 1]!, z: outVelocities[o + 2]! },
          };
    }
    buf.readback.unmap();

    return { ...state, bodies: nextBodies };
  }

  return {
    step,
    getMaxBodies: () => maxBodies,
    adapterLabel,
    destroy() {
      buffers?.positions.destroy();
      buffers?.velocities.destroy();
      buffers?.accelerations.destroy();
      buffers?.readback.destroy();
      paramsBuffer.destroy();
      device.destroy();
    },
  };
}
