"use client";

import { useEffect } from "react";
import { Code2, Cpu, Pause, Play, Route, RotateCcw, Zap } from "lucide-react";
import { CAMERA_MODES } from "@/lib/camera/camera-modes";
import {
  QUALITY_PRESETS,
  QUALITY_PRESET_LABELS,
  useQualityPreset,
  useQualityStore,
  type QualityPreset,
} from "@/lib/render/quality-preset";
import { requestChaosMap, cancelChaosMap } from "@/hooks/useAnalysisWorker";
import { PRESETS } from "@/lib/presets";
import { useAnalysisStore } from "@/lib/stores/analysis-store";
import { orbitPredictor } from "@/lib/ml/orbit-predictor";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useLocale } from "@/lib/i18n/use-locale";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/translations";

const QUALITY_HINTS: Record<QualityPreset, string> = {
  low: "Flat-shaded spheres, point-sprite starfield, no post-processing. The cheapest path.",
  medium: "PBR surfaces with cloud shells, instanced rock debris, selective bloom.",
  cinematic:
    "Adds atmospheric scattering, a raymarched accretion disk, dynamic shadows, depth of field, god rays and lens flare.",
};

/**
 * Rendering fidelity. The auto-scaler can hold the effective preset below the
 * requested one under sustained frame-rate pressure, which is surfaced here
 * rather than silently overriding the button the user just pressed.
 */
