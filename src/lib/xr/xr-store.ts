/**
 * Shared @react-three/xr store, created once at module scope so the
 * "Enter VR" button (DOM side) and the <XR> provider (canvas side) talk to
 * the same session state.
 */

import { createXRStore } from "@react-three/xr";

export const xrStore = createXRStore({
  // Controller rays double as the body-picking pointer, so R3F's normal
  // onClick/onPointerOver handlers work in VR without special-casing.
  controller: { rayPointer: { rayModel: { color: "#38bdf8" } } },
  hand: { rayPointer: { rayModel: { color: "#38bdf8" } } },
});

/** Feature-detects immersive-vr support without requesting a session. */
export async function isImmersiveVrSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("xr" in navigator)) return false;
  try {
    return (await navigator.xr!.isSessionSupported("immersive-vr")) ?? false;
  } catch {
    return false;
  }
}
