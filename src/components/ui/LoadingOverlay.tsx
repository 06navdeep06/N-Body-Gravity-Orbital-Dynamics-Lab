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
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200 shadow-[0_0_16px_6px_rgba(253,230,138,0.35)]" />
      </div>
      <p className="mt-6 font-mono text-xs tracking-widest text-zinc-500">
        INITIALIZING ORBITAL DYNAMICS LAB
      </p>
    </div>
  );
}
