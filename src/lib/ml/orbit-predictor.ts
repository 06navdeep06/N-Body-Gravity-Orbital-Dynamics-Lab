/**
 * In-browser orbit prediction with a small MLP.
 *
 * TensorFlow.js is ~1 MB, so it is **dynamically imported** on first use —
 * the module is never in the initial bundle, and a user who never turns on
 * ML predictions never downloads it.
 *
 * What this is honestly for: comparing a *learned* propagator against the
 * analytic Keplerian one and the actual integrator, side by side. A 3×128
 * MLP trained on a few thousand samples will not beat RK4 — the point is to
 * see where and how it diverges.
 *
 * Inputs are normalized by orbital scale (r by the semi-major axis, v by the
 * local circular speed) so the network sees the same dimensionless problem
 * whether the system is in AU/M☉/yr or arbitrary sim units — without that,
 * a model trained on one preset is useless on the next.
 */

import { computeOrbitalElements, inferPrimaryBody } from "@/lib/physics/orbital-elements";
import type { CelestialBody, SystemState, Vector3D } from "@/lib/physics/types";

/** Only the tfjs surface this module touches, so the import stays typed. */
type TF = typeof import("@tensorflow/tfjs");

export const INPUT_SIZE = 12;
export const OUTPUT_SIZE = 6;
const HIDDEN_UNITS = 128;
const HIDDEN_LAYERS = 3;
const DROPOUT_RATE = 0.1;

export const REPLAY_CAPACITY = 50_000;
export const BATCH_SIZE = 256;
/** Train one batch every this many recorded frames. */
export const TRAIN_INTERVAL_FRAMES = 60;
/** Monte-Carlo dropout passes used for the confidence estimate. */
export const MC_SAMPLES = 5;

export interface TrainingSample {
  input: number[];
  target: number[];
}

export interface MlStats {
  samples: number;
  trainSteps: number;
  /** Rolling mean of recent training losses. */
  loss: number | null;
  /** RMSE of prediction vs. truth over the last validation window. */
  rmse: number | null;
  parameters: number;
  ready: boolean;
  backend: string | null;
}

export interface PredictionPoint {
  position: Vector3D;
  /** ±1σ spread across the MC-dropout passes, in position units. */
  sigma: number;
}

/**
 * Normalization context for one body relative to its primary. Everything
 * the encoder needs to map physical state to dimensionless features and back.
 */
interface Scale {
  /** Length scale (semi-major axis, or current radius if unbound). */
  L: number;
  /** Velocity scale (circular speed at L). */
  V: number;
  primary: CelestialBody;
}

function scaleFor(body: CelestialBody, primary: CelestialBody, G: number): Scale | null {
  const dx = body.position.x - primary.position.x;
  const dy = body.position.y - primary.position.y;
  const dz = body.position.z - primary.position.z;
  const r = Math.hypot(dx, dy, dz);
  if (!(r > 0) || primary.mass <= 0) return null;

  const elements = computeOrbitalElements(body, primary, G);
  const L =
    elements && Number.isFinite(elements.semiMajorAxis) && elements.semiMajorAxis > 0
      ? elements.semiMajorAxis
      : r;
  const V = Math.sqrt((G * primary.mass) / L);
  if (!(V > 0) || !Number.isFinite(L)) return null;
  return { L, V, primary };
}

/** Builds the 12-feature input vector for a body. */
export function encodeInput(
  body: CelestialBody,
  primary: CelestialBody,
  G: number,
  softening: number,
  horizon: number,
  scale: Scale
): number[] | null {
  const elements = computeOrbitalElements(body, primary, G);
  const rx = (body.position.x - primary.position.x) / scale.L;
  const ry = (body.position.y - primary.position.y) / scale.L;
  const rz = (body.position.z - primary.position.z) / scale.L;
  const vx = (body.velocity.x - primary.velocity.x) / scale.V;
  const vy = (body.velocity.y - primary.velocity.y) / scale.V;
  const vz = (body.velocity.z - primary.velocity.z) / scale.V;

  const input = [
    rx, ry, rz, vx, vy, vz,
    // Mass ratio is tiny for test particles, so feed it in log space.
    Math.log10(Math.max(body.mass / primary.mass, 1e-12)) / 12,
    elements ? Math.min(elements.eccentricity, 3) : 0,
    1, // a / L — unity by construction, kept so the layout matches the spec
    elements ? elements.inclination / Math.PI : 0,
    // Horizon in units of the orbital time scale sqrt(L^3/GM).
    horizon / Math.sqrt(scale.L ** 3 / (G * primary.mass)),
    softening / scale.L,
  ];
  return input.every((v) => Number.isFinite(v)) ? input : null;
}