function QualityPresetPicker() {
  const requested = useQualityStore((s) => s.requested);
  const setPreset = useQualityStore((s) => s.setPreset);
  const hydrate = useQualityStore((s) => s.hydrate);
  const features = useQualityPreset();

  // Deferred to an effect so the server render and the first client render
  // agree; reading localStorage during render would break hydration.
  useEffect(hydrate, [hydrate]);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" role="group" aria-label="Rendering quality preset">
        {QUALITY_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setPreset(preset)}
            title={QUALITY_HINTS[preset]}
            aria-pressed={requested === preset}
            className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${
              requested === preset
                ? "bg-zinc-700 text-zinc-100"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {QUALITY_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
      {features.throttled && (
        <p className="text-[10px] leading-tight text-amber-400/80">
          Rendering at {QUALITY_PRESET_LABELS[features.preset]} — the frame-budget scaler
          is holding fidelity down. Raise it from the performance overlay.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onChange}
      className={`h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-sky-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function ControlSidebar() {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const togglePlay = useSimulationStore((s) => s.togglePlay);
  const loadPreset = useSimulationStore((s) => s.loadPreset);
  const presetId = useSimulationStore((s) => s.presetId);

  const system = useSimulationStore((s) => s.system);
  const setTimeStep = useSimulationStore((s) => s.setTimeStep);
  const setG = useSimulationStore((s) => s.setG);
  const setSoftening = useSimulationStore((s) => s.setSoftening);

  const stepsPerFrame = useSimulationStore((s) => s.stepsPerFrame);
  const setStepsPerFrame = useSimulationStore((s) => s.setStepsPerFrame);
  const useOctree = useSimulationStore((s) => s.useOctree);
  const setUseOctree = useSimulationStore((s) => s.setUseOctree);
  const theta = useSimulationStore((s) => s.theta);
  const setTheta = useSimulationStore((s) => s.setTheta);
  const adaptiveTimestep = useSimulationStore((s) => s.adaptiveTimestep);
  const setAdaptiveTimestep = useSimulationStore((s) => s.setAdaptiveTimestep);
  const enableTidalDisruption = useSimulationStore((s) => s.enableTidalDisruption);
  const setEnableTidalDisruption = useSimulationStore((s) => s.setEnableTidalDisruption);

  const showTrails = useSimulationStore((s) => s.showTrails);
  const toggleShowTrails = useSimulationStore((s) => s.toggleShowTrails);
  const showVelocityArrows = useSimulationStore((s) => s.showVelocityArrows);
  const toggleShowVelocityArrows = useSimulationStore((s) => s.toggleShowVelocityArrows);
  const showOrbitEllipses = useSimulationStore((s) => s.showOrbitEllipses);
  const toggleShowOrbitEllipses = useSimulationStore((s) => s.toggleShowOrbitEllipses);
  const showLagrangePoints = useSimulationStore((s) => s.showLagrangePoints);
  const toggleShowLagrangePoints = useSimulationStore((s) => s.toggleShowLagrangePoints);
  const showFormulaOverlay = useSimulationStore((s) => s.showFormulaOverlay);
  const toggleShowFormulaOverlay = useSimulationStore((s) => s.toggleShowFormulaOverlay);
  const showSpacetimeGrid = useSimulationStore((s) => s.showSpacetimeGrid);
  const toggleShowSpacetimeGrid = useSimulationStore((s) => s.toggleShowSpacetimeGrid);
  const showHillSpheres = useSimulationStore((s) => s.showHillSpheres);
  const toggleShowHillSpheres = useSimulationStore((s) => s.toggleShowHillSpheres);
  const showRocheLimits = useSimulationStore((s) => s.showRocheLimits);
  const toggleShowRocheLimits = useSimulationStore((s) => s.toggleShowRocheLimits);
  const showPhaseSpace = useSimulationStore((s) => s.showPhaseSpace);
  const toggleShowPhaseSpace = useSimulationStore((s) => s.toggleShowPhaseSpace);

  const showResonances = useSimulationStore((s) => s.showResonances);
  const toggleShowResonances = useSimulationStore((s) => s.toggleShowResonances);
  const showChaosMap = useSimulationStore((s) => s.showChaosMap);
  const toggleShowChaosMap = useSimulationStore((s) => s.toggleShowChaosMap);
  const showGwStrain = useSimulationStore((s) => s.showGwStrain);
  const toggleShowGwStrain = useSimulationStore((s) => s.toggleShowGwStrain);
  const showLensing = useSimulationStore((s) => s.showLensing);
  const toggleShowLensing = useSimulationStore((s) => s.toggleShowLensing);
  const showMlPredictions = useSimulationStore((s) => s.showMlPredictions);
  const toggleShowMlPredictions = useSimulationStore((s) => s.toggleShowMlPredictions);

  const computeBackend = useSimulationStore((s) => s.computeBackend);
  const setComputeBackend = useSimulationStore((s) => s.setComputeBackend);
  const activeBackend = useSimulationStore((s) => s.activeBackend);
  const gpuAdapterLabel = useSimulationStore((s) => s.gpuAdapterLabel);
  const gpuMaxBodies = useSimulationStore((s) => s.gpuMaxBodies);
  const bodyCount = useSimulationStore((s) => s.system.bodies.length);
  const setScriptEditorOpen = useSimulationStore((s) => s.setScriptEditorOpen);
  const chaosMap = useAnalysisStore((s) => s.chaosMap);

  const { locale, setLocale, t } = useLocale();
  const colorBlindMode = useA11yStore((s) => s.colorBlindMode);
  const toggleColorBlindMode = useA11yStore((s) => s.toggleColorBlindMode);
  const reducedMotion = useA11yStore((s) => s.reducedMotion);
  const highContrast = useA11yStore((s) => s.highContrast);

  const cameraMode = useSimulationStore((s) => s.cameraMode);
  const setCameraMode = useSimulationStore((s) => s.setCameraMode);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const visualRadiusScale = useSimulationStore((s) => s.visualRadiusScale);
  const setVisualRadiusScale = useSimulationStore((s) => s.setVisualRadiusScale);
  const setTransferPlannerOpen = useSimulationStore((s) => s.setTransferPlannerOpen);

  const enableGR = useSimulationStore((s) => s.enableGR);
  const toggleEnableGR = useSimulationStore((s) => s.toggleEnableGR);
  const speedOfLight = useSimulationStore((s) => s.speedOfLight);
  const setSpeedOfLight = useSimulationStore((s) => s.setSpeedOfLight);

  const clearHistory = useTimelineStore((s) => s.clearHistory);

  const handlePresetChange = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      loadPreset(preset);
      clearHistory();
    }
  };

  const handleReset = () => {
    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
    if (preset) {
      loadPreset(preset);
      clearHistory();
    }
  };

  return (
    <div className="flex h-full w-72 flex-col gap-4 overflow-y-auto border-r border-zinc-800 bg-zinc-950/90 p-4 text-zinc-100">
      <div className="flex items-center gap-2.5">
        <img
          src="/textures/logo.png"
          alt="N-Body Lab Logo"
          className="h-8 w-8 object-contain shrink-0 drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]"
        />
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-zinc-100">
            {t("app.title")}
          </h1>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t("app.subtitle")}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isRunning ? t("control.pause") : t("control.play")}
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-sky-600 py-2 text-sm font-medium hover:bg-sky-500"
        >
          {isRunning ? <Pause size={16} /> : <Play size={16} />}
          {isRunning ? t("control.pause") : t("control.play")}
        </button>
        <button
          type="button"
          onClick={handleReset}
          title={t("control.resetTitle")}
          aria-label={t("control.reset")}
          className="flex items-center justify-center rounded-md bg-zinc-800 px-3 hover:bg-zinc-700"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div>
        <label htmlFor="preset-picker" className="mb-1 block text-xs text-zinc-400">{t("control.preset")}</label>
        <select
          id="preset-picker"
          value={presetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
        >
          {/* Placeholder for states that came from a generator, script,
              share link or snapshot rather than a preset. */}
          {!PRESETS.some((p) => p.id === presetId) && (
            <option value={presetId}>Custom scenario</option>
          )}
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-zinc-500">
          {PRESETS.find((p) => p.id === presetId)?.description ??
            "Custom scenario — generated, scripted, or restored from a link or snapshot."}
        </p>
      </div>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Simulation
        </h2>
        <Row label={`Timestep: ${system.timeStep.toFixed(4)}`}>
          <input
            type="range"
            min={0.0005}
            max={0.05}
            step={0.0005}
            value={system.timeStep}
            onChange={(e) => setTimeStep(Number(e.target.value))}
            className="w-32"
          />
        </Row>
        <Row label={`G: ${system.G.toFixed(2)}`}>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={system.G}
            onChange={(e) => setG(Number(e.target.value))}
            className="w-32"
          />
        </Row>
        <Row label={`Softening: ${system.softening.toFixed(3)}`}>
          <input
            type="range"
            min={0.001}
            max={0.5}
            step={0.001}
            value={system.softening}
            onChange={(e) => setSoftening(Number(e.target.value))}
            className="w-32"
          />
        </Row>
        <Row label={`Steps/frame: ${stepsPerFrame}`}>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={stepsPerFrame}
            onChange={(e) => setStepsPerFrame(Number(e.target.value))}
            className="w-32"
          />
        </Row>
        <Row label="Use Barnes-Hut octree">
          <Toggle checked={useOctree} onChange={() => setUseOctree(!useOctree)} />
        </Row>
        {useOctree && (
          <Row label={`Theta (θ): ${theta.toFixed(2)}`}>
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.05}
              value={theta}
              onChange={(e) => setTheta(Number(e.target.value))}
              className="w-32"
            />
          </Row>
        )}
        <Row label="Adaptive timestep">
          <Toggle
            checked={adaptiveTimestep}
            onChange={() => setAdaptiveTimestep(!adaptiveTimestep)}
            title="Automatically halves the timestep when energy drift is high (e.g. close encounters) and doubles it back when the system is calm."
          />
        </Row>
        <Row label="Tidal disruption">
          <Toggle
            checked={enableTidalDisruption}
            onChange={() => setEnableTidalDisruption(!enableTidalDisruption)}
            title="Shreds a body into a fragment stream when it crosses a much heavier body's Roche limit and the tidal field beats its own self-gravity."
          />
        </Row>
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Graphics
        </h2>
        <QualityPresetPicker />
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Visualization
        </h2>
        <Row label="Trails">
          <Toggle checked={showTrails} onChange={toggleShowTrails} />
        </Row>
        <Row label="Velocity arrows">
          <Toggle checked={showVelocityArrows} onChange={toggleShowVelocityArrows} />
        </Row>
        <Row label="Show Predicted Orbits">
          <Toggle checked={showOrbitEllipses} onChange={toggleShowOrbitEllipses} />
        </Row>
        <Row label="Show Lagrange Points">
          <Toggle checked={showLagrangePoints} onChange={toggleShowLagrangePoints} />
        </Row>
        <Row label="Formula overlay">
          <Toggle checked={showFormulaOverlay} onChange={toggleShowFormulaOverlay} />
        </Row>
        <Row label="Show Spacetime Grid">
          <Toggle
            checked={showSpacetimeGrid}
            onChange={toggleShowSpacetimeGrid}
            title="Deformable 'rubber sheet' showing the gravitational potential. GPU-heavy — resolution auto-degrades below 45 FPS."
          />
        </Row>
        <Row label="Show Hill Spheres">
          <Toggle
            checked={showHillSpheres}
            onChange={toggleShowHillSpheres}
            title="Each body's gravitational sphere of influence relative to the primary."
          />
        </Row>
        <Row label="Show Roche Limits">
          <Toggle
            checked={showRocheLimits}
            onChange={toggleShowRocheLimits}
            title="Red ring at the tidal-disruption distance around massive bodies."
          />
        </Row>
        <Row label="Show Phase Space">
          <Toggle
            checked={showPhaseSpace}
            onChange={toggleShowPhaseSpace}
            title="Real-time Poincaré section and (r, ṙ) phase trajectory panel."
          />
        </Row>
        <Row label="Show Resonances">
          <Toggle
            checked={showResonances}
            onChange={toggleShowResonances}
            title="Arcs between bodies in mean-motion resonance, plus a Kirkwood-gap histogram."
          />
        </Row>
        <Row label="Show GW Strain">
          <Toggle
            checked={showGwStrain}
            onChange={toggleShowGwStrain}
            title="Quadrupole gravitational-wave strain plot and expanding wavefronts. Needs a close, comparable-mass binary."
          />
        </Row>
        <Row label="ML Trajectory Preview">
          <Toggle
            checked={showMlPredictions}
            onChange={() => {
              // Loads TensorFlow.js on first enable (dynamic import).
              if (!showMlPredictions) void orbitPredictor.init();
              toggleShowMlPredictions();
            }}
            title="Trains a small MLP online and draws its predicted trajectory beside the Keplerian one. Loads TensorFlow.js (~1 MB) on first use."
          />
        </Row>
        <Row label="Lensing (black holes)">
          <Toggle
            checked={showLensing}
            onChange={toggleShowLensing}
            title="Screen-space light deflection around black holes. Post-processing pass; disable if it costs too much."
          />
        </Row>
        <Row label={`Radius scale: ${visualRadiusScale.toFixed(0)}x`}>
          <input
            type="range"
            min={1}
            max={3000}
            step={1}
            value={visualRadiusScale}
            onChange={(e) => setVisualRadiusScale(Number(e.target.value))}
            className="w-32"
            title="Visual exaggeration of body radii (1x = true scale). Physics is unaffected."
          />
        </Row>
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Compute Backend
        </h2>
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              ["cpu-worker", "CPU Worker", Cpu, "RK4 + Barnes-Hut octree in a Web Worker."],
              [
                "gpu-webgpu",
                "WebGPU",
                Zap,
                "Leapfrog direct summation in a WGSL compute shader — for very large N.",
              ],
            ] as const
          ).map(([id, label, Icon, hint]) => {
            const unavailable = id === "gpu-webgpu" && gpuAdapterLabel === null;
            return (
              <button
                key={id}
                onClick={() => setComputeBackend(id)}
                disabled={unavailable}
                title={unavailable ? "WebGPU unavailable in this browser/device" : hint}
                className={`flex items-center justify-center gap-1.5 rounded-md border px-1.5 py-1.5 text-[10px] transition-colors ${
                  computeBackend === id
                    ? "border-sky-500 bg-sky-950/60 text-sky-200"
                    : unavailable
                      ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                <Icon size={11} />
                {label}
              </button>
            );
          })}
        </div>
        <div className="rounded bg-zinc-900/70 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-zinc-400">
          <div className="flex justify-between">
            <span className="text-zinc-500">running</span>
            <span className={activeBackend === "gpu-webgpu" ? "text-emerald-300" : "text-sky-300"}>
              {activeBackend === "gpu-webgpu" ? "GPU (WebGPU)" : "CPU worker"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">device</span>
            <span className="truncate pl-2" title={gpuAdapterLabel ?? undefined}>
              {gpuAdapterLabel ?? "no WebGPU"}
            </span>
          </div>
          {gpuMaxBodies !== null && (
            <div className="flex justify-between">
              <span className="text-zinc-500">GPU cap</span>
              <span>{gpuMaxBodies.toLocaleString()} bodies</span>
            </div>
          )}
          <div className="mt-0.5 text-zinc-600">
            auto-switches to GPU above 500 bodies (now {bodyCount})
          </div>
        </div>
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Chaos Analysis
        </h2>
        <Row label="Show Chaos Map">
          <Toggle
            checked={showChaosMap}
            onChange={toggleShowChaosMap}
            title="Heatmap of Lyapunov exponents over test-particle launch conditions (radius × speed). Computed progressively in a background worker."
          />
        </Row>
        {showChaosMap && (
          <div className="space-y-1">
            <div className="flex gap-1">
              <button
                onClick={() => requestChaosMap()}
                className="flex-1 rounded bg-zinc-800 py-1 text-[10px] hover:bg-zinc-700"
              >
                {chaosMap ? "Recompute" : "Compute map"}
              </button>
              {chaosMap?.running && (
                <button
                  onClick={cancelChaosMap}
                  className="rounded bg-red-900/60 px-2 py-1 text-[10px] text-red-200 hover:bg-red-800/70"
                >
                  Stop
                </button>
              )}
            </div>
            {chaosMap && (
              <div className="font-mono text-[9px] text-zinc-500">
                {chaosMap.running
                  ? `sweeping… row ${chaosMap.rowsDone}/${chaosMap.gridSize}`
                  : `done · ${chaosMap.gridSize}×${chaosMap.gridSize} samples`}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Camera</h2>
        <div className="grid grid-cols-3 gap-1">
          {CAMERA_MODES.map((mode) => {
            const disabled = mode.needsSelection && !selectedBodyId;
            return (
              <button
                key={mode.id}
                onClick={() => setCameraMode(mode.id)}
                disabled={disabled}
                title={mode.description + (disabled ? " (select a body first)" : "")}
                className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[9px] leading-tight transition-colors ${
                  cameraMode === mode.id
                    ? "border-sky-500 bg-sky-950/60 text-sky-200"
                    : disabled
                      ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                <span className="text-sm leading-none">{mode.glyph}</span>
                {mode.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Mission Planning
        </h2>
        <button
          onClick={() => setTransferPlannerOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-900/70 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-800/80"
        >
          <Route size={14} />
          Plan Transfer
        </button>
        <button
          onClick={() => setScriptEditorOpen(true)}
          title="Write JavaScript to build a custom scenario (sandboxed worker, 5s budget)"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-violet-900/70 py-2 text-xs font-medium text-violet-100 hover:bg-violet-800/80"
        >
          <Code2 size={14} />
          Scenario Script
        </button>
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          General Relativity
        </h2>
        <Row label="Enable GR Precession">
          <Toggle
            checked={enableGR}
            onChange={toggleEnableGR}
            title="Adds the leading-order post-Newtonian (Schwarzschild) correction to gravity — the same effect that causes Mercury's perihelion to slowly advance. Forces direct O(N²) summation while enabled."
          />
        </Row>
        {enableGR && (
          <Row label={`Speed of light: ${speedOfLight.toFixed(0)}`}>
            <input
              type="range"
              min={20}
              max={2000}
              step={10}
              value={speedOfLight}
              onChange={(e) => setSpeedOfLight(Number(e.target.value))}
              className="w-32"
            />
          </Row>
        )}
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {t("section.accessibility")}
        </h2>
        <label
          htmlFor="locale-picker"
          className="flex items-center justify-between gap-2 text-xs text-zinc-300"
        >
          <span className="text-zinc-400">{t("a11y.language")}</span>
          <select
            id="locale-picker"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px]"
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <Row label={t("a11y.colorBlindMode")}>
          <Toggle
            checked={colorBlindMode}
            onChange={toggleColorBlindMode}
            title="Remaps body colors to the Okabe-Ito palette, which stays distinguishable under all common forms of color vision deficiency."
          />
        </Row>
        {(reducedMotion || highContrast) && (
          <p className="text-[10px] leading-relaxed text-emerald-400">
            {reducedMotion && t("a11y.reducedMotion")}
            {reducedMotion && highContrast && " · "}
            {highContrast && t("a11y.highContrast")}
          </p>
        )}
      </section>

      <p className="mt-auto text-[10px] leading-relaxed text-zinc-600">
        Hold <kbd className="rounded bg-zinc-800 px-1">Shift</kbd> and drag on the scene to
        launch a new body (slingshot mechanic).
      </p>
    </div>
  );
}
