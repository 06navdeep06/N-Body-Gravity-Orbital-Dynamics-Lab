"use client";

/**
 * First-visit onboarding: a five-step card sequence introducing the main
 * UI areas. Shows once; completion (or skip) is remembered in
 * localStorage under `hasSeenOnboarding`.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "hasSeenOnboarding";

const STEPS: { title: string; body: string; placement: string }[] = [
  {
    title: "Welcome to the Orbital Dynamics Lab",
    body: "This is the simulation canvas — a live N-body gravity integrator. Drag to orbit the camera, scroll to zoom.",
    placement: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  },
  {
    title: "Control sidebar",
    body: "Presets, physics parameters (timestep, G, softening), visualization toggles and GR precession all live on the left.",
    placement: "left-80 top-24",
  },
  {
    title: "Inspect bodies",
    body: "Click any body in the scene to open its inspector: edit mass, position and velocity, and read its Keplerian orbital elements.",
    placement: "right-80 top-24",
  },
  {
    title: "Launch satellites",
    body: "Hold Shift and drag on the scene to slingshot-launch a new body — drag farther for more speed, aim opposite the drag.",
    placement: "left-1/2 bottom-24 -translate-x-1/2",
  },
  {
    title: "Explore presets",
    body: "Try the Figure-8 choreography, a galaxy collision, Mercury's GR precession or the Real Solar System. Press ? anytime for shortcuts.",
    placement: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  },
];

export function OnboardingTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    // Deferred so the tour appears after the loading veil clears (and so
    // the setState isn't synchronous inside the effect body).
    const timer = setTimeout(() => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) setStep(0);
      } catch {
        // Storage unavailable (private mode) — skip onboarding quietly.
      }
    }, 1300);
    return () => clearTimeout(timer);
  }, []);

  if (step === null) return null;

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setStep(null);
  };

  const next = () => {
    if (step >= STEPS.length - 1) finish();
    else setStep(step + 1);
  };

  const current = STEPS[step]!;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 bg-black/50">
      <div
        className={`absolute w-72 rounded-lg border border-sky-700 bg-zinc-950 p-4 shadow-2xl ${current.placement}`}
      >
        <div className="mb-1 text-[10px] font-medium text-sky-400">
          Step {step + 1} of {STEPS.length}
        </div>
        <h3 className="mb-1.5 text-sm font-semibold text-zinc-100">{current.title}</h3>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{current.body}</p>
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-[11px] text-zinc-500 hover:text-zinc-300">
            Skip tour
          </button>
          <button
            onClick={next}
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
          >
            {step >= STEPS.length - 1 ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