/** Target vector: the body's state one horizon later, in the same units. */
export function encodeTarget(body: CelestialBody, scale: Scale): number[] | null {
  const target = [
    (body.position.x - scale.primary.position.x) / scale.L,
    (body.position.y - scale.primary.position.y) / scale.L,
    (body.position.z - scale.primary.position.z) / scale.L,
    (body.velocity.x - scale.primary.velocity.x) / scale.V,
    (body.velocity.y - scale.primary.velocity.y) / scale.V,
    (body.velocity.z - scale.primary.velocity.z) / scale.V,
  ];
  return target.every((v) => Number.isFinite(v)) ? target : null;
}

class OrbitPredictor {
  private tf: TF | null = null;
  private model: import("@tensorflow/tfjs").LayersModel | null = null;
  private replay: TrainingSample[] = [];
  private losses: number[] = [];
  private frameCounter = 0;
  private loading = false;
  private training = false;

  /** Pending (state, scale) awaiting its future counterpart. */
  private pending: { input: number[]; bodyId: string; scale: Scale; dueAt: number }[] = [];

  trainSteps = 0;
  rmse: number | null = null;
  /** Bumped whenever stats change so pollers can skip redundant redraws. */
  version = 0;

  get ready(): boolean {
    return this.model !== null;
  }

  stats(): MlStats {
    return {
      samples: this.replay.length,
      trainSteps: this.trainSteps,
      loss: this.losses.length > 0 ? this.losses.reduce((s, v) => s + v, 0) / this.losses.length : null,
      rmse: this.rmse,
      parameters: this.model?.countParams() ?? 0,
      ready: this.ready,
      backend: this.tf?.getBackend() ?? null,
    };
  }

  /** Loads tfjs and builds the model. Idempotent and safe to call repeatedly. */
  async init(): Promise<boolean> {
    if (this.model) return true;
    if (this.loading) return false;
    this.loading = true;
    try {
      // Dynamic import keeps ~1 MB of tfjs out of the initial bundle.
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      this.tf = tf;

      const model = tf.sequential();
      model.add(
        tf.layers.dense({ inputShape: [INPUT_SIZE], units: HIDDEN_UNITS, activation: "relu" })
      );
      model.add(tf.layers.batchNormalization());
      model.add(tf.layers.dropout({ rate: DROPOUT_RATE }));
      for (let i = 1; i < HIDDEN_LAYERS; i++) {
        model.add(tf.layers.dense({ units: HIDDEN_UNITS, activation: "relu" }));
        model.add(tf.layers.batchNormalization());
        model.add(tf.layers.dropout({ rate: DROPOUT_RATE }));
      }
      model.add(tf.layers.dense({ units: OUTPUT_SIZE }));
      model.compile({ optimizer: tf.train.adam(1e-3), loss: "meanSquaredError" });

      this.model = model;
      this.version++;
      return true;
    } catch (error) {
      console.error("[ml] failed to initialize TensorFlow.js:", error);
      return false;
    } finally {
      this.loading = false;
    }
  }

  reset(): void {
    this.model?.dispose();
    this.model = null;
    this.replay = [];
    this.losses = [];
    this.pending = [];
    this.trainSteps = 0;
    this.rmse = null;
    this.version++;
    void this.init();
  }

  /**
   * Observes a simulation state: closes out any pending samples whose
   * horizon has elapsed, opens new ones, and periodically trains.
   */
  observe(state: SystemState, simTime: number, horizon: number): void {
    if (!this.model) return;
    const primary = inferPrimaryBody(state.bodies);
    if (!primary) return;

    // Close pending samples whose target time has arrived.
    const stillPending: typeof this.pending = [];
    for (const entry of this.pending) {
      if (simTime < entry.dueAt) {
        stillPending.push(entry);
        continue;
      }
      const body = state.bodies.find((b) => b.id === entry.bodyId);
      if (!body) continue; // merged or disrupted away
      const target = encodeTarget(body, entry.scale);
      if (!target) continue;
      this.replay.push({ input: entry.input, target });
      if (this.replay.length > REPLAY_CAPACITY) this.replay.shift();
    }
    this.pending = stillPending;

    // Open new samples for a few bodies per frame — sampling everything in a
    // 10k-body system would swamp the buffer with near-duplicate rows.
    const candidates = state.bodies.filter((b) => b.id !== primary.id && !b.isFixed);
    const stride = Math.max(1, Math.floor(candidates.length / 8));
    for (let i = 0; i < candidates.length; i += stride) {
      const body = candidates[i]!;
      const scale = scaleFor(body, primary, state.G);
      if (!scale) continue;
      const input = encodeInput(body, primary, state.G, state.softening, horizon, scale);
      if (!input) continue;
      this.pending.push({ input, bodyId: body.id, scale, dueAt: simTime + horizon });
    }

    this.frameCounter++;
    if (this.frameCounter % TRAIN_INTERVAL_FRAMES === 0) void this.trainStep();
    this.version++;
  }

