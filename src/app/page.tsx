"use client";

import { useEffect } from "react";
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
import { Bodies } from "@/components/scene/Bodies";
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
import { VelocityArrows } from "@/components/scene/VelocityArrows";
import { useAnalysisWorker } from "@/hooks/useAnalysisWorker";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { usePhysicsWorker } from "@/hooks/usePhysicsWorker";
import { PRESETS } from "@/lib/presets";
import { readStateFromURL } from "@/lib/utils/share";
import { useSimulationStore } from "@/lib/stores/simulation-store";

export default function Home() {
  usePhysicsWorker();
  useAnalysisWorker();
  useKeyboardShortcuts();

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
    <div className="flex h-screen w-screen overflow-hidden bg-black text-white">
      <ControlSidebar />

      <div className="relative flex-1">
        <Scene>
          <Bodies />
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
        </Scene>

        <div className="absolute left-4 top-4 z-10">
          <BodyLauncher />
        </div>
        <div className="absolute right-72 top-4 z-10 flex items-center gap-2">
          <EnterVrButton />
          <ExportMenu />
        </div>

        <EnergyDashboard />
        <FormulaOverlay />
        <PhaseSpaceDiagram />
        <ResonancePanel />
        <GWStrainPlot />
        <TransferPlanner />
        <TimelineBar />
        <ScriptEditor />
        <ShortcutsCheatsheet />
        <OnboardingTour />
        <LoadingOverlay />
      </div>

      <BodyInspector />
    </div>
  );
}
