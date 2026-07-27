"use client";

/**
 * "Enter VR" button. Renders nothing at all unless the browser reports
 * immersive-vr support, so desktop users never see a dead control.
 */

import { Glasses } from "lucide-react";
import { useEffect, useState } from "react";
import { isImmersiveVrSupported, xrStore } from "@/lib/xr/xr-store";

export function EnterVrButton() {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isImmersiveVrSupported().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!supported) return null;

  return (
    <button
      onClick={() => void xrStore.enterVR()}
      className="pointer-events-auto flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md bg-indigo-700/90 px-3 text-xs font-medium text-indigo-50 shadow-lg ring-1 ring-indigo-500 hover:bg-indigo-600 max-sm:px-0"
      title="Open the simulation in an immersive VR session"
    >
      <Glasses size={16} />
      <span className="max-sm:sr-only">Enter VR</span>
    </button>
  );
}