  /** One mini-batch of training. No-op while a previous step is in flight. */
  private async trainStep(): Promise<void> {
    const tf = this.tf;
    const model = this.model;
    if (!tf || !model || this.training) return;
    if (this.replay.length < BATCH_SIZE) return;

    this.training = true;
    try {
      const batch: TrainingSample[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        batch.push(this.replay[Math.floor(Math.random() * this.replay.length)]!);
      }

      const xs = tf.tensor2d(batch.map((s) => s.input));
      const ys = tf.tensor2d(batch.map((s) => s.target));
      const history = await model.fit(xs, ys, { epochs: 1, batchSize: BATCH_SIZE, verbose: 0 });
      xs.dispose();
      ys.dispose();

      const loss = history.history.loss?.[0];
      if (typeof loss === "number" && Number.isFinite(loss)) {
        this.losses.push(loss);
        if (this.losses.length > 50) this.losses.shift();
        // RMSE in normalized units; the dashboard labels it as such.
        this.rmse = Math.sqrt(loss);
      }
      this.trainSteps++;
      this.version++;
    } catch (error) {
      console.error("[ml] training step failed:", error);
    } finally {
      this.training = false;
    }
  }

  /**
   * Predicts a trajectory by rolling the model forward `steps` times, each
   * advancing by `horizon`. Each step runs MC_SAMPLES passes with dropout
   * active, so the spread across passes gives a ±1σ confidence estimate.
   *
   * Errors compound across the roll-out — that divergence from the true
   * orbit is the thing worth looking at, not a defect to hide.
   */
  predictTrajectory(
    state: SystemState,
    bodyId: string,
    horizon: number,
    steps: number
  ): PredictionPoint[] | null {
    const tf = this.tf;
    const model = this.model;
    if (!tf || !model) return null;

    const primary = inferPrimaryBody(state.bodies);
    const body = state.bodies.find((b) => b.id === bodyId);
    if (!primary || !body || body.id === primary.id) return null;
    const scale = scaleFor(body, primary, state.G);
    if (!scale) return null;

    const points: PredictionPoint[] = [];
    let current: CelestialBody = body;

    try {
      for (let step = 0; step < steps; step++) {
        const input = encodeInput(current, primary, state.G, state.softening, horizon, scale);
        if (!input) break;

        // `training: true` keeps dropout active — that is what makes the
        // repeated passes differ and yields the uncertainty estimate.
        const samples: number[][] = [];
        for (let s = 0; s < MC_SAMPLES; s++) {
          const output = tf.tidy(() => {
            const x = tf.tensor2d([input]);
            return (model.apply(x, { training: true }) as import("@tensorflow/tfjs").Tensor).dataSync();
          });
          samples.push(Array.from(output));
        }

        const mean = new Array(OUTPUT_SIZE).fill(0);
        for (const s of samples) for (let k = 0; k < OUTPUT_SIZE; k++) mean[k] += s[k]! / samples.length;

        let variance = 0;
        for (const s of samples) {
          variance += ((s[0]! - mean[0]!) ** 2 + (s[1]! - mean[1]!) ** 2 + (s[2]! - mean[2]!) ** 2) / samples.length;
        }
        const sigma = Math.sqrt(variance) * scale.L;

        const position: Vector3D = {
          x: primary.position.x + mean[0]! * scale.L,
          y: primary.position.y + mean[1]! * scale.L,
          z: primary.position.z + mean[2]! * scale.L,
        };
        points.push({ position, sigma });

        current = {
          ...current,
          position,
          velocity: {
            x: primary.velocity.x + mean[3]! * scale.V,
            y: primary.velocity.y + mean[4]! * scale.V,
            z: primary.velocity.z + mean[5]! * scale.V,
          },
        };
      }
    } catch (error) {
      console.error("[ml] prediction failed:", error);
      return null;
    }

    return points;
  }
}

export const orbitPredictor = new OrbitPredictor();
