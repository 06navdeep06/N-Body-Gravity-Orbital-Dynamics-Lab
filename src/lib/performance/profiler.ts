/**
 * Frame-budget profiler and automatic quality scaling.
 *
 * Timing uses the User Timing API (`performance.mark`/`measure`) so the same
 * spans also show up in DevTools' Performance panel — the profiler and the
 * browser's own tooling agree rather than telling two stories.
 *
 * A module-level singleton, deliberately: it's read from the render loop
 * every frame, and routing that through React state would cost more than the
 * thing being measured.
 */

export type PhaseName = "physics" | "render" | "ui";

export interface FrameBudget {
  physics: number;
  render: number;
  ui: number;
  /** Frame time not attributed to any measured phase. */
  idle: number;
  total: number;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  programs: number;
}

/** Quality tiers the auto-scaler steps through. */
export type QualityTier = "high" | "medium" | "low";

const FPS_WINDOW = 60;
/** Below this FPS for DEGRADE_SECONDS, drop a tier. */
const DEGRADE_FPS = 40;
const CRITICAL_FPS = 20;
const DEGRADE_SECONDS = 3;
const CRITICAL_SECONDS = 5;
/** Above this FPS for RECOVER_SECONDS, climb a tier. */
const RECOVER_FPS = 55;
const RECOVER_SECONDS = 10;

const HEAP_WARN_BYTES = 500 * 1024 * 1024;

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
}

class Profiler {
  private frameTimes: number[] = [];
  private phaseTotals: Record<PhaseName, number> = { physics: 0, render: 0, ui: 0 };
  private lastFrameStart = 0;

  budget: FrameBudget = { physics: 0, render: 0, ui: 0, idle: 0, total: 0 };
  renderStats: RenderStats = { drawCalls: 0, triangles: 0, programs: 0 };
  heapBytes = 0;
  heapWarned = false;

  quality: QualityTier = "high";
  /** Set when the scaler changes tier, for the UI to surface. */
  lastQualityChange: { tier: QualityTier; reason: string; at: number } | null = null;

  private lowFpsSince: number | null = null;
  private criticalFpsSince: number | null = null;
  private goodFpsSince: number | null = null;
  /** Bumped on every frame so pollers know there's new data. */
  version = 0;

  /** Marks the start of a measured phase. */
  begin(phase: PhaseName): void {
    if (typeof performance === "undefined") return;
    performance.mark(`${phase}-start`);
  }

  /** Closes a phase and folds its duration into this frame's budget. */
  end(phase: PhaseName): void {
    if (typeof performance === "undefined") return;
    try {
      performance.mark(`${phase}-end`);
      const measure = performance.measure(phase, `${phase}-start`, `${phase}-end`);
      this.phaseTotals[phase] += measure.duration;
      // Entries accumulate without bound otherwise.
      performance.clearMarks(`${phase}-start`);
      performance.clearMarks(`${phase}-end`);
      performance.clearMeasures(phase);
    } catch {
      // A missing start mark (phase never opened) — ignore rather than throw
      // from inside the render loop.
    }
  }

  /** Called once per rendered frame. Returns the rolling-average FPS. */
  frame(now: number): number {
    const delta = this.lastFrameStart === 0 ? 0 : now - this.lastFrameStart;
    this.lastFrameStart = now;

    if (delta > 0) {
      this.frameTimes.push(delta);
      if (this.frameTimes.length > FPS_WINDOW) this.frameTimes.shift();
    }

    const meanFrame =
      this.frameTimes.length > 0
        ? this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length
        : 0;
    const fps = meanFrame > 0 ? 1000 / meanFrame : 0;

    const measured = this.phaseTotals.physics + this.phaseTotals.render + this.phaseTotals.ui;
    this.budget = {
      physics: this.phaseTotals.physics,
      render: this.phaseTotals.render,
      ui: this.phaseTotals.ui,
      idle: Math.max(0, delta - measured),
      total: delta,
    };
    this.phaseTotals = { physics: 0, render: 0, ui: 0 };

    this.sampleMemory();
    this.updateQuality(fps, now);
    this.version++;
    return fps;
  }

