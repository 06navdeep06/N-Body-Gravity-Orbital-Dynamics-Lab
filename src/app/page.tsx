"use client";

import { useEffect } from "react";
import { BodyInspector } from "@/components/ui/BodyInspector";
import { BodyLauncher } from "@/components/ui/BodyLauncher";
import { ControlSidebar } from "@/components/ui/ControlSidebar";
import { EnergyDashboard } from "@/components/ui/EnergyDashboard";
import { FormulaOverlay } from "@/components/ui/FormulaOverlay";
import { TimelineBar } from "@/components/ui/TimelineBar";
import { Bodies } from "@/components/scene/Bodies";
import { LagrangeMarkers } from "@/components/scene/LagrangeMarkers";
import { LaunchPreview } from "@/components/scene/LaunchPreview";
import { OrbitEllipse } from "@/components/scene/OrbitEllipse";
import { Scene } from "@/components/scene/Scene";
import { Trails } from "@/components/scene/Trails";
import { VelocityArrows } from "@/components/scene/VelocityArrows";
import { usePhysicsWorker } from "@/hooks/usePhysicsWorker";
import { PRESETS } from "@/lib/presets";
import { useSimulationStore } from "@/lib/stores/simulation-store";

export default function Home() {
  usePhysicsWorker();

  const bodyCount = useSimulationStore((s) => s.system.bodies.length);
  const loadPreset = useSimulationStore((s) => s.loadPreset);

  useEffect(() => {
    if (bodyCount === 0 && PRESETS[0]) {
      loadPreset(PRESETS[0]);
    }
    // Only seed the default preset once, on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        </Scene>

        <div className="absolute left-4 top-4 z-10">
          <BodyLauncher />
        </div>

        <EnergyDashboard />
        <FormulaOverlay />
        <TimelineBar />
      </div>

      <BodyInspector />
    </div>
  );
}
