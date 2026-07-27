"use client";

/**
 * Contextual KaTeX-rendered formula reference. Which formulas show depends
 * on what's currently active in the sim (selection, GR, Lagrange points),
 * so the panel stays relevant instead of dumping every formula at once.
 */

import katex from "katex";
import { useMemo } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";

function Formula({ tex, caption }: { tex: string; caption: string }) {
  const html = useMemo(
    () => katex.renderToString(tex, { throwOnError: false, displayMode: true }),
    [tex]
  );
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-500">{caption}</div>
      <div className="overflow-x-auto text-zinc-100" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export function FormulaOverlay() {
  const show = useSimulationStore((s) => s.showFormulaOverlay);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const enableGR = useSimulationStore((s) => s.enableGR);
  const showLagrangePoints = useSimulationStore((s) => s.showLagrangePoints);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute bottom-20 left-2 w-80 max-w-[calc(100vw-1rem)] sm:bottom-16 sm:left-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 backdrop-blur">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        Physics Reference
      </h3>
      <Formula
        tex="\vec F_{ij} = G\frac{m_i m_j (\vec r_j - \vec r_i)}{\lVert \vec r_j - \vec r_i \rVert^3}"
        caption="Newton's Law of Gravitation"
      />
      <Formula tex="v^2 = GM\left(\frac{2}{r} - \frac{1}{a}\right)" caption="Vis-viva equation" />
      {selectedBodyId && (
        <Formula
          tex="\frac{1}{a} = \frac{2}{r} - \frac{v^2}{\mu},\quad \vec e = \frac{1}{\mu}\left[\left(v^2-\frac{\mu}{r}\right)\vec r - (\vec r\cdot \vec v)\vec v\right]"
          caption="Orbital elements from the state vector"
        />
      )}
      {enableGR && (
        <Formula
          tex="\vec a_{GR} = \frac{GM}{r^2 c^2}\left[\left(4\frac{GM}{r}-v^2\right)\hat r + 4(\vec v\cdot\hat r)\vec v\right]"
          caption="Post-Newtonian (Schwarzschild) correction"
        />
      )}
      {showLagrangePoints && (
        <Formula
          tex="\frac{m_1}{(x-x_1)^2} - \frac{m_2}{(x-x_2)^2} - (m_1+m_2)\frac{x-x_{cm}}{r_{12}^3} = 0"
          caption="Restricted three-body problem: collinear points"
        />
      )}
    </div>
  );
}