  private sampleMemory(): void {
    const perf = typeof performance !== "undefined" ? (performance as PerformanceWithMemory) : null;
    // Chrome-only; absent elsewhere, which is why the overlay labels it as
    // unavailable rather than showing a misleading zero.
    if (!perf?.memory) return;
    this.heapBytes = perf.memory.usedJSHeapSize;
    if (this.heapBytes > HEAP_WARN_BYTES && !this.heapWarned) {
      this.heapWarned = true;
      console.warn(
        `[profiler] JS heap above ${(HEAP_WARN_BYTES / 1024 / 1024).toFixed(0)} MB ` +
          `(${(this.heapBytes / 1024 / 1024).toFixed(0)} MB) — consider reducing body count or trail length.`
      );
    } else if (this.heapBytes < HEAP_WARN_BYTES * 0.8) {
      this.heapWarned = false;
    }
  }

  /**
   * Steps the quality tier down when FPS stays low, and back up once it has
   * recovered for long enough. Hysteresis is deliberate: the recover
   * threshold (55) sits well above the degrade threshold (40) and needs a
   * much longer sustained window, so the scaler can't oscillate.
   */
  private updateQuality(fps: number, now: number): void {
    if (fps <= 0) return;
    const seconds = (since: number) => (now - since) / 1000;

    if (fps < CRITICAL_FPS) {
      this.criticalFpsSince ??= now;
      if (seconds(this.criticalFpsSince) > CRITICAL_SECONDS && this.quality !== "low") {
        this.setQuality("low", `FPS below ${CRITICAL_FPS} for ${CRITICAL_SECONDS}s`, now);
      }
    } else {
      this.criticalFpsSince = null;
    }

    if (fps < DEGRADE_FPS) {
      this.lowFpsSince ??= now;
      this.goodFpsSince = null;
      if (seconds(this.lowFpsSince) > DEGRADE_SECONDS && this.quality === "high") {
        this.setQuality("medium", `FPS below ${DEGRADE_FPS} for ${DEGRADE_SECONDS}s`, now);
      }
    } else {
      this.lowFpsSince = null;
    }

    if (fps > RECOVER_FPS) {
      this.goodFpsSince ??= now;
      if (seconds(this.goodFpsSince) > RECOVER_SECONDS && this.quality !== "high") {
        const next: QualityTier = this.quality === "low" ? "medium" : "high";
        this.setQuality(next, `FPS above ${RECOVER_FPS} for ${RECOVER_SECONDS}s`, now);
      }
    }
  }

  private setQuality(tier: QualityTier, reason: string, now: number): void {
    this.quality = tier;
    this.lastQualityChange = { tier, reason, at: now };
    // Reset the timers so the next transition needs a fresh sustained window.
    this.lowFpsSince = null;
    this.criticalFpsSince = null;
    this.goodFpsSince = null;
    console.warn(`[profiler] quality → ${tier} (${reason})`);
  }

  /** Forces a tier, e.g. from a user override. */
  forceQuality(tier: QualityTier): void {
    this.setQuality(tier, "manual override", typeof performance !== "undefined" ? performance.now() : 0);
  }

  reset(): void {
    this.frameTimes = [];
    this.phaseTotals = { physics: 0, render: 0, ui: 0 };
    this.lowFpsSince = null;
    this.criticalFpsSince = null;
    this.goodFpsSince = null;
  }
}

export const profiler = new Profiler();

/** Rendering budgets implied by each quality tier. */
export interface QualitySettings {
  trailLengthFactor: number;
  particleEffects: boolean;
  postProcessing: boolean;
  spacetimeGridSegments: number;
  sphereSegments: number;
}

export const QUALITY_SETTINGS: Record<QualityTier, QualitySettings> = {
  high: {
    trailLengthFactor: 1,
    particleEffects: true,
    postProcessing: true,
    spacetimeGridSegments: 128,
    sphereSegments: 24,
  },
  medium: {
    // First response to sustained sub-40 FPS: halve trails, drop particles.
    trailLengthFactor: 0.5,
    particleEffects: false,
    postProcessing: true,
    spacetimeGridSegments: 64,
    sphereSegments: 16,
  },
  low: {
    // Below 20 FPS: also drop post-processing and sphere tessellation.
    trailLengthFactor: 0.25,
    particleEffects: false,
    postProcessing: false,
    spacetimeGridSegments: 32,
    sphereSegments: 10,
  },
};

export function currentQualitySettings(): QualitySettings {
  return QUALITY_SETTINGS[profiler.quality];
}
