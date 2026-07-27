"use client";

import { useEffect, useState } from "react";
import { BarChart3, Globe2, PanelRightOpen, SlidersHorizontal, X } from "lucide-react";
import { BodyInspector } from "@/components/ui/BodyInspector";
import { BodyLauncher } from "@/components/ui/BodyLauncher";
import { ControlSidebar } from "@/components/ui/ControlSidebar";
import { EnergyDashboard } from "@/components/ui/EnergyDashboard";
import { EnterVrButton } from "@/components/ui/EnterVrButton";
import { ExportMenu } from "@/components/ui/ExportMenu";
import { FormulaOverlay } from "@/components/ui/FormulaOverlay";
import { GWStrainPlot } from "@/components/ui/GWStrainPlot";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { OnboardingTour } from "@/components/ui/OnboardingTour";
import { PhaseSpaceDiagram } from "@/components/ui/PhaseSpaceDiagram";
import { ResonancePanel } from "@/components/ui/ResonancePanel";
import { ScriptEditor } from "@/components/ui/ScriptEditor";
import { ShortcutsCheatsheet } from "@/components/ui/ShortcutsCheatsheet";
import { TimelineBar } from "@/components/ui/TimelineBar";
import { TransferPlanner } from "@/components/ui/TransferPlanner";
import { DisruptionToasts } from "@/components/ui/DisruptionToasts";
import { AnalyticsDashboard } from "@/components/ui/AnalyticsDashboard";
import { ProceduralPanel } from "@/components/ui/ProceduralPanel";
import { PerformanceOverlay } from "@/components/ui/PerformanceOverlay";
import { MLDashboard } from "@/components/ui/MLDashboard";
import { Bodies } from "@/components/scene/Bodies";
import { PhotorealisticBodies } from "@/components/scene/PhotorealisticBodies";
import { InstancedDebris } from "@/components/scene/InstancedDebris";
import { BlackHole } from "@/components/scene/BlackHole";
import { ChaosHeatmap } from "@/components/scene/ChaosHeatmap";
import { CollisionBursts } from "@/components/scene/CollisionBursts";
import { GWRipple } from "@/components/scene/GWRipple";
import { HillSphere } from "@/components/scene/HillSphere";
import { LagrangeMarkers } from "@/components/scene/LagrangeMarkers";
import { LaunchPreview } from "@/components/scene/LaunchPreview";
import { OrbitEllipse } from "@/components/scene/OrbitEllipse";
import { ResonanceWeb } from "@/components/scene/ResonanceWeb";
import { RocheLimit } from "@/components/scene/RocheLimit";
import { Scene } from "@/components/scene/Scene";
import { SpacetimeGrid } from "@/components/scene/SpacetimeGrid";
import { StarEffects } from "@/components/scene/StarEffects";
import { Trails } from "@/components/scene/Trails";
import { TransferArc } from "@/components/scene/TransferArc";
import { TidalStream } from "@/components/scene/TidalStream";
import { RenderStatsProbe } from "@/components/scene/RenderStatsProbe";
import { MLTrajectory } from "@/components/scene/MLTrajectory";
import { VelocityArrows } from "@/components/scene/VelocityArrows";
import { useAnalysisWorker } from "@/hooks/useAnalysisWorker";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { usePhysicsWorker } from "@/hooks/usePhysicsWorker";
import { PRESETS } from "@/lib/presets";
import { readStateFromURL } from "@/lib/utils/share";
import { useSimulationStore } from "@/lib/stores/simulation-store";

/** Which side panel is showing on small screens; both are docked at `lg`. */
type Drawer = "controls" | "inspector" | null;

/** Chrome button — 44px minimum touch target, per WCAG 2.5.8. */
const CHROME_BUTTON =
  "pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-md bg-zinc-900/90 px-3 text-xs font-medium text-zinc-100 shadow-lg ring-1 ring-zinc-700 hover:bg-zinc-800 active:bg-zinc-700";

