"use client";

/**
 * Full-screen loading veil with a CSS "spinning galaxy" while the client
 * bundle hydrates and the first frame renders, then fades itself out.
 */

import { useEffect, useState } from "react";

export function LoadingOverlay() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");

  useEffect(() => {
    // Mounted = hydrated; hold briefly so the fade isn't a flash.
    const fadeTimer = setTimeout(() => setPhase("fading"), 400);
    const goneTimer = setTimeout(() => setPhase("gone"), 1100);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#03040a] transition-opacity duration-700 ${
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="relative h-24 w-24 animate-[spin_3s_linear_infinite]">
        {[0, 60, 120, 180, 240, 300].map((deg, i) => (
          <span
            key={deg}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: i % 2 ? "#7dd3fc" : "#c4b5fd",
              transform: `rotate(${deg}deg) translateX(${18 + i * 4}px)`,
              opacity: 0.9 - i * 0.1,
            }}
          />
        ))}
        <img
          src="/textures/logo.png"
          alt="Orbital Dynamics Logo"
          className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_0_12px_rgba(56,189,248,0.6)]"
        />
      </div>
      <div className="mt-6 flex items-center gap-2">
        <img src="/textures/logo.png" alt="Logo" className="h-4 w-4 object-contain opacity-70" />
        <p className="font-mono text-xs tracking-widest text-zinc-500">
          INITIALIZING ORBITAL DYNAMICS LAB
        </p>
      </div>
    </div>
  );
}
