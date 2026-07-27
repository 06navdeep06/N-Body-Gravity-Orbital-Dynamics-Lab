"use client";

/**
 * Feeds the profiler the renderer's per-frame draw-call and triangle counts,
 * and brackets the render phase with User Timing marks.
 *
 * `renderPriority` isn't used, so this runs inside the normal frame loop;
 * `three`'s `info.render` is populated by the previous frame's draw, which
 * is exactly what we want to report.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { profiler } from "@/lib/performance/profiler";

export function RenderStatsProbe() {
  const gl = useThree((s) => s.gl);

  useFrame(() => {
    const info = gl.info;
    profiler.renderStats = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  });

  return null;
}