export default function Home() {
  usePhysicsWorker();
  useAnalysisWorker();
  useKeyboardShortcuts();

  const [drawer, setDrawer] = useState<Drawer>(null);

  // Tapping a body in the viewport is the mobile equivalent of clicking it,
  // but the inspector it fills is off-canvas there — so selecting a body
  // opens it. Driven by a store subscription rather than an effect that reads
  // the selection: this reacts to the *event* of a new selection, and must not
  // re-open the drawer just because something else re-rendered.
  useEffect(
    () =>
      useSimulationStore.subscribe((state, previous) => {
        if (state.selectedBodyId && state.selectedBodyId !== previous.selectedBodyId) {
          setDrawer((current) => (current === "controls" ? current : "inspector"));
        }
      }),
    []
  );

  useEffect(() => {
    const store = useSimulationStore.getState();
    if (store.system.bodies.length > 0) return;

    // A shared ?state= link takes priority over the default preset.
    const shared = readStateFromURL();
    if (shared) {
      store.setSystem(shared);
      return;
    }
    if (PRESETS[0]) store.loadPreset(PRESETS[0]);
  }, []);

  return (
    // 100dvh, not 100vh: on mobile browsers 100vh is the *expanded* viewport,
    // so the bottom timeline bar sits underneath the URL bar and is unusable.
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-black text-white">
      {/* Backdrop for the off-canvas drawers. Absent at lg, where both panels
          are docked and there is nothing to dismiss. */}
      {drawer && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => setDrawer(null)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        aria-label="Simulation controls"
        className={`z-40 h-full shrink-0 transition-transform duration-200 ease-out max-lg:fixed max-lg:inset-y-0 max-lg:left-0 ${
          drawer === "controls" ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
        }`}
      >
        <ControlSidebar />
        <button
          type="button"
          onClick={() => setDrawer(null)}
          aria-label="Close controls"
          className="absolute right-2 top-2 rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
        >
          <X size={18} />
        </button>
      </aside>

      <div className="relative flex-1">
        <Scene>
          {/* The three body renderers partition the body list between them —
              see lib/render/body-roles. */}
          <Bodies />
          <PhotorealisticBodies />
          <InstancedDebris />
          <Trails />
          <VelocityArrows />
          <OrbitEllipse />
          <LagrangeMarkers />
          <LaunchPreview />
          <SpacetimeGrid />
          <HillSphere />
          <RocheLimit />
          <TransferArc />
          <CollisionBursts />
          <StarEffects />
          <ResonanceWeb />
          <ChaosHeatmap />
          <BlackHole />
          <GWRipple />
          <TidalStream />
          <RenderStatsProbe />
          <MLTrajectory />
        </Scene>

        {/* Top chrome. One wrapping row so it degrades gracefully from a
            desktop toolbar to a pair of icon clusters on a phone; the right
            group clears the energy dashboard only once that is on screen. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={() => setDrawer("controls")}
              aria-label="Open simulation controls"
              className={`${CHROME_BUTTON} min-w-11 justify-center lg:hidden`}
            >
              <SlidersHorizontal size={16} />
            </button>
            <BodyLauncher />
          </div>

          <div className="pointer-events-auto flex items-center gap-2 lg:mr-[17rem]">
            <button
              onClick={() => useSimulationStore.getState().setProceduralPanelOpen(true)}
              title="Generate a procedural galaxy or star system"
              className={`${CHROME_BUTTON} max-sm:min-w-11 max-sm:justify-center max-sm:px-0`}
            >
              <Globe2 size={16} />
              <span className="max-sm:sr-only">Generate</span>
            </button>
            <button
              onClick={() => useSimulationStore.getState().setAnalyticsOpen(true)}
              title="Open the analytics dashboard"
              className={`${CHROME_BUTTON} max-sm:min-w-11 max-sm:justify-center max-sm:px-0`}
            >
              <BarChart3 size={16} />
              <span className="max-sm:sr-only">Analytics</span>
            </button>
            <EnterVrButton />
            <ExportMenu />
            <button
              onClick={() => setDrawer("inspector")}
              aria-label="Open body inspector"
              className={`${CHROME_BUTTON} min-w-11 justify-center lg:hidden`}
            >
              <PanelRightOpen size={16} />
            </button>
          </div>
        </div>

        <EnergyDashboard />
        <FormulaOverlay />
        <PhaseSpaceDiagram />
        <ResonancePanel />
        <GWStrainPlot />
        <TransferPlanner />
        <TimelineBar />
        <DisruptionToasts />
        <ScriptEditor />
        <ProceduralPanel />
        <AnalyticsDashboard />
        <PerformanceOverlay />
        <MLDashboard />
        <ShortcutsCheatsheet />
        <OnboardingTour />
        <LoadingOverlay />
      </div>

      <aside
        aria-label="Body inspector"
        className={`z-40 h-full shrink-0 transition-transform duration-200 ease-out max-lg:fixed max-lg:inset-y-0 max-lg:right-0 ${
          drawer === "inspector" ? "max-lg:translate-x-0" : "max-lg:translate-x-full"
        }`}
      >
        <BodyInspector />
        <button
          type="button"
          onClick={() => setDrawer(null)}
          aria-label="Close inspector"
          className="absolute right-2 top-2 rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
        >
          <X size={18} />
        </button>
      </aside>
    </div>
  );
}
