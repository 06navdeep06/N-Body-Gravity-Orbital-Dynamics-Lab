/**
 * Camera mode metadata: ids, labels and one-line descriptions for the
 * sidebar picker. The actual per-frame behavior lives in
 * components/scene/CameraController.tsx.
 */

import type { CameraMode } from "@/lib/stores/simulation-store";

export interface CameraModeInfo {
  id: CameraMode;
  label: string;
  /** Single-glyph icon used by the sidebar picker. */
  glyph: string;
  description: string;
  needsSelection: boolean;
}

export const CAMERA_MODES: CameraModeInfo[] = [
  {
    id: "free",
    label: "Free Orbit",
    glyph: "🖱",
    description: "Standard mouse orbit/zoom/pan controls.",
    needsSelection: false,
  },
  {
    id: "follow",
    label: "Follow Body",
    glyph: "🎯",
    description: "Tracks the selected body at a fixed offset.",
    needsSelection: true,
  },
  {
    id: "topdown",
    label: "Top-Down",
    glyph: "⬇",
    description: "Orthographic view straight down the Y axis — best for coplanar orbit analysis.",
    needsSelection: false,
  },
  {
    id: "flyby",
    label: "Flyby",
    glyph: "📡",
    description: "Fixed vantage point tracking the selected body as it passes.",
    needsSelection: true,
  },
  {
    id: "corotating",
    label: "Co-rotating",
    glyph: "🔄",
    description: "Rotates with the selected body's orbit so it appears stationary — reveals Lagrange points and resonances.",
    needsSelection: true,
  },
  {
    id: "dolly",
    label: "Cinematic",
    glyph: "🎬",
    description: "Slow automated orbit of the whole system with a gentle zoom pulse.",
    needsSelection: false,
  },
];
